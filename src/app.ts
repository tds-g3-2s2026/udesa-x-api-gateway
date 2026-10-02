import { context, propagation } from '@opentelemetry/api';
import { Hono, type Context } from 'hono';
import { proxy } from 'hono/proxy';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { version } from '../package.json';
import { loadConfig } from './config';
import { HEALTH_TARGETS, resolveBackend } from './routing';
import { requestTelemetry } from './telemetry';

// Past this a backend counts as down; the backoffice gives up at the same mark.
const HEALTH_TIMEOUT_MS = 5000;

interface HealthSummary {
  body: { status: string; version: string };
  code: ContentfulStatusCode;
}

/**
 * Reads a backend's /healthcheck and keeps only status and version: the
 * dependency detail can carry connection errors, and this answer is public.
 */
async function readHealth(url: string): Promise<HealthSummary> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const report = (await res.json()) as { status: string; version: string };
    return {
      body: { status: report.status, version: report.version },
      code: res.status as ContentfulStatusCode,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function createApp() {
  const app = new Hono();

  app.use(requestTelemetry);

  // No dependency to check: this service holds no state.
  const health = (c: Context) => c.json({ status: 'ok', version });

  app.get('/healthcheck', health);

  app.get('/livez', (c) => c.json({ status: 'ok' }));

  // The backends' /healthcheck sits outside /api, where only the cluster reaches it,
  // so this is the one path the gateway rewrites instead of forwarding as is.
  app.get('/api/health/api-gateway', health);

  app.get('/api/health/:service', async (c) => {
    const backend = HEALTH_TARGETS.get(c.req.param('service'));
    if (!backend) {
      return c.text('unknown service', 404);
    }

    try {
      const { body, code } = await readHealth(`${loadConfig()[backend]}/healthcheck`);
      return c.json(body, code);
    } catch {
      return c.json({ status: 'down' }, 503);
    }
  });

  app.all('/api/*', async (c) => {
    const config = loadConfig();
    const backendUrl = resolveBackend(c.req.path, config);
    if (!backendUrl) {
      return c.text('no route configured for this path', 404);
    }

    const headers: Record<string, string | undefined> = {
      ...c.req.header(),
      // Host belongs to this gateway, not to the backend's own address.
      host: undefined,
    };
    // Replaces the caller's traceparent with one whose parent is the gateway's span.
    propagation.inject(context.active(), headers);
    const upstream = await proxy(`${backendUrl}${c.req.path}${new URL(c.req.url).search}`, {
      ...c.req,
      headers,
    });
    // Recomputed by the runtime from the body it actually sends.
    upstream.headers.delete('content-length');
    return upstream;
  });

  return app;
}

export const app = createApp();
