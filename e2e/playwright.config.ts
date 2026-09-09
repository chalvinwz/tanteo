import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

import { PHONE } from './tests/support.js';

/**
 * The end-to-end suite.
 *
 * One command starts everything: the config builds the workspace and runs the
 * real container shape, which is the Hono server handing out the built client
 * and the share API from one origin. Nothing here talks to a dev server,
 * because the thing worth testing is what ships.
 */

/**
 * Not 8080. The default port is what a person running `pnpm run start:local`
 * by hand will already be sitting on, and a suite that quietly attaches to
 * somebody's hand-started server is a suite that reports on the wrong build.
 */
const PORT = Number(process.env['TANTEO_E2E_PORT'] ?? 8181);

const baseURL = `http://127.0.0.1:${PORT}`;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  // Capped on CI, where the box is small and every worker is a browser plus a
  // share stream. Locally, Playwright's own default is better informed.
  // (Spread rather than `undefined`: exactOptionalPropertyTypes.)
  ...(process.env['CI'] ? { workers: 2 } : {}),
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL,
    ...PHONE,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    /**
     * Off by default. A service worker sits in front of the network, and
     * `page.route` does not see through it, which would make the severed-stream
     * test lie. The one test that is actually about the service worker turns it
     * back on for itself.
     */
    serviceWorkers: 'block',
  },

  // Chromium only: this is a phone product and the suite is here to exercise
  // behaviour, not to survey engines.
  projects: [{ name: 'chromium-phone' }],

  webServer: {
    // Built, not `dev`. The suite has to see the same bundle, the same service
    // worker and the same static-file fallback a self-hoster gets.
    command: 'pnpm run build && pnpm run start:local',
    cwd: repoRoot,
    url: `${baseURL}/api/health`,
    // `start:local` pins TANTEO_DB=:memory:, so every run starts with no
    // snapshots and one run cannot leave a board behind for the next.
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env['CI'],
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 180_000,
  },
});
