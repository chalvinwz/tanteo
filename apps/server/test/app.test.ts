/**
 * The share server.
 *
 * The server holds one snapshot per token and hands it to whoever has the
 * link. Everything worth testing here is a boundary: who may write, what a
 * body may be, and which of two writes wins. The rule the whole design rests
 * on is that holding the share link must not grant the ability to write, so
 * that one is asserted from several directions rather than once.
 *
 * The app is driven through `app.request`, so there is no port and no socket,
 * and the clock is injected, so no assertion depends on the wall clock.
 */

import { describe, expect, it } from 'vitest';

import { createWriteToken, deriveReadToken } from '@tanteo/share';

import { createApp } from '../src/app.js';
import { createBus } from '../src/bus.js';
import { createMemoryStore } from '../src/store.js';
import type { Bus } from '../src/bus.js';

type App = ReturnType<typeof createApp>;

/** A fixed clock, so updated-at is a value to assert and not a moving target. */
const FIXED_NOW = 1_759_312_800_000;

/** The server's cap on a stored snapshot. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Opaque to the server, which is the point: it stores text and parses no
 * tournament.
 */
const BOARD = '{"round":3,"leader":"Adi","points":[21,17]}';
const LATER_BOARD = '{"round":4,"leader":"Bima","points":[21,9]}';

/**
 * Whitespace and newlines a re-serialization would quietly flatten. Posting
 * this is how "the same bytes came back" means the bytes.
 */
const AWKWARD_BOARD = '{\n  "round": 3,\n  "leader":   "Adi",\n  "points": [ 21 , 17 ]\n}';

interface Harness {
  app: App;
  bus: Bus;
  /** Never leaves the organizer's device. */
  writeToken: string;
  /** The one in the share link, and the one in every path below. */
  readToken: string;
}

async function harness(now: () => number = () => FIXED_NOW): Promise<Harness> {
  const store = createMemoryStore();
  const bus = createBus();
  const writeToken = createWriteToken();
  const readToken = await deriveReadToken(writeToken);
  return { app: createApp({ store, bus, now }), bus, writeToken, readToken };
}

/** The headers an organizer's push carries. */
function organizer(writeToken: string, revision: number): Record<string, string> {
  return { 'x-tanteo-write-token': writeToken, 'x-tanteo-revision': String(revision) };
}

async function post(
  app: App,
  token: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return await app.request(`/api/t/${token}`, { method: 'POST', headers, body });
}

async function jsonOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Read one frame from an SSE response, or give up.
 *
 * The stream is endless by design, so a test that simply awaits it would hang
 * until the runner gives up, which is worse than a failure. This takes the
 * first chunk or the timeout, whichever lands first, and always releases the
 * reader.
 */
async function firstFrame(stream: ReadableStream<Uint8Array>, ms: number): Promise<string | null> {
  const reader = stream.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });

  try {
    const frame = await Promise.race([reader.read(), giveUp]);
    if (frame === null || frame.done) return null;
    return new TextDecoder().decode(frame.value);
  } finally {
    if (timer) clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
  }
}

describe('the server answers before there is anything to say', () => {
  it('reports health', async () => {
    const { app } = await harness();

    const response = await app.request('/api/health');

    expect(response.status).toBe(200);
    expect(await jsonOf(response)).toEqual({ ok: true });
  });

  it('answers a GET for an unknown token with 404 and a JSON body', async () => {
    const { app } = await harness();
    const unknown = await deriveReadToken(createWriteToken());

    const response = await app.request(`/api/t/${unknown}`);

    // A viewer who opens an old link needs a shaped answer to render "no such
    // board" from, not a stack trace and not an empty 200.
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await jsonOf(response)).toEqual({ error: 'no such board' });
  });
});

