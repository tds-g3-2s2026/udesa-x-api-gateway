import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { InMemoryLogRecordExporter } from '@opentelemetry/sdk-logs';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { startTelemetry } from '../src/telemetry';

it('exports gateway histograms as OTLP protobuf to the configured receiver', async () => {
  const received: { path: string; contentType: string; authorization: string; body: Buffer }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (req.url === '/v1/metrics') {
        received.push({
          path: req.url,
          contentType: req.headers['content-type'] ?? '',
          authorization: req.headers.authorization ?? '',
          body: Buffer.concat(chunks),
        });
        res.writeHead(200, { 'content-type': 'application/x-protobuf' });
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  vi.stubEnv('USERS_API_URL', url);
  vi.stubEnv('POSTS_API_URL', url);
  vi.stubEnv('NOTIFICATIONS_API_URL', url);
  const telemetry = startTelemetry({
    spans: new InMemorySpanExporter(),
    logs: new InMemoryLogRecordExporter(),
    metrics: new OTLPMetricExporter({
      url: `${url}/v1/metrics`,
      headers: { Authorization: 'Bearer test' },
    }),
  })!;
  try {
    expect((await createApp().request('/api/posts/private-id?cursor=secret')).status).toBe(200);
    await telemetry.meterProvider.forceFlush();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      path: '/v1/metrics',
      contentType: 'application/x-protobuf',
      authorization: 'Bearer test',
    });
    const encoded = received[0].body;
    expect(encoded.includes(Buffer.from('http.server.request.duration'))).toBe(true);
    expect(encoded.includes(Buffer.from('service.instance.id'))).toBe(true);
    expect(encoded.includes(Buffer.from('http.route'))).toBe(true);
    expect(encoded.includes(Buffer.from('/api/posts'))).toBe(true);
    expect(encoded.includes(Buffer.from('private-id'))).toBe(false);
    expect(encoded.includes(Buffer.from('secret'))).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    await Promise.all([
      telemetry.meterProvider.shutdown(),
      telemetry.tracerProvider.shutdown(),
      telemetry.loggerProvider.shutdown(),
    ]);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
