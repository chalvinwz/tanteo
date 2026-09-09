import { existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

import { createApp } from './app.js';
import { createBus } from './bus.js';
import { createMemoryStore, createSqliteStore } from './store.js';

/**
 * The container entry point: one process serving the built web app and the
 * share API from the same origin, so a self-hoster runs one thing.
 */

const port = Number(process.env.PORT ?? 8080);
const dbPath = process.env.TANTEO_DB ?? './data/tanteo.sqlite';
// The built client. In the image this sits next to the server build.
const webRoot = process.env.TANTEO_WEB_ROOT ?? './public';

const store =
  dbPath === ':memory:'
    ? createMemoryStore()
    : (mkdirSync(dirname(dbPath), { recursive: true }), createSqliteStore(dbPath));

const app = createApp({ store, bus: createBus() });

if (existsSync(webRoot)) {
  app.use('/*', serveStatic({ root: webRoot }));
  // The client owns its routes, so any non-API path that is not a real file
  // falls back to the app shell. Without this, opening a share link directly
  // would 404 instead of loading the live view.
  app.get('/*', serveStatic({ path: join(webRoot, 'index.html') }));
} else {
  console.warn(`no web build at ${webRoot}; serving the API only`);
}

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`tanteo listening on :${info.port}`);
});

// Containers get SIGTERM. Close the socket and the database rather than
// leaving a WAL file that has to be recovered on the next start.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
