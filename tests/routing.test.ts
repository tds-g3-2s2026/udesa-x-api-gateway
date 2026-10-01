import { describe, expect, it } from 'vitest';

import type { BackendConfig } from '../src/config';
import { resolveBackend } from '../src/routing';

const config: BackendConfig = {
  usersApiUrl: 'http://users-api:8000',
  postsApiUrl: 'http://posts-api:8000',
};

describe('resolveBackend', () => {
  it('routes /api/auth to users-api', () => {
    expect(resolveBackend('/api/auth/login', config)).toBe('http://users-api:8000');
  });

  it('routes /api/me to users-api', () => {
    expect(resolveBackend('/api/me', config)).toBe('http://users-api:8000');
  });

  it('routes /api/admin to users-api', () => {
    expect(resolveBackend('/api/admin/reports', config)).toBe('http://users-api:8000');
  });

  it('routes /api/users to posts-api', () => {
    expect(resolveBackend('/api/users/42', config)).toBe('http://posts-api:8000');
  });

  it('routes follow requests and their actions to posts-api', () => {
    expect(resolveBackend('/api/follow-requests', config)).toBe(config.postsApiUrl);
    expect(resolveBackend('/api/follow-requests/42/approve', config)).toBe(config.postsApiUrl);
  });

  it('routes posts and a single post to posts-api', () => {
    expect(resolveBackend('/api/posts', config)).toBe(config.postsApiUrl);
    expect(resolveBackend('/api/posts/42', config)).toBe(config.postsApiUrl);
  });

  it('routes the feed and its next pages to posts-api', () => {
    expect(resolveBackend('/api/feed', config)).toBe(config.postsApiUrl);
    expect(resolveBackend('/api/feed?cursor=abc', config)).toBe(config.postsApiUrl);
  });

  it('routes the blocked accounts list to posts-api', () => {
    expect(resolveBackend('/api/blocks', config)).toBe(config.postsApiUrl);
  });

  it('leaves the health paths to their own route instead of forwarding them', () => {
    expect(resolveBackend('/api/health/users-api', config)).toBeUndefined();
    expect(resolveBackend('/api/health/posts-api', config)).toBeUndefined();
  });

  it('routes reports to posts-api', () => {
    expect(resolveBackend('/api/reports', config)).toBe(config.postsApiUrl);
  });

  it('never routes the internal paths of the services', () => {
    expect(resolveBackend('/internal/users/42/review', config)).toBeUndefined();
  });

  it('returns undefined for an unmatched path', () => {
    expect(resolveBackend('/api/unknown', config)).toBeUndefined();
  });
});
