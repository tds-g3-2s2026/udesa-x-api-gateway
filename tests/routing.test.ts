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

  it('returns undefined for an unmatched path', () => {
    expect(resolveBackend('/api/unknown', config)).toBeUndefined();
  });
});