describe('the organizer pushes, the link reads', () => {
  it('stores the snapshot and hands back the same bytes', async () => {
    const { app, writeToken, readToken } = await harness();

    const push = await post(app, readToken, AWKWARD_BOARD, organizer(writeToken, 7));
    const read = await app.request(`/api/t/${readToken}`);

    expect(push.status).toBe(200);
    expect(await jsonOf(push)).toEqual({ accepted: true, revision: 7 });
    expect(read.status).toBe(200);
    expect(await read.text()).toBe(AWKWARD_BOARD);
    expect(read.headers.get('content-type')).toContain('application/json');
  });

  it('carries the revision and the write time in the read headers', async () => {
    const { app, writeToken, readToken } = await harness();

    await post(app, readToken, BOARD, organizer(writeToken, 7));
    const read = await app.request(`/api/t/${readToken}`);

    expect(read.headers.get('x-tanteo-revision')).toBe('7');
    expect(read.headers.get('x-tanteo-updated-at')).toBe(String(FIXED_NOW));
    // A cached board on a screen at the venue is a frozen board.
    expect(read.headers.get('cache-control')).toBe('no-store');
  });

  it('stamps each accepted write with the clock at that moment', async () => {
    let clock = FIXED_NOW;
    const { app, writeToken, readToken } = await harness(() => clock);

    await post(app, readToken, BOARD, organizer(writeToken, 1));
    clock = FIXED_NOW + 90_000;
    await post(app, readToken, LATER_BOARD, organizer(writeToken, 2));
    const read = await app.request(`/api/t/${readToken}`);

    expect(await read.text()).toBe(LATER_BOARD);
    expect(read.headers.get('x-tanteo-updated-at')).toBe(String(FIXED_NOW + 90_000));
  });

  it('treats a missing revision header as revision zero', async () => {
    const { app, writeToken, readToken } = await harness();

    const push = await post(app, readToken, BOARD, { 'x-tanteo-write-token': writeToken });

    expect(push.status).toBe(200);
    expect(await jsonOf(push)).toEqual({ accepted: true, revision: 0 });
  });
});

describe('holding the share link is not holding the pen', () => {
  it('refuses a write signed with the read token itself', async () => {
    const { app, readToken } = await harness();

    // This is the whole design in one assertion: everyone in the group chat has
    // this token, and it must buy nothing but reading.
    const push = await post(app, readToken, BOARD, organizer(readToken, 1));

    expect(push.status).toBe(403);
    expect(await jsonOf(push)).toEqual({ error: 'wrong write token' });

    const read = await app.request(`/api/t/${readToken}`);
    expect(read.status).toBe(404);
  });

  it('refuses a read-token write against a board that already exists', async () => {
    const { app, writeToken, readToken } = await harness();
    await post(app, readToken, BOARD, organizer(writeToken, 1));

    const push = await post(app, readToken, LATER_BOARD, organizer(readToken, 2));
    const read = await app.request(`/api/t/${readToken}`);

    expect(push.status).toBe(403);
    // A spectator cannot rewrite the scoreboard behind the organizer's back.
    expect(await read.text()).toBe(BOARD);
    expect(read.headers.get('x-tanteo-revision')).toBe('1');
  });

  it('refuses a write token that belongs to some other board', async () => {
    const { app, readToken } = await harness();
    const stranger = createWriteToken();

    const push = await post(app, readToken, BOARD, organizer(stranger, 1));

    expect(push.status).toBe(403);
  });

  it('refuses a write with no write token at all', async () => {
    const { app, readToken } = await harness();

    const push = await post(app, readToken, BOARD, { 'x-tanteo-revision': '1' });

    expect(push.status).toBe(401);
    expect(await jsonOf(push)).toEqual({ error: 'missing write token' });
  });

  it('refuses a write whose token header is not token-shaped', async () => {
    const { app, readToken } = await harness();

    const push = await post(app, readToken, BOARD, {
      'x-tanteo-write-token': 'nope',
      'x-tanteo-revision': '1',
    });

    expect(push.status).toBe(401);
  });
});

