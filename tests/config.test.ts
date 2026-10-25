import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';

const URLS = {
  USERS_API_URL: 'http://users-api:8000',
  POSTS_API_URL: 'http://posts-api:8000',
  NOTIFICATIONS_API_URL: 'http://notifications-api:8000',
};

describe('loadConfig', () => {
  it('returns every backend URL when set', () => {
    expect(loadConfig(URLS)).toEqual({
      usersApiUrl: 'http://users-api:8000',
      postsApiUrl: 'http://posts-api:8000',
      notificationsApiUrl: 'http://notifications-api:8000',
    });
  });

  it.each(Object.keys(URLS))('throws when %s is missing', (name) => {
    expect(() => loadConfig({ ...URLS, [name]: undefined })).toThrow(
      'USERS_API_URL, POSTS_API_URL and NOTIFICATIONS_API_URL must all be set'
    );
  });
});
