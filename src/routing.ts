import type { BackendConfig } from './config';

// Mirrors the routing table in udesa-x-platform's k8s/ingress.yaml. Keep both
// in sync until the Ingress is updated to send all of /api here instead of
// splitting it between users-api and posts-api directly.
const ROUTE_PREFIXES: Array<[prefix: string, backend: keyof BackendConfig]> = [
  ['/api/auth', 'usersApiUrl'],
  ['/api/me', 'usersApiUrl'],
  ['/api/admin', 'usersApiUrl'],
  ['/api/users', 'postsApiUrl'],
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
