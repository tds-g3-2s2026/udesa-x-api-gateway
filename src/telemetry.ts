import { randomUUID } from 'node:crypto';

import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Counter,
  type Histogram,
} from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
} from '@opentelemetry/sdk-logs';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import type { MiddlewareHandler } from 'hono';

import { version } from '../package.json';
import { resolveRoute } from './routing';

const SERVICE_NAME = 'api-gateway';
const INSTANCE_ID = randomUUID();
const HTTP_DURATION_BOUNDARIES = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.3, 0.4, 0.5, 0.75, 0.8, 1, 2.5, 5, 7.5, 10,
];
const HTTP_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'DELETE',
  'CONNECT',
  'OPTIONS',
  'TRACE',
  'PATCH',
]);
let requestDuration: Histogram | undefined;
let upstreamErrors: Counter | undefined;

// Kubernetes probes hit these every few seconds. A span and a log line per
// probe would bury the requests somebody actually made.
const PROBE_PATHS = new Set(['/healthcheck', '/livez']);

export interface Telemetry {
  tracerProvider: BasicTracerProvider;
  loggerProvider: LoggerProvider;
  meterProvider: MeterProvider;
}

/**
 * Makes every request carry a W3C trace context to the backends and, given
 * exporters, sends the gateway's spans and logs over OTLP.
 *
 * Without exporters the gateway records nothing, but it still passes the
 * caller's trace on, so the backends keep joining it.
 */
export function startTelemetry(exporters?: {
  spans: SpanExporter;
  logs: LogRecordExporter;
  metrics: PushMetricExporter;
}): Telemetry | undefined {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  if (!exporters) {
    return undefined;
  }

  const resource = resourceFromAttributes({
    'service.name': SERVICE_NAME,
    'service.version': version,
    'service.instance.id': INSTANCE_ID,
  });
  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(exporters.spans)],
  });
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor({ exporter: exporters.logs })],
  });
  const meterProvider = new MeterProvider({
    resource,
    readers: [new PeriodicExportingMetricReader({ exporter: exporters.metrics })],
  });
  const meter = meterProvider.getMeter(SERVICE_NAME);
  requestDuration = meter.createHistogram('http.server.request.duration', {
    unit: 's',
    description: 'Duration of HTTP server requests.',
    advice: { explicitBucketBoundaries: HTTP_DURATION_BOUNDARIES },
  });
  upstreamErrors = meter.createCounter('udesa.gateway.upstream.errors', {
    description: 'Upstream unavailable responses by backend.',
  });
  trace.setGlobalTracerProvider(tracerProvider);
  logs.setGlobalLoggerProvider(loggerProvider);
  return { tracerProvider, loggerProvider, meterProvider };
}

function sloFlow(method: string, path: string, page: string | undefined): string | undefined {
  if (method === 'POST' && path === '/api/auth/login') return 'login';
  if (method === 'POST' && path === '/api/posts') return 'create_post';
  if (method !== 'GET') return undefined;
  if (path === '/api/feed') return page === 'next' ? 'feed_next' : 'feed_first';
  if (path === '/api/search/posts') return 'search_posts';
  if (/^\/api\/users\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path))
    return 'profile';
  return undefined;
}

/** Opens a span per request, joining the caller's trace, and logs each request. */
export const requestTelemetry: MiddlewareHandler = async (c, next) => {
  if (PROBE_PATHS.has(c.req.path)) {
    return next();
  }

  const { method, path } = c.req;
  const parent = propagation.extract(ROOT_CONTEXT, c.req.header());
  const span = trace
    .getTracer(SERVICE_NAME)
    .startSpan(`${method} ${path}`, { kind: SpanKind.SERVER }, parent);
  const active = trace.setSpan(parent, span);
  const started = performance.now();

  await context.with(active, async () => {
    let failed = false;
    try {
      await next();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      const status = failed ? 500 : c.res.status;
      const elapsedSeconds = (performance.now() - started) / 1000;
      const route = resolveRoute(path);
      const page =
        method === 'GET' && path === '/api/feed'
          ? c.req.query('cursor')
            ? 'next'
            : 'first'
          : undefined;
      const flow = sloFlow(method, path, page);
      const metricAttributes = {
        'http.request.method': HTTP_METHODS.has(method) ? method : '_OTHER',
        'http.response.status_code': status,
        ...(route ? { 'http.route': route[0] } : {}),
        ...(page ? { 'udesa.feed.page': page } : {}),
        ...(flow ? { 'udesa.http.flow': flow } : {}),
      };
      requestDuration?.record(elapsedSeconds, metricAttributes, active);
      if (route && (status === 502 || status === 504)) {
        upstreamErrors?.add(
          1,
          {
            backend: route[1].replace('ApiUrl', '-api'),
            'http.response.status_code': status,
          },
          active
        );
      }
      const attributes = {
        'http.request.method': method,
        'url.path': path,
        'http.response.status_code': status,
      };
      span.setAttributes(attributes);
      if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      logs.getLogger(SERVICE_NAME).emit({
        severityNumber: SeverityNumber.INFO,
        severityText: 'INFO',
        body: `${method} ${path} ${status}`,
        attributes: { ...attributes, duration_ms: Math.round(elapsedSeconds * 10000) / 10 },
        context: active,
      });
      span.end();
    }
  });
};
