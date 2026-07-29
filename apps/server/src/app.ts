import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { RateLimiter } from './ratelimit.js';
import { RoomRegistry } from './rooms.js';
import { SignalingHub } from './signaling.js';
import { turnConfigFromEnv } from './turn.js';

type Bindings = { incoming: IncomingMessage };

export function buildApp() {
  const rooms = new RoomRegistry();
  const limiter = new RateLimiter();
  const hub = new SignalingHub(rooms, limiter, turnConfigFromEnv());

  const app = new Hono<{ Bindings: Bindings }>();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.get('/healthz', (c) => c.json({ ok: true, rooms: rooms.size }));

  app.get(
    '/ws',
    upgradeWebSocket((c) => {
      // Deployed behind the self-hoster's reverse proxy, so trust XFF.
      const ip =
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
        c.env.incoming.socket.remoteAddress ??
        'unknown';
      let conn: ReturnType<SignalingHub['connect']> | null = null;
      return {
        onOpen(_evt, ws) {
          conn = hub.connect(
            {
              send: (data) => ws.send(data),
              close: () => ws.close(),
            },
            ip,
          );
        },
        onMessage(evt) {
          if (conn && typeof evt.data === 'string') hub.message(conn, evt.data);
        },
        onClose() {
          if (conn) hub.close(conn);
        },
      };
    }),
  );

  // In production the built web app is served from PUBLIC_DIR.
  const publicDir = process.env.PUBLIC_DIR;
  if (publicDir) {
    const root = path.relative(process.cwd(), publicDir) || '.';
    app.use('*', serveStatic({ root }));
    app.get('*', serveStatic({ root, path: 'index.html' })); // SPA fallback
  }

  hub.startHeartbeat();
  return { app, injectWebSocket, hub };
}
