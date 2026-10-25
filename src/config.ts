export interface BackendConfig {
  usersApiUrl: string;
  postsApiUrl: string;
  notificationsApiUrl: string;
}

// No defaults on purpose: a missing backend URL stops the request from
// resolving, instead of silently forwarding it nowhere. Read lazily inside
// the proxy handler (not at import time) so /healthcheck works without them.
export function loadConfig(env: Record<string, string | undefined> = process.env): BackendConfig {
  const usersApiUrl = env.USERS_API_URL;
  const postsApiUrl = env.POSTS_API_URL;
  const notificationsApiUrl = env.NOTIFICATIONS_API_URL;
  if (!usersApiUrl || !postsApiUrl || !notificationsApiUrl) {
    throw new Error('USERS_API_URL, POSTS_API_URL and NOTIFICATIONS_API_URL must all be set');
  }
  return { usersApiUrl, postsApiUrl, notificationsApiUrl };
}
