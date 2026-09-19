import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('returns both URLs when set', () => {
    const config = loadConfig({
      USERS_API_URL: 'http://users-api:8000',
      POSTS_API_URL: 'http://posts-api:8000',
    });

    expect(config).toEqual({
      usersApiUrl: 'http://users-api:8000',
      postsApiUrl: 'http://posts-api:8000',
    });
  });

  it('throws when USERS_API_URL is missing', () => {
    expect(() => loadConfig({ POSTS_API_URL: 'http://posts-api:8000' })).toThrow(
      'USERS_API_URL and POSTS_API_URL must both be set'
    );
  });

  it('throws when POSTS_API_URL is missing', () => {
    expect(() => loadConfig({ USERS_API_URL: 'http://users-api:8000' })).toThrow(
      'USERS_API_URL and POSTS_API_URL must both be set'
    );
  });
});
