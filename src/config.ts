export interface BackendConfig {
  usersApiUrl: string;
  postsApiUrl: string;
}

// No defaults on purpose: a missing backend URL stops the request from
// resolving, instead of silently forwarding it nowhere. Read lazily inside
// the proxy handler (not at import time) so /healthcheck works without them.
export function loadConfig(env: Record<string, string | undefined> = process.env): BackendConfig {
  const usersApiUrl = env.USERS_API_URL;
  const postsApiUrl = env.POSTS_API_URL;
  if (!usersApiUrl || !postsApiUrl) {
    throw new Error('USERS_API_URL and POSTS_API_URL must both be set');
  }
  return { usersApiUrl, postsApiUrl };
}
