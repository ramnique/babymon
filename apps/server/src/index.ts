import { serve } from '@hono/node-server';
import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 8080);
const { app, injectWebSocket } = buildApp();

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`babymon server listening on :${info.port}`);
});
injectWebSocket(server);
