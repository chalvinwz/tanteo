import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { deriveReadToken, isWellFormedToken, timingSafeEqual } from '@tanteo/share';

import type { Bus } from './bus.js';
import type { SnapshotStore } from './store.js';

/**
 * The share server.
 *
 * It does one job: hold the organizer's latest snapshot for a token and hand it
 * to anyone with the link. There is no merge logic and no notion of a
 * tournament here. The body is opaque text, which is what keeps the engine the
 * only place the rules live.
 */

/**
 * A snapshot is small (a few players, a few rounds of small integers). This cap
 * is far above a real tournament and exists so an unauthenticated endpoint
 * cannot be used to fill the disk.
 */
const MAX_BODY_BYTES = 256 * 1024;

/** Comment frames keep proxies from closing an idle stream. */
const HEARTBEAT_MS = 25_000;

export interface AppOptions {
  store: SnapshotStore;
  bus: Bus;
  /** Injected so tests do not depend on the wall clock. */
  now?: () => number;
}

export function createApp({ store, bus, now = () => Date.now() }: AppOptions): Hono {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));

  /** Read the current board. The only thing a share link can do. */
  app.get('/api/t/:token', (c) => {
    const token = c.req.param('token');
    if (!isWellFormedToken(token)) return c.json({ error: 'malformed token' }, 400);

    const snapshot = store.get(token);
    if (!snapshot) return c.json({ error: 'no such board' }, 404);

    c.header('cache-control', 'no-store');
    c.header('x-tanteo-revision', String(snapshot.revision));
    c.header('x-tanteo-updated-at', String(snapshot.updatedAt));
    return c.body(snapshot.body, 200, { 'content-type': 'application/json' });
  });

  /**
   * Push a snapshot. Only the organizer can do this: the path carries the
   * public read token, and the header must carry the write token whose SHA-256
   * is that read token. Holding the share link is therefore not enough.
   */
  app.post('/api/t/:token', async (c) => {
    const token = c.req.param('token');
    if (!isWellFormedToken(token)) return c.json({ error: 'malformed token' }, 400);

    const writeToken = c.req.header('x-tanteo-write-token');
    if (!writeToken || !isWellFormedToken(writeToken)) {
      return c.json({ error: 'missing write token' }, 401);
    }
    const derived = await deriveReadToken(writeToken);
    if (!timingSafeEqual(derived, token)) return c.json({ error: 'wrong write token' }, 403);

    const declared = c.req.header('content-length');
    if (declared && Number(declared) > MAX_BODY_BYTES) {
      return c.json({ error: 'snapshot too large' }, 413);
    }

    const body = await c.req.text();
    // Re-check after reading: content-length can be absent on a chunked body.
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
      return c.json({ error: 'snapshot too large' }, 413);
    }
    // The server does not interpret the tournament, but it must not store
    // something a viewer will choke on, so this is a parse check and nothing
    // more: the result is thrown away and the original text is what is stored.
    try {
      JSON.parse(body);
    } catch {
      return c.json({ error: 'body is not json' }, 400);
    }

    const revision = Number(c.req.header('x-tanteo-revision') ?? '0');
    if (!Number.isFinite(revision) || revision < 0) {
      return c.json({ error: 'bad revision' }, 400);
    }

    const accepted = store.put(token, { body, revision, updatedAt: now() });
    // A refused write is not an error: it means a queued retry arrived after a
    // newer push, and the newer one is correct. Say so rather than failing.
    if (accepted) bus.publish(token, body);
    return c.json({ accepted, revision }, 200);
  });

  /** Live updates. The web app falls back to polling when this is unavailable. */
  app.get('/api/t/:token/stream', (c) => {
    const token = c.req.param('token');
    if (!isWellFormedToken(token)) return c.json({ error: 'malformed token' }, 400);

    return streamSSE(c, async (stream) => {
      // Send what we have immediately, so a viewer never stares at an empty
      // board waiting for the organizer's next tap.
      const initial = store.get(token);
      if (initial) {
        await stream.writeSSE({ event: 'snapshot', data: initial.body });
      }

      let push: ((payload: string) => void) | undefined;
      const queue: string[] = [];
      const unsubscribe = bus.subscribe(token, (payload) => {
        if (push) push(payload);
        else queue.push(payload);
      });

      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: 'ping', data: String(now()) });
      }, HEARTBEAT_MS);

      stream.onAbort(() => {
        clearInterval(heartbeat);
        unsubscribe();
      });

      try {
        // Hold the stream open, writing whatever the bus hands us.
        for (;;) {
          const next =
            queue.shift() ??
            (await new Promise<string>((resolve) => {
              push = resolve;
            }));
          push = undefined;
          if (stream.aborted || stream.closed) break;
          await stream.writeSSE({ event: 'snapshot', data: next });
        }
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
      }
    });
  });

  return app;
}
