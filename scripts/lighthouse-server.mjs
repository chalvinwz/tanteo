#!/usr/bin/env node
/**
 * Start the built app for Lighthouse, with one share link already on it.
 *
 * `pnpm run start:local` on its own is enough to audit the organizer app, but
 * not the live view: a fresh `:memory:` server holds no snapshot, so
 * `/t/<token>` would render "No board on this link" and Lighthouse would score
 * an error state rather than the board. This starts the same server and then
 * pushes one real tournament, so the share URL under test is a board with
 * standings, courts and a leader on it.
 *
 * The snapshot is built by the engine, not typed out here. A hand-written
 * fixture would be a second implementation of the rules, which is the thing
 * CLAUDE.md exists to prevent.
 *
 * Usage:  node scripts/lighthouse-server.mjs
 *         PORT=8080 node scripts/lighthouse-server.mjs
 *         node scripts/lighthouse-server.mjs --then <command> [args...]
 *
 * Prints "tanteo ready for lighthouse on :<port>" once the board is live.
 * `lighthouserc.json` waits on that line, so nothing is audited early.
 *
 * With `--then`, the rest of the argv is run once the board is up and the
 * server is torn down after it, exiting with that command's code. That is how
 * `pnpm run lighthouse` gets the installability check onto a live server
 * without a second copy of the start-and-seed dance.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// A path, not the '@tanteo/engine' specifier: this script lives at the
// workspace root, which does not depend on the engine, and adding a root
// dependency just so a CI helper can import it would be the wrong trade.
// Requires `pnpm build` first, same as the server it starts.
import { createTournament, generateNextRound, recordScore } from '../packages/engine/dist/index.js';

/** The workspace root, so this runs the same from any working directory. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const PORT = process.env['PORT'] ?? '8080';
const ORIGIN = `http://localhost:${PORT}`;

/**
 * A fixed write token, so `lighthouserc.json` can name the share URL as a
 * constant instead of computing one.
 *
 * Safe because of what it is attached to, not because it is secret: this
 * script only ever runs against an in-memory database in a throwaway process,
 * and the token is published here in the open. Never reuse it for a real
 * deployment; the organizer app mints 32 random bytes per tournament.
 */
const WRITE_TOKEN = 'tanteo-lighthouse-ci-fixed-write-token';

/** SHA-256 of the write token, base64url. Same derivation as packages/share. */
function deriveReadToken(writeToken) {
  return createHash('sha256')
    .update(writeToken, 'utf8')
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const READ_TOKEN = deriveReadToken(WRITE_TOKEN);

/** How long the server gets to answer /api/health before this gives up. */
const READY_TIMEOUT_MS = 30_000;
const POLL_MS = 200;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- */

/**
 * A tournament that has actually been played a bit.
 *
 * Eight players on two courts, round one drawn and both courts scored, so the
 * live view under audit renders a full standings table, a leader row, two
 * court cards and the sit-out line. An empty board would score well by having
 * nothing on it.
 */
function seededSnapshot() {
  const players = [
    'Adi Nugroho',
    'Bagas Prasetyo',
    'Citra Halimah',
    'Dewi Kusuma',
    'Eko Saputra',
    'Fitri Andriani',
    'Gilang Ramadhan',
    'Hana Wijaya',
  ].map((name, index) => ({ id: `p${index + 1}`, name }));

  let state = createTournament(
    {
      name: 'Friday night at the club',
      format: 'mexicano',
      courts: 2,
      pointsPerMatch: 24,
      rankingMetric: 'ppr',
      // Fixed, so two runs of this script produce the same draw and a
      // Lighthouse comparison is comparing the same page.
      seed: 'lighthouse',
    },
    players,
  );

  state = generateNextRound(state);
  state = recordScore(state, 0, 1, 15, 9);
  state = recordScore(state, 0, 2, 13, 11);
  return state;
}

/* -------------------------------------------------------------------------- */

async function serverUp() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    try {
      const response = await fetch(`${ORIGIN}/api/health`);
      if (response.ok) return;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) throw new Error(`${ORIGIN}/api/health never answered`);
    await wait(POLL_MS);
  }
}

async function pushBoard(state) {
  const response = await fetch(`${ORIGIN}/api/t/${READ_TOKEN}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tanteo-write-token': WRITE_TOKEN,
      'x-tanteo-revision': String(state.revision),
    },
    body: JSON.stringify(state),
  });
  if (!response.ok) {
    throw new Error(`seeding the share link failed: ${response.status} ${await response.text()}`);
  }
  // The server answers 200 with accepted:false for a stale write. That would
  // leave the link empty while looking like a success, so it is checked.
  const result = await response.json();
  if (result.accepted !== true) throw new Error('the server refused the seed snapshot');
}

/* -------------------------------------------------------------------------- */

const child = spawn(process.execPath, ['apps/server/dist/main.js'], {
  cwd: ROOT,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: {
    ...process.env,
    PORT,
    TANTEO_DB: ':memory:',
    TANTEO_WEB_ROOT: './apps/web/dist',
  },
});

// Lighthouse's runner kills this process group when it is done; the server has
// to go with it rather than holding the port for the next run.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

/**
 * Set once a --then command has decided the exit code.
 *
 * Without it, the server's own exit handler could answer for the run: we kill
 * the server on the way out, `code` is then null because it died by signal,
 * and a failed check would report success. A gate that cannot fail is not a
 * gate.
 */
let verdictIsIn = false;
child.on('exit', (code) => {
  if (verdictIsIn) return;
  process.exit(code ?? 0);
});

try {
  await serverUp();
  await pushBoard(seededSnapshot());
  console.log(`share link seeded at /t/${READ_TOKEN}`);
  console.log(`tanteo ready for lighthouse on :${PORT}`);
} catch (error) {
  console.error(`lighthouse-server: ${error instanceof Error ? error.message : error}`);
  child.kill('SIGTERM');
  process.exit(1);
}

// Everything after --then is a command to run against the live board. Argv
// rather than a shell string, so nothing here has to think about quoting.
const thenAt = process.argv.indexOf('--then');
if (thenAt !== -1) {
  const [command, ...args] = process.argv.slice(thenAt + 1);
  if (!command) {
    console.error('lighthouse-server: --then needs a command');
    child.kill('SIGTERM');
    process.exit(1);
  }
  const task = spawn(command, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
  task.on('exit', (code, signal) => {
    verdictIsIn = true;
    child.kill('SIGTERM');
    process.exit(signal ? 1 : (code ?? 0));
  });
}
