import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { version } from '../package.json';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('GET /healthcheck', () => {
  it('returns ok without needing any backend configured', async () => {
    const { app } = await import('../src/app');
    const res = await app.request('/healthcheck');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', version });
  });
});

describe('unmatched /api path', () => {
  it('returns 404 once the backends are configured', async () => {
    vi.stubEnv('USERS_API_URL', 'http://users-api:8000');
    vi.stubEnv('POSTS_API_URL', 'http://posts-api:8000');

    const { app } = await import('../src/app');
    const res = await app.request('/api/unknown');

    expect(res.status).toBe(404);
  });
});

describe('matched /api path', () => {
  it('forwards the request to the real backend and returns its response', async () => {
    // A real HTTP server, not a mock of proxy() or fetch: this is the one
    // test that proves the gateway actually talks to a backend over the
    // network, end to end. node:http instead of Bun.serve because Vitest
    // runs test files in a context where the Bun global isn't injected,
    // even though the process itself is started with `bun run`.
    const fakeUsersApi = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ receivedPath: req.url, method: req.method }));
    });

    await new Promise<void>((resolve) => fakeUsersApi.listen(0, '127.0.0.1', resolve));
    const { port } = fakeUsersApi.address() as AddressInfo;

    try {
      vi.stubEnv('USERS_API_URL', `http://127.0.0.1:${port}`);
      vi.stubEnv('POSTS_API_URL', 'http://posts-api:8000');

      const { app } = await import('../src/app');
      const res = await app.request('/api/me?limit=10&cursor=a%2Fb');

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        receivedPath: '/api/me?limit=10&cursor=a%2Fb',
        method: 'GET',
      });
    } finally {
      await new Promise<void>((resolve) => fakeUsersApi.close(() => resolve()));
    }
  });
});

/** A real backend on a loopback port, so the gateway goes over the network like in the cluster. */
async function serve(listener: RequestListener) {
  const server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('GET /api/health/:service', () => {
  it('answers its own health without any backend configured', async () => {
    const { app } = await import('../src/app');
    const res = await app.request('/api/health/api-gateway');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', version });
  });

  it('returns 404 for a service it does not know', async () => {
    vi.stubEnv('USERS_API_URL', 'http://users-api:8000');
    vi.stubEnv('POSTS_API_URL', 'http://posts-api:8000');

    const { app } = await import('../src/app');
    const res = await app.request('/api/health/notifications-api');

    expect(res.status).toBe(404);
  });

  it("reads the backend's /healthcheck and returns only its status and version", async () => {
    const backend = await serve((req, res) => {
      res.writeHead(req.url === '/healthcheck' ? 200 : 404, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          dependencies: { postgres: 'ok', redis: 'ok' },
          version: '0.4.0',
        })
      );
    });

    try {
      vi.stubEnv('USERS_API_URL', backend.url);
      vi.stubEnv('POSTS_API_URL', 'http://posts-api:8000');

      const { app } = await import('../src/app');
      const res = await app.request('/api/health/users-api');

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok', version: '0.4.0' });
    } finally {
      await backend.close();
    }
  });

  it('keeps the 503 of a degraded backend but not the error behind it', async () => {
    const backend = await serve((_req, res) => {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'degraded',
          dependencies: { postgres: 'connection refused to db.internal:5432', redis: 'ok' },
          version: '0.4.0',
        })
      );
    });

    try {
      vi.stubEnv('USERS_API_URL', 'http://users-api:8000');
      vi.stubEnv('POSTS_API_URL', backend.url);

      const { app } = await import('../src/app');
      const res = await app.request('/api/health/posts-api');

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ status: 'degraded', version: '0.4.0' });
    } finally {
      await backend.close();
    }
  });

  it('reports a backend that refuses the connection as down', async () => {
    const backend = await serve(() => {});
    await backend.close();

    vi.stubEnv('USERS_API_URL', backend.url);
    vi.stubEnv('POSTS_API_URL', 'http://posts-api:8000');

    const { app } = await import('../src/app');
    const res = await app.request('/api/health/users-api');

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'down' });
  });

  it('gives up on a backend that does not answer within 5 seconds', async () => {
    // Accepts the connection and never answers, like a hung process.
    const backend = await serve(() => {});
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    try {
      vi.stubEnv('USERS_API_URL', backend.url);
      vi.stubEnv('POSTS_API_URL', 'http://posts-api:8000');

      const { app } = await import('../src/app');
      const pending = Promise.resolve(app.request('/api/health/users-api'));
      await vi.advanceTimersByTimeAsync(4999);
      let settled = false;
      void pending.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      const res = await pending;

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ status: 'down' });
    } finally {
      vi.useRealTimers();
      await backend.close();
    }
  });
});
