import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { InMemoryLogRecordExporter } from '@opentelemetry/sdk-logs';
import { SpanStatusCode } from '@opentelemetry/api';
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
} from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { requestTelemetry, startTelemetry, type Telemetry } from '../src/telemetry';

const CALLER_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const CALLER_TRACEPARENT = `00-${CALLER_TRACE_ID}-00f067aa0ba902b7-01`;

const spans = new InMemorySpanExporter();
const logRecords = new InMemoryLogRecordExporter();
const metricRecords = new InMemoryMetricExporter(AggregationTemporality.DELTA);
let telemetry: Telemetry;
let backend: Server;
let received: IncomingHttpHeaders[];

beforeAll(async () => {
  telemetry = startTelemetry({ spans, logs: logRecords, metrics: metricRecords })!;
  backend = createServer((req, res) => {
    received.push(req.headers);
    const status =
      req.url === '/api/posts/broken' ? 503 : req.url?.endsWith('/timeout') ? 504 : 200;
    res.writeHead(status, {
      'content-type': 'application/json',
    });
    res.end('{}');
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const { port } = backend.address() as AddressInfo;
  vi.stubEnv('USERS_API_URL', `http://127.0.0.1:${port}`);
  vi.stubEnv('POSTS_API_URL', `http://127.0.0.1:${port}`);
  vi.stubEnv('NOTIFICATIONS_API_URL', `http://127.0.0.1:${port}`);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => backend.close(resolve));
  await telemetry.tracerProvider.shutdown();
  await telemetry.loggerProvider.shutdown();
  await telemetry.meterProvider.shutdown();
});

beforeEach(() => {
  received = [];
  spans.reset();
  logRecords.reset();
  metricRecords.reset();
});

async function call(path: string, headers: Record<string, string> = {}, method = 'GET') {
  const res = await createApp().request(path, { headers, method });
  await telemetry.tracerProvider.forceFlush();
  await telemetry.loggerProvider.forceFlush();
  await telemetry.meterProvider.forceFlush();
  return res;
}

function exportedMetrics() {
  return metricRecords
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics));
}

function traceparentParts(header: string | string[] | undefined) {
  const [, traceId, parentSpanId] = String(header).split('-');
  return { traceId, parentSpanId };
}

describe('trace context', () => {
  it('passes the caller trace on, with the gateway span as the parent', async () => {
    await call('/api/me', { traceparent: CALLER_TRACEPARENT });

    const [span] = spans.getFinishedSpans();
    const forwarded = traceparentParts(received[0].traceparent);
    expect(span.spanContext().traceId).toBe(CALLER_TRACE_ID);
    expect(forwarded).toEqual({
      traceId: CALLER_TRACE_ID,
      parentSpanId: span.spanContext().spanId,
    });
  });

  it('starts a trace when the caller sends none, and the backend joins it', async () => {
    await call('/api/me');

    const [span] = spans.getFinishedSpans();
    expect(span.spanContext().traceId).not.toBe(CALLER_TRACE_ID);
    expect(traceparentParts(received[0].traceparent).traceId).toBe(span.spanContext().traceId);
  });
});

