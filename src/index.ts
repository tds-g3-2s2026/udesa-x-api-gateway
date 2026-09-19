import { app } from './app';

const port = Number(process.env.PORT ?? 8000);

// Bun's own runner starts an HTTP server from this shape when the file is
// run directly (`bun run src/index.ts`); nothing extra needed to listen.
export default {
  port,
  fetch: app.fetch,
};