describe('a malformed token never reaches the store', () => {
  const malformed: ReadonlyArray<readonly [string, string]> = [
    ['a token too short to be one of ours', 'short'],
    ['a token too long to be one of ours', 'a'.repeat(65)],
    ['a percent-encoded traversal', '..%2F..%2Fetc%2Fpasswd'],
    ['a token wearing dots', '..aaaaaaaaaaaaaaaaaaaa'],
    ['a token wearing a plus', 'aaaaaaaa+aaaaaaaaaaaa'],
  ];

  for (const [why, token] of malformed) {
    it(`rejects a write to ${why} with 400`, async () => {
      const { app, writeToken } = await harness();

      const push = await post(app, token, BOARD, organizer(writeToken, 1));

      expect(push.status).toBe(400);
      expect(await jsonOf(push)).toEqual({ error: 'malformed token' });
    });

    it(`rejects a read of ${why} with 400`, async () => {
      const { app } = await harness();

      const read = await app.request(`/api/t/${token}`);

      // 400 and not 404: the path was never a token, so there is nothing to
      // look up and nothing to reveal about which tokens exist.
      expect(read.status).toBe(400);
    });
  }

  it('rejects a stream for a malformed token with 400', async () => {
    const { app } = await harness();

    const response = await app.request('/api/t/..%2F..%2Fetc%2Fpasswd/stream');

    expect(response.status).toBe(400);
    expect(await jsonOf(response)).toEqual({ error: 'malformed token' });
  });
});

describe('the body has to be a snapshot', () => {
  it('rejects a body that is not JSON', async () => {
    const { app, writeToken, readToken } = await harness();

    const push = await post(app, readToken, 'game to Adi', organizer(writeToken, 1));

    expect(push.status).toBe(400);
    expect(await jsonOf(push)).toEqual({ error: 'body is not json' });
  });

  it('rejects an empty body', async () => {
    const { app, writeToken, readToken } = await harness();

    const push = await post(app, readToken, '', organizer(writeToken, 1));

    expect(push.status).toBe(400);
    expect(await jsonOf(push)).toEqual({ error: 'body is not json' });
  });

  it('rejects a body over 256KB and stores nothing', async () => {
    const { app, writeToken, readToken } = await harness();
    const oversized = `{"pad":"${'a'.repeat(MAX_BODY_BYTES)}"}`;

    const push = await post(app, readToken, oversized, organizer(writeToken, 1));
    const read = await app.request(`/api/t/${readToken}`);

    expect(push.status).toBe(413);
    expect(await jsonOf(push)).toEqual({ error: 'snapshot too large' });
    expect(read.status).toBe(404);
  });

  it('rejects a declared content-length over 256KB before reading the body', async () => {
    const { app, writeToken, readToken } = await harness();

    const push = await post(app, readToken, BOARD, {
      ...organizer(writeToken, 1),
      'content-length': String(MAX_BODY_BYTES + 1),
    });

    expect(push.status).toBe(413);
  });

  it('rejects a revision that is not a number', async () => {
    const { app, writeToken, readToken } = await harness();

    const push = await post(app, readToken, BOARD, {
      'x-tanteo-write-token': writeToken,
      'x-tanteo-revision': 'later',
    });

    expect(push.status).toBe(400);
    expect(await jsonOf(push)).toEqual({ error: 'bad revision' });
  });

  it('rejects a negative revision', async () => {
    const { app, writeToken, readToken } = await harness();

    const push = await post(app, readToken, BOARD, organizer(writeToken, -1));

    expect(push.status).toBe(400);
  });
});