describe('request log', () => {
  it('logs each request with its trace and its outcome as fields', async () => {
    await call('/api/me', { traceparent: CALLER_TRACEPARENT });

    const [record] = logRecords.getFinishedLogRecords();
    expect(record.body).toBe('GET /api/me 200');
    expect(record.spanContext?.traceId).toBe(CALLER_TRACE_ID);
    expect(record.attributes).toMatchObject({
      'http.request.method': 'GET',
      'url.path': '/api/me',
      'http.response.status_code': 200,
    });
    expect(record.attributes.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('leaves the query string out', async () => {
    await call('/api/me?token=secret');

    const exported = JSON.stringify(
      logRecords.getFinishedLogRecords().map((r) => [r.body, r.attributes])
    );
    expect(exported).not.toContain('secret');
  });

  it('marks a request the gateway could not route', async () => {
    await call('/api/unknown');

    const [record] = logRecords.getFinishedLogRecords();
    expect(record.body).toBe('GET /api/unknown 404');
  });
});

describe('probes', () => {
  it('produce no span and no request log', async () => {
    await call('/healthcheck');
    await call('/livez');

    expect(spans.getFinishedSpans()).toEqual([]);
    expect(logRecords.getFinishedLogRecords()).toEqual([]);
    expect(exportedMetrics()).toEqual([]);
  });
});

describe('HTTP metrics', () => {
  it('records seconds with the routing prefix, never a raw path or query', async () => {
    await call('/api/posts/private-id?token=secret');
    const histogram = exportedMetrics().find(
      (metric) => metric.descriptor.name === 'http.server.request.duration'
    );
    expect(histogram?.descriptor.unit).toBe('s');
    expect(histogram?.dataPoints[0].attributes).toEqual({
      'http.request.method': 'GET',
      'http.route': '/api/posts',
      'http.response.status_code': 200,
    });
    if (histogram?.dataPointType !== DataPointType.HISTOGRAM) throw new Error('Expected histogram');
    expect(histogram.dataPoints[0].value.count).toBe(1);
    expect(histogram.dataPoints[0].value.sum).toBeGreaterThanOrEqual(0);
    expect(histogram.dataPoints[0].value.buckets.boundaries).toEqual([
      0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.3, 0.4, 0.5, 0.75, 0.8, 1, 2.5, 5, 7.5, 10,
    ]);
    expect(JSON.stringify(exportedMetrics())).not.toMatch(/private-id|secret|token/);
    expect(metricRecords.getMetrics()[0].resource.attributes).toMatchObject({
      'service.name': 'api-gateway',
      'service.instance.id': expect.stringMatching(/^[a-f0-9-]{36}$/),
    });
  });

  it.each([
    ['/api/feed', 'first', 'feed_first'],
    ['/api/feed?cursor=opaque-secret', 'next', 'feed_next'],
    ['/api/feed?cursor=', 'first', 'feed_first'],
  ])('classifies %s without retaining the cursor', async (path, page, flow) => {
    await call(path);
    const histogram = exportedMetrics().find(
      (metric) => metric.descriptor.name === 'http.server.request.duration'
    );
    expect(histogram?.dataPoints[0].attributes).toMatchObject({
      'http.route': '/api/feed',
      'udesa.feed.page': page,
      'udesa.http.flow': flow,
    });
    expect(JSON.stringify(exportedMetrics())).not.toContain('opaque-secret');
  });

  it.each([
    ['POST', '/api/auth/login', 'login'],
    ['POST', '/api/posts', 'create_post'],
    ['GET', '/api/search/posts?q=secret', 'search_posts'],
    ['GET', '/api/users/7509ccfe-58a4-4823-bf98-9bda527b1513', 'profile'],
    ['GET', '/api/users/suggested', undefined],
    ['GET', '/api/users/7509ccfe-58a4-4823-bf98-9bda527b1513/posts', undefined],
    ['GET', '/api/auth/login', undefined],
  ])('assigns a bounded SLO flow for %s %s', async (method, path, flow) => {
    await call(path, {}, method);
    const histogram = exportedMetrics().find(
      (metric) => metric.descriptor.name === 'http.server.request.duration'
    );
    expect(histogram?.dataPoints[0].attributes['udesa.http.flow']).toBe(flow);
    expect(histogram?.dataPoints[0].attributes).not.toHaveProperty('udesa.feed.page');
  });

  it('counts an upstream 504 by the routed backend', async () => {
    expect((await call('/api/notifications/timeout')).status).toBe(504);
    const counter = exportedMetrics().find(
      (metric) => metric.descriptor.name === 'udesa.gateway.upstream.errors'
    );
    expect(counter?.dataPoints[0]).toMatchObject({
      attributes: { backend: 'notifications-api', 'http.response.status_code': 504 },
      value: 1,
    });
  });

  it('returns and counts 502 when the upstream refuses the connection', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const { port } = closed.address() as AddressInfo;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    vi.stubEnv('POSTS_API_URL', `http://127.0.0.1:${port}`);
    try {
      expect((await call('/api/posts')).status).toBe(502);
      const counter = exportedMetrics().find(
        (metric) => metric.descriptor.name === 'udesa.gateway.upstream.errors'
      );
      expect(counter?.dataPoints[0]).toMatchObject({
        attributes: { backend: 'posts-api', 'http.response.status_code': 502 },
        value: 1,
      });
      expect(spans.getFinishedSpans()[0].status.code).toBe(SpanStatusCode.ERROR);
    } finally {
      const { port: backendPort } = backend.address() as AddressInfo;
      vi.stubEnv('POSTS_API_URL', `http://127.0.0.1:${backendPort}`);
    }
  });

  it('omits a route attribute for unrecognized paths', async () => {
    await call('/api/not-a-real-route/private-id?token=secret');
    const histogram = exportedMetrics().find(
      (metric) => metric.descriptor.name === 'http.server.request.duration'
    );
    expect(histogram?.dataPoints[0].attributes).toEqual({
      'http.request.method': 'GET',
      'http.response.status_code': 404,
    });
  });

  it('records the final response of a custom error handler', async () => {
    const app = new Hono();
    app.use(requestTelemetry);
    app.onError((_error, c) => c.json({ error: 'invalid-input' }, 422));
    app.get('/api/posts', () => {
      throw new Error('invalid input');
    });
    expect((await app.request('/api/posts')).status).toBe(422);
    await Promise.all([
      telemetry.meterProvider.forceFlush(),
      telemetry.tracerProvider.forceFlush(),
      telemetry.loggerProvider.forceFlush(),
    ]);
    const histogram = exportedMetrics().find(
      (metric) => metric.descriptor.name === 'http.server.request.duration'
    );
    expect(histogram?.dataPoints[0].attributes['http.response.status_code']).toBe(422);
    expect(spans.getFinishedSpans()[0].status.code).toBe(SpanStatusCode.UNSET);
  });
});

describe('backend failures', () => {
  it('mark the gateway span as an error', async () => {
    await call('/api/posts/broken');

    const [span] = spans.getFinishedSpans();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(logRecords.getFinishedLogRecords()[0].body).toBe('GET /api/posts/broken 503');
  });
});
