import type { BackendConfig } from './config';

// The shared Ingress sends all of /api here. Backend routing lives only here.
const ROUTE_PREFIXES: Array<[prefix: string, backend: keyof BackendConfig]> = [
  ['/api/auth', 'usersApiUrl'],
  ['/api/me', 'usersApiUrl'],
  ['/api/admin', 'usersApiUrl'],
  ['/api/users', 'postsApiUrl'],
  ['/api/follow-requests', 'postsApiUrl'],
];

/** Returns the backend base URL for a request path, or undefined if unmatched. */
export function resolveBackend(path: string, config: BackendConfig): string | undefined {
  for (const [prefix, backend] of ROUTE_PREFIXES) {
    if (path.startsWith(prefix)) {
      return config[backend];
    }
  }
  return undefined;
}
