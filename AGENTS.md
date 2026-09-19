# AGENTS.md - udesa-x-api-gateway

<!-- INICIO BLOQUE PROPIO - completado en cada servicio -->

Ruteo interno de requests hacia los microservicios backend (`users-api`, `posts-api`). Recibe
todo lo que entra bajo `/api/*` y lo reenvía al servicio que corresponda, según la tabla en
`src/routing.ts`. No tiene épica ni historia de usuario propia en el catálogo de la consigna:
nace de `#48` en `udesa-x-platform`, como pieza de infraestructura interna detrás del `Ingress`
compartido del cluster (`#44`, `#45`).

**Por qué TypeScript y no Python, como `users-api`/`posts-api`.** La consigna exige que el
backend no esté en una única tecnología, y el segundo lenguaje planeado (`notifications-api` en
NestJS) no llega hasta S7 — el mismo día de la entrega intermedia. Este servicio no tiene lógica
de dominio que traducir, así que es el lugar más barato para cumplir el requisito ya. Discutido
en `#48`.

## Stack y herramientas

- Lenguaje y runtime: TypeScript / Bun / Hono, con su Proxy Helper para reenviar los requests
- Gestor de paquetes: Bun
- Persistencia: ninguna. Este servicio no guarda estado propio.

## Checks y comandos

```bash
bun install
bun run test           # tabla de ruteo y /healthcheck, sin red
bun run lint            # ESLint + Prettier
bun run build           # tsc --noEmit
```

## Arquitectura y particularidades locales

- Todo el código vive en módulos sueltos (`app.ts`, `routing.ts`, `config.ts`, `index.ts`): no
  hay capas todavía porque no hay lógica de negocio que separar, solo reenvío de requests.
- La tabla de ruteo en `routing.ts` tiene que mantenerse igual a la de `k8s/ingress.yaml` en
  `udesa-x-platform` (issue `#45`) mientras el `Ingress` siga ruteando directo a cada servicio.
  El objetivo es que, una vez desplegado este servicio, el `Ingress` pase a mandar todo `/api`
  para acá.
- `USERS_API_URL` y `POSTS_API_URL` no tienen default: sin las dos, cualquier request a `/api/*`
  responde con un error. `/healthcheck` no las necesita.
- Documentación general del sistema: consultar `../udesa-x-platform/docs/` (`ARQUITECTURA.md`,
  `CONVENCIONES.md`, `PLANIFICACION.md`).

<!-- FIN BLOQUE PROPIO -->

<!-- INICIO BLOQUE COMUN - sincronizado desde udesa-x-platform, no editar la copia local -->

## Reglas del equipo

- **Ramas e issues**: Rama base `main`. Ramas de trabajo `feature-<nombre>` (funcionalidad), `fix-<nombre>` (defecto) o `chore-<nombre>` (mantenimiento y tooling, etiqueta `tech debt`), siempre asociadas a un issue en el mismo repositorio.
- **Idiomas**:
  - Código (`src/`, `tests/`), nombres de archivos, identificadores y comentarios en código: **inglés**.
  - Documentación (`docs/`, `README.md`), mensajes de commit y Pull Requests: **español**.
- **Commits**: Formato Conventional Commits (`feat:`, `fix:`, `docs:`, etc.) con descripción en español.
- **Simplicidad**: Soluciones mínimas y directas para el criterio de aceptación. No introducir librerías, patrones ni abstracciones nuevas sin un ADR aprobado en `docs/adr/`.

## Límites y flujo de trabajo del agente

- El agente inspecciona el repositorio (`git status`, `git diff`), edita archivos en el working tree, ejecuta checks locales y redacta propuestas de commit y PR.
- **El agente nunca commitea, pushea ni abre/aprueba/mergea Pull Requests.** La revisión y confirmación en Git la realiza siempre un integrante del equipo.
- **Sin firmas**: Nunca agregar `Co-Authored-By`, firmas o menciones del agente en commits, PRs ni código.

## Modo de planificación

- Planes extremadamente concisos: priorizar brevedad y concreción por sobre prosa formal.
- Al final de cada plan, incluir la lista de preguntas o dudas pendientes a resolver (si las hay).

## Skills (.agents/skills/)

- `explicar-implementacion`: Genera la explicación detallada del cambio para incluir en la descripción del PR.
- `revisar-pr`: Guía paso a paso para la revisión técnica de Pull Requests.

<!-- FIN BLOQUE COMUN -->
