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
única tecnología, y este es el servicio con menos costo para cumplirlo ya - ver la discusión en
`#48`.

## Levantarlo en desarrollo

```bash
docker compose -f docker/docker-compose.dev.yml up --build
```

Requiere `USERS_API_URL` y `POSTS_API_URL` apuntando a donde estén corriendo esos dos servicios.
Por default asume que corren en el host con sus propios `docker-compose.dev.yml`
(`users-api` en `8000`, `posts-api` en `8001`); este servicio usa `8002`. Sin esas dos variables,
cualquier request a `/api/*` responde con error - `/healthcheck` y `/livez` no las necesitan.

```bash
curl http://localhost:8002/healthcheck
```

Responde `200` con `{"status": "ok"}`. A diferencia de los demás servicios, no verifica ninguna
dependencia porque no tiene ninguna propia.

## Ruteo

| Prefijo                              | Va a        |
| ------------------------------------ | ----------- |
| `/api/auth`, `/api/me`, `/api/admin` | `users-api` |
| `/api/users`, `/api/follow-requests` | `posts-api` |

Cualquier otro path bajo `/api` responde `404`. La tabla vive solamente en `src/routing.ts`:
el Ingress de plataforma envía todo `/api` al Service `api-gateway:80`. El proxy conserva
el prefijo `/api`, la query y el encabezado de autorización. Las URLs base no llevan `/api`.

## Configuración

| Variable        | Default                  | Para qué                         |
| --------------- | ------------------------ | -------------------------------- |
| `USERS_API_URL` | sin definir, obligatoria | Base URL de `users-api`          |
| `POSTS_API_URL` | sin definir, obligatoria | Base URL de `posts-api`          |
| `PORT`          | `8000`                   | Puerto donde escucha el servicio |

## Despliegue en Kubernetes

Los manifiestos de `k8s/` usan `tds-group-3`: Deployment, Service, ConfigMap y NetworkPolicy. No se crea
un Secret vacío: este servicio no consume credenciales. Nunca versionar un eventual
`k8s/secret.yaml` real.

- El pipeline sustituye `${ECR_IMAGE}` por la imagen publicada en ECR, referenciada por
  digest. Kubernetes no expande variables.
- El Service expone `80` hacia el puerto nombrado `http` del contenedor (`8000`).
- `USERS_API_URL=http://users-api` y `POSTS_API_URL=http://posts-api` usan DNS del namespace.
- Una réplica pide `100m` / `128Mi` y tiene límites de `500m` / `512Mi`.
- La NetworkPolicy le abre el gateway al ALB, desde sus dos subredes. El resto del namespace
  solo acepta tráfico interno por la política de `udesa-x-platform`. Hoy ninguna de las dos
  filtra: el cluster tiene la aplicación de NetworkPolicy apagada.
- `maxSurge: 1` y `maxUnavailable: 0` mantienen el pod anterior hasta que el nuevo esté
  listo. Requiere un slot libre y cuota de CPU/memoria; no garantiza alta disponibilidad.
- Readiness consulta `/healthcheck`; liveness consulta `/livez`. No verifican las APIs:
  un gateway sano no demuestra que login o follow funcionen.
- `envFrom` se lee al crear el contenedor. El pipeline pone el hash del ConfigMap en el pod
  template, así que cambiarlo también reemplaza los pods aunque la imagen sea la misma.

Cada push a `main` que pasa el CI despliega solo, con el job `deploy` de
`.github/workflows/ci.yml`, que llama a `deploy.yml` de `udesa-x-platform`. Aplica
ConfigMap, Service y Deployment, espera el rollout y, si no converge, vuelve a la versión
anterior. No toca el Ingress: lo aplica el docente, y el gateway tiene que estar listo antes
de habilitar la entrada pública. Qué hace paso por paso está en el README de
`udesa-x-platform`, sección "Despliegue continuo".

## Correr los tests

```bash
bun install
bun run test            # rutas, salud y proxy contra un servidor HTTP local
bun run test:coverage   # con reporte de cobertura
```

Ningún test necesita `users-api` ni `posts-api` corriendo: usan `app.request()`, el helper
de Hono, y un servidor HTTP efímero en loopback para comprobar el proxy y su query.
La verificación del release también debe ejercitar login y follow contra las imágenes
reales de ambas APIs; los tests aislados no sustituyen ese smoke.

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
