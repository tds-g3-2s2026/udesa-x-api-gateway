import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { InMemoryLogRecordExporter } from '@opentelemetry/sdk-logs';
import { SpanStatusCode } from '@opentelemetry/api';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { startTelemetry, type Telemetry } from '../src/telemetry';

const CALLER_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const CALLER_TRACEPARENT = `00-${CALLER_TRACE_ID}-00f067aa0ba902b7-01`;

const spans = new InMemorySpanExporter();
const logRecords = new InMemoryLogRecordExporter();
let telemetry: Telemetry;
let backend: Server;
let received: IncomingHttpHeaders[];

beforeAll(async () => {
  telemetry = startTelemetry({ spans, logs: logRecords })!;
  backend = createServer((req, res) => {
    received.push(req.headers);
    res.writeHead(req.url === '/api/posts/broken' ? 503 : 200, {
      'content-type': 'application/json',
    });
    res.end('{}');
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const { port } = backend.address() as AddressInfo;
  vi.stubEnv('USERS_API_URL', `http://127.0.0.1:${port}`);
  vi.stubEnv('POSTS_API_URL', `http://127.0.0.1:${port}`);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => backend.close(resolve));
  await telemetry.tracerProvider.shutdown();
  await telemetry.loggerProvider.shutdown();
});

beforeEach(() => {
  received = [];
  spans.reset();
  logRecords.reset();
});

async function call(path: string, headers: Record<string, string> = {}) {
  const res = await createApp().request(path, { headers });
  await telemetry.tracerProvider.forceFlush();
  await telemetry.loggerProvider.forceFlush();
  return res;
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
