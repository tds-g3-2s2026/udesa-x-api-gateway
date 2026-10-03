import type { BackendConfig } from './config';

// The shared Ingress sends all of /api here. Backend routing lives only here.
// First match wins, so a narrower prefix goes before the one that contains it.
const ROUTE_PREFIXES: Array<[prefix: string, backend: keyof BackendConfig]> = [
  ['/api/auth', 'usersApiUrl'],
  ['/api/me', 'usersApiUrl'],
  ['/api/admin/posts', 'postsApiUrl'],
  ['/api/admin', 'usersApiUrl'],
  ['/api/users', 'postsApiUrl'],
  ['/api/follow-requests', 'postsApiUrl'],
  ['/api/posts', 'postsApiUrl'],
  ['/api/feed', 'postsApiUrl'],
  ['/api/blocks', 'postsApiUrl'],
  ['/api/reports', 'postsApiUrl'],
];

// Backends whose health is readable from outside the cluster as /api/health/<name>.
export const HEALTH_TARGETS = new Map<string, keyof BackendConfig>([
  ['users-api', 'usersApiUrl'],
  ['posts-api', 'postsApiUrl'],
]);

/** Returns the backend base URL for a request path, or undefined if unmatched. */
export function resolveBackend(path: string, config: BackendConfig): string | undefined {
  for (const [prefix, backend] of ROUTE_PREFIXES) {
    if (path.startsWith(prefix)) {
      return config[backend];
    }
  }
  return undefined;
}
