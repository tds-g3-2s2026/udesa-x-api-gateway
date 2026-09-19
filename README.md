# UdeSA-X API Gateway

Microservicio backend que rutea internamente los requests que llegan bajo `/api/*` hacia el
servicio que corresponde (`users-api` o `posts-api`). No guarda estado ni tiene base de datos
propia.

**Stack:** TypeScript, Bun, [Hono](https://hono.dev/) con su Proxy Helper. Gestión de
dependencias con Bun, testing con Vitest, linting con ESLint + Prettier.

Nace de la issue [`#48`](https://github.com/tds-g3-2s2026/udesa-x-platform/issues/48) en
`udesa-x-platform`: no corresponde a ninguna historia de usuario del catálogo de la consigna, es
infraestructura interna detrás del `Ingress` compartido del cluster. Va en TypeScript y no en
Python (como `users-api`/`posts-api`) porque la consigna exige que el backend no esté en una
única tecnología, y este es el servicio con menos costo para cumplirlo ya — ver la discusión en
`#48`.

## Levantarlo en desarrollo

```bash
docker compose -f docker/docker-compose.dev.yml up --build
```

Requiere `USERS_API_URL` y `POSTS_API_URL` apuntando a donde estén corriendo esos dos servicios.
Por default asume que corren en el host con sus propios `docker-compose.dev.yml`
(`users-api` en `8000`, `posts-api` en `8001`); este servicio usa `8002`. Sin esas dos variables,
cualquier request a `/api/*` responde con error — `/healthcheck` no las necesita.

```bash
curl http://localhost:8002/healthcheck
```

Responde `200` con `{"status": "ok"}`. A diferencia de los demás servicios, no verifica ninguna
dependencia porque no tiene ninguna propia.

## Ruteo

| Prefijo                              | Va a        |
| ------------------------------------ | ----------- |
| `/api/auth`, `/api/me`, `/api/admin` | `users-api` |
| `/api/users`                         | `posts-api` |

Cualquier otro path bajo `/api` responde `404`. La tabla vive en `src/routing.ts` y tiene que
mantenerse igual a la de `k8s/ingress.yaml` en `udesa-x-platform` mientras el `Ingress` siga
ruteando directo a cada servicio en vez de mandar todo `/api` para acá.

## Configuración

| Variable        | Default                  | Para qué                         |
| --------------- | ------------------------ | -------------------------------- |
| `USERS_API_URL` | sin definir, obligatoria | Base URL de `users-api`          |
| `POSTS_API_URL` | sin definir, obligatoria | Base URL de `posts-api`          |
| `PORT`          | `8000`                   | Puerto donde escucha el servicio |

## Correr los tests

```bash
bun install
bun run test            # tabla de ruteo y /healthcheck, sin red
bun run test:coverage   # con reporte de cobertura
```

Ningún test necesita `users-api` ni `posts-api` corriendo: usan `app.request()`, el helper de
testing propio de Hono, que ejecuta la app en memoria sin levantar un servidor real. Probar el
reenvío de punta a punta contra los dos servicios reales queda pendiente.

### Como los corre el CI: dentro de la imagen

Igual que en los demás servicios, el `Dockerfile` tiene un stage `test` que corre sobre el mismo
build que va a producción:

```bash
docker compose -f docker/docker-compose.dev.yml run --rm --build tests
```

## Lint

```bash
bun run lint
```

## Estructura

Sin capas todavía: no hay lógica de negocio que separar de la infraestructura, solo reenvío de
requests.

```text
src/
├── index.ts    # entrypoint: arranca el servidor de Bun con la app de Hono
├── app.ts      # la app de Hono: /healthcheck y el proxy hacia /api/*
├── routing.ts  # tabla de prefijo -> backend
└── config.ts   # configuración leída del entorno
tests/
├── routing.test.ts  # tabla de ruteo, sin dependencias externas
└── app.test.ts      # /healthcheck y 404, con la app en memoria
docker/
├── Dockerfile
└── docker-compose.dev.yml
```