describe('the newest revision wins, whatever order it arrives in', () => {
  it('refuses a stale write without calling it an error', async () => {
    let clock = FIXED_NOW;
    const { app, writeToken, readToken } = await harness(() => clock);

    await post(app, readToken, BOARD, organizer(writeToken, 5));
    clock = FIXED_NOW + 60_000;
    // A push queued while the organizer's phone was offline, arriving late.
    const stale = await post(app, readToken, LATER_BOARD, organizer(writeToken, 3));
    const read = await app.request(`/api/t/${readToken}`);

    // Not an error: the client did nothing wrong, its news is just old.
    expect(stale.status).toBe(200);
    expect(await jsonOf(stale)).toEqual({ accepted: false, revision: 3 });
    expect(await read.text()).toBe(BOARD);
    expect(read.headers.get('x-tanteo-revision')).toBe('5');
    // The board did not get younger by being written to and refused.
    expect(read.headers.get('x-tanteo-updated-at')).toBe(String(FIXED_NOW));
  });

  it('accepts an equal revision, because a retry of the same push is harmless', async () => {
    const { app, writeToken, readToken } = await harness();

    await post(app, readToken, BOARD, organizer(writeToken, 5));
    const retry = await post(app, readToken, LATER_BOARD, organizer(writeToken, 5));
    const read = await app.request(`/api/t/${readToken}`);

    expect(retry.status).toBe(200);
    expect(await jsonOf(retry)).toEqual({ accepted: true, revision: 5 });
    expect(await read.text()).toBe(LATER_BOARD);
  });
});

describe('live viewers', () => {
  it('opens an event stream and sends the current board as the first frame', async () => {
    const { app, writeToken, readToken } = await harness();
    await post(app, readToken, BOARD, organizer(writeToken, 1));

    const abort = new AbortController();
    const response = await app.request(`/api/t/${readToken}/stream`, { signal: abort.signal });
    const stream = response.body;
    if (!stream) throw new Error('the stream came back with no body');

    const frame = await firstFrame(stream, 2_000);
    // Let the server drop its heartbeat and its subscription, so the test does
    // not leave a timer behind.
    abort.abort();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(frame).toContain('event: snapshot');
    expect(frame).toContain(`data: ${BOARD}`);
  });

  it('opens an event stream for a board with nothing in it yet and waits quietly', async () => {
    const { app, readToken } = await harness();

    const abort = new AbortController();
    const response = await app.request(`/api/t/${readToken}/stream`, { signal: abort.signal });
    const stream = response.body;
    if (!stream) throw new Error('the stream came back with no body');

    const frame = await firstFrame(stream, 200);
    abort.abort();

    // Open, but with nothing to say. The viewer shows its waiting state rather
    // than an error, and the stream is there when the organizer pushes.
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(frame).toBeNull();
  });

  it('fans an accepted write out to a subscriber', async () => {
    const { app, bus, writeToken, readToken } = await harness();
    const seen: string[] = [];
    const unsubscribe = bus.subscribe(readToken, (payload) => {
      seen.push(payload);
    });

    const push = await post(app, readToken, BOARD, organizer(writeToken, 5));

    expect(push.status).toBe(200);
    expect(seen).toEqual([BOARD]);
    unsubscribe();
  });

  it('sends a refused stale write to nobody', async () => {
    const { app, bus, writeToken, readToken } = await harness();
    await post(app, readToken, BOARD, organizer(writeToken, 5));
    const seen: string[] = [];
    const unsubscribe = bus.subscribe(readToken, (payload) => {
      seen.push(payload);
    });

    await post(app, readToken, LATER_BOARD, organizer(writeToken, 3));

    // A viewer must never be shown a board the store itself refused.
    expect(seen).toEqual([]);
    unsubscribe();
  });

  it('drops the subscription when the viewer goes away', async () => {
    const { app, bus, readToken } = await harness();

    const abort = new AbortController();
    const response = await app.request(`/api/t/${readToken}/stream`, { signal: abort.signal });
    const stream = response.body;
    if (!stream) throw new Error('the stream came back with no body');

    // A viewer is on the board.
    expect(bus.size(readToken)).toBe(1);

    // Reading and then dropping the stream is what a closed tab looks like.
    await firstFrame(stream, 50);
    abort.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Nothing left behind: no subscriber, and with it no heartbeat timer. A
    // server that ran all evening would otherwise collect one of each per
    // spectator who ever opened the link.
    expect(bus.size(readToken)).toBe(0);
  });
});
