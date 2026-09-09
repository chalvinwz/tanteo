#!/usr/bin/env node
/**
 * Ask Chrome, in its own words, whether tanteo is installable.
 *
 * Why this exists instead of a Lighthouse assertion: Lighthouse 12 removed the
 * `pwa` category AND deleted the audits that used to back it. There is no
 * `installable-manifest`, no `service-worker`, no `maskable-icon` in the
 * package any more, so `lighthouserc.json` has nothing to assert against and an
 * assertion naming one of them would silently pass on an audit that never ran.
 *
 * What Lighthouse's `installable-manifest` audit did was call the DevTools
 * Protocol's `Page.getInstallabilityErrors` and print the list. That command is
 * still there, so this calls it directly. The verdict below is Chrome's, not an
 * interpretation of a manifest file: same source the removed audit used, one
 * layer of wrapper removed.
 *
 * Usage:  node scripts/check-pwa-installable.mjs [url]
 *         TANTEO_URL=http://localhost:8080/ node scripts/check-pwa-installable.mjs
 *         CHROME_PATH=/path/to/chrome node scripts/check-pwa-installable.mjs
 *
 * Exit code 0 when Chrome reports no installability errors, 1 otherwise.
 * No dependencies: Node's built-in WebSocket speaks CDP, and Chrome writes the
 * debugging port into its own profile directory.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_UNDER_TEST = process.argv[2] ?? process.env['TANTEO_URL'] ?? 'http://localhost:8080/';

/** Chrome writes the port here once the debugging socket is listening. */
const PORT_FILE = 'DevToolsActivePort';

/** How long to wait for Chrome to come up, and for a service worker to activate. */
const CHROME_START_MS = 20_000;
const SERVICE_WORKER_MS = 15_000;
const STEP_MS = 100;

const CHROME_CANDIDATES = [
  process.env['CHROME_PATH'],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((path) => typeof path === 'string' && path.length > 0);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `No Chrome found. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}\nSet CHROME_PATH to point at one.`,
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll `read` until it returns something truthy, or give up. */
async function until(read, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await wait(STEP_MS);
  }
}

/**
 * Poll like `until`, but a timeout is an answer rather than a failure.
 *
 * A page with no service worker is not a crash, it is an uninstallable page,
 * and the whole point of this script is to say so. `serviceWorker.ready` never
 * settles when nothing is registered, so anything asking that question has to
 * carry its own deadline.
 */
async function within(read, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await wait(STEP_MS);
  }
}

/* -------------------------------------------------------------------------- */

/** A minimal CDP client. One socket, one id counter, promises keyed by id. */
function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(undefined), { once: true });
    socket.addEventListener('error', () => reject(new Error(`Cannot open ${wsUrl}`)), {
      once: true,
    });
  });

  socket.addEventListener('message', (event) => {
    const frame = JSON.parse(String(event.data));
    if (frame.id === undefined) return; // An event, not a reply. Nothing here listens.
    const slot = pending.get(frame.id);
    if (!slot) return;
    pending.delete(frame.id);
    if (frame.error) slot.reject(new Error(`${frame.method}: ${frame.error.message}`));
    else slot.resolve(frame.result);
  });

  return {
    ready,
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

/* -------------------------------------------------------------------------- */

async function launch() {
  const binary = findChrome();
  // A throwaway profile every run: a stale service worker registration from a
  // previous run would make this report a pass it did not earn.
  const profile = mkdtempSync(join(tmpdir(), 'tanteo-installable-'));
  const child = spawn(
    binary,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );

  const portPath = join(profile, PORT_FILE);
  const port = await until(
    () => {
      if (!existsSync(portPath)) return null;
      const first = readFileSync(portPath, 'utf8').split('\n')[0];
      return first && first.trim() !== '' ? first.trim() : null;
    },
    CHROME_START_MS,
    'Chrome to write its debugging port',
  );

  return {
    binary,
    port,
    // Best effort on purpose: Chrome is still flushing its profile as we tear
    // it down, and a leftover temp directory must never turn a real verdict
    // into an exit code that reads like a broken harness.
    stop() {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        /* the OS reaps its own temp directory */
      }
    },
  };
}

async function firstPageTarget(port) {
  return until(
    async () => {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        return list.find((entry) => entry.type === 'page') ?? null;
      } catch {
        return null;
      }
    },
    CHROME_START_MS,
    'a Chrome page target',
  );
}

/** Run an expression in the page and hand back its awaited value. */
async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? 'Evaluation failed');
  }
  return result.result.value;
}

/* -------------------------------------------------------------------------- */

async function main() {
  const chrome = await launch();
  let cdp;
  try {
    const target = await firstPageTarget(chrome.port);
    cdp = connect(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // First load registers the worker. Installability needs one in scope, so
    // the page is loaded twice on purpose: the check is about the second visit,
    // which is the one a real installed-app prompt would happen on.
    await cdp.send('Page.navigate', { url: URL_UNDER_TEST });
    await until(
      async () => (await evaluate(cdp, 'document.readyState')) === 'complete',
      CHROME_START_MS,
      'the first page load',
    );

    // `serviceWorker.ready` never settles when nothing registers, so it is
    // polled through `getRegistration()` with a deadline instead of awaited.
    const workerScope = await within(
      () =>
        evaluate(
          cdp,
          `navigator.serviceWorker
             ? navigator.serviceWorker.getRegistration().then((r) => r?.active ? r.scope : null)
             : Promise.resolve(null)`,
        ),
      SERVICE_WORKER_MS,
    );

    await cdp.send('Page.reload', { ignoreCache: false });
    await until(
      async () => (await evaluate(cdp, 'document.readyState')) === 'complete',
      CHROME_START_MS,
      'the reload',
    );
    const controlled = await within(
      () => evaluate(cdp, 'Boolean(navigator.serviceWorker?.controller)'),
      workerScope === null ? STEP_MS : SERVICE_WORKER_MS,
    );

    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    const errors = installabilityErrors ?? [];
    const { url: manifestUrl, errors: manifestErrors } = await cdp.send('Page.getAppManifest');

    console.log(`url                 ${URL_UNDER_TEST}`);
    console.log(`chrome              ${chrome.binary}`);
    console.log(`manifest            ${manifestUrl || '(none)'}`);
    console.log(`service worker      ${workerScope ?? '(none registered)'}`);
    console.log(`page controlled     ${controlled ? 'yes' : 'no'}`);

    const manifestProblems = (manifestErrors ?? []).filter((entry) => entry.critical);
    for (const problem of manifestProblems) {
      console.log(`manifest error      ${problem.message}`);
    }

    if (errors.length === 0 && manifestProblems.length === 0) {
      console.log('\ninstallable         yes (Chrome reports no installability errors)');
      return 0;
    }

    console.log('\ninstallable         NO');
    for (const error of errors) {
      const detail = error.errorArguments?.map((a) => `${a.name}=${a.value}`).join(', ');
      console.log(`  ${error.errorId}${detail ? ` (${detail})` : ''}`);
    }
    return 1;
  } finally {
    cdp?.close();
    chrome.stop();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`check-pwa-installable: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  },
);
