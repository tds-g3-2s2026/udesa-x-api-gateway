import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
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
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import type { MiddlewareHandler } from 'hono';

import { version } from '../package.json';

const SERVICE_NAME = 'api-gateway';

// Kubernetes probes hit these every few seconds. A span and a log line per
// probe would bury the requests somebody actually made.
const PROBE_PATHS = new Set(['/healthcheck', '/livez']);

export interface Telemetry {
  tracerProvider: BasicTracerProvider;
  loggerProvider: LoggerProvider;
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
}): Telemetry | undefined {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  if (!exporters) {
    return undefined;
  }

  const resource = resourceFromAttributes({
    'service.name': SERVICE_NAME,
    'service.version': version,
  });
  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(exporters.spans)],
  });
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor({ exporter: exporters.logs })],
  });
  trace.setGlobalTracerProvider(tracerProvider);
  logs.setGlobalLoggerProvider(loggerProvider);
  return { tracerProvider, loggerProvider };
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

  await context.with(active, next);

  const status = c.res.status;
  // The path only: a query string can carry a token.
  const attributes = {
    'http.request.method': method,
    'url.path': path,
    'http.response.status_code': status,
  };
  span.setAttributes(attributes);
  if (status >= 500) {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }
  span.end();
  logs.getLogger(SERVICE_NAME).emit({
    severityNumber: SeverityNumber.INFO,
    severityText: 'INFO',
    body: `${method} ${path} ${status}`,
    attributes: { ...attributes, duration_ms: Math.round((performance.now() - started) * 10) / 10 },
    context: active,
  });
};
