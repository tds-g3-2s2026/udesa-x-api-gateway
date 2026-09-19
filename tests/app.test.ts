import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('GET /healthcheck', () => {
  it('returns ok without needing any backend configured', async () => {
    const { app } = await import('../src/app');
    const res = await app.request('/healthcheck');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
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

    await new Promise<void>((resolve) => fakeUsersApi.listen(0, resolve));
    const { port } = fakeUsersApi.address() as AddressInfo;

    try {
      vi.stubEnv('USERS_API_URL', `http://localhost:${port}`);
      vi.stubEnv('POSTS_API_URL', 'http://posts-api:8000');

      const { app } = await import('../src/app');
      const res = await app.request('/api/me');

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ receivedPath: '/api/me', method: 'GET' });
    } finally {
      await new Promise<void>((resolve) => fakeUsersApi.close(() => resolve()));
    }
  });
});
