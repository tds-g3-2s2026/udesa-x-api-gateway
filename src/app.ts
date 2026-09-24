import { Hono } from 'hono';
import { proxy } from 'hono/proxy';

import { version } from '../package.json';
import { loadConfig } from './config';
import { resolveBackend } from './routing';

export function createApp() {
  const app = new Hono();

  app.get('/healthcheck', (c) => {
    // No dependency to check: this service holds no state.
    return c.json({ status: 'ok', version });
  });

  app.get('/livez', (c) => c.json({ status: 'ok' }));

  app.all('/api/*', async (c) => {
    const config = loadConfig();
    const backendUrl = resolveBackend(c.req.path, config);
    if (!backendUrl) {
      return c.text('no route configured for this path', 404);
    }

    const upstream = await proxy(`${backendUrl}${c.req.path}${new URL(c.req.url).search}`, {
      ...c.req,
      headers: {
        ...c.req.header(),
        // Host belongs to this gateway, not to the backend's own address.
        host: undefined,
      },
    });
    // Recomputed by the runtime from the body it actually sends.
    upstream.headers.delete('content-length');
    return upstream;
  });

  return app;
}

export const app = createApp();
