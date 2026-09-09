import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, test as base } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

import {
  createShareLink,
  createTournament,
  en,
  fill,
  openViewer,
  readCourt,
  scoreCourt,
} from './support.js';

/**
 * The release blocker M3 could not settle.
 *
 * A board propped up at a venue is the one screen in this product that can
 * actively mislead people. If the feed dies and the screen keeps saying "Live",
 * everyone standing in front of it believes a frozen scoreline. The rule is
 * that within about 45 seconds of hearing nothing, the view drops the word and
 * says it is out of touch.
 *
 * M3 could not observe this because its browser page was never visible and
 * timers were throttled, so the tests below state the visibility rather than
 * assume it.
 *
 * ## Why the connection is cut by suspending the server
 *
 * Two failures wear the same clothes and are not the same thing:
 *
 *   fails fast   the request is refused, `fetch` rejects, and the app can say
 *                so honestly. That is the "Cannot reach the board" path, and
 *                M3 already verified it from a cold load.
 *   goes quiet   the socket stays up, requests are accepted, and nothing ever
 *                comes back. Dead venue wifi, a captive portal, a proxy holding
 *                a connection open. Nothing rejects, so nothing tells the app
 *                anything, and the only thing that can save the screen is the
 *                app noticing that nothing has arrived.
 *
 * The second is the dangerous one and the one under test. Two ways of faking it
 * were tried first and both were wrong:
 *
 *   `page.route` that never resolves    only reaches requests not yet made, so
 *                                       the open event stream sails past it.
 *   `context.setOffline(true)`          measured, in a diagnostic run kept in
 *                                       the report: it does not tear down an
 *                                       established SSE connection. Heartbeats
 *                                       kept arriving, the view stayed live,
 *                                       and it was right to.
 *
 * So the test suspends the server process with SIGSTOP. The kernel holds every
 * socket open, the browser sees a perfectly healthy connection, and not one
 * byte arrives. That is the real failure, produced rather than simulated, and
 * SIGCONT gives it back.
 */

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const ROSTER = ['Ana', 'Bo', 'Cruz', 'Dee'] as const;

interface VenueServer {
  origin: string;
  /** Freeze the process. Sockets stay open; nothing is written to them. */
  goQuiet(): void;
  /** Let it run again. Everything it was holding flushes. */
  speakAgain(): void;
}

/**
 * A share server of this test's own, so strangling it cannot take the rest of
 * the suite down with it. Port 0, so two of these can never collide.
 */
const test = base.extend<{ venue: VenueServer }>({
  venue: async ({}, use) => {
    const child = spawn(process.execPath, ['apps/server/dist/main.js'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: '0',
        TANTEO_DB: ':memory:',
        TANTEO_WEB_ROOT: './apps/web/dist',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the venue server never named a port')), 30_000);
      const stdout = child.stdout;
      if (stdout === null) {
        clearTimeout(timer);
        reject(new Error('the venue server has no stdout'));
        return;
      }
      stdout.setEncoding('utf8');
      stdout.on('data', (chunk: string) => {
        const match = /listening on :(\d+)/.exec(chunk);
        if (match?.[1] === undefined) return;
        clearTimeout(timer);
        resolve(Number(match[1]));
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`the venue server exited with ${String(code)}`));
      });
    });

    await use({
      origin: `http://127.0.0.1:${port}`,
      goQuiet: () => void child.kill('SIGSTOP'),
      speakAgain: () => void child.kill('SIGCONT'),
    });

    // Resume first: a stopped process cannot run its own shutdown path, and
    // leaving one behind would hold the port for the length of the run.
    child.kill('SIGCONT');
    child.kill('SIGKILL');
  },
});

/** A scored tournament on the venue server, with a live link out. */
async function shareAScoredBoard(
  page: Page,
  browser: Browser,
  venue: VenueServer,
  name: string,
): Promise<Page> {
  await createTournament(page, {
    name,
    players: ROSTER,
    pointsPerMatch: 8,
    origin: venue.origin,
  });
  const round1 = await readCourt(page, 1, ROSTER);
  await scoreCourt(page, 1, round1.teamA, 6);
  return openViewer(browser, await createShareLink(page));
}

/* -------------------------------------------------------------------------- */

/**
 * The fast one, and the one to read first when this breaks: a view with no
 * freshness check fails it in a second rather than in two minutes.
 *
 * Be clear about its limit. Under a fake clock no heartbeat could have arrived
 * during the fast-forwarded minute whether or not the server was suspended, so
 * this proves the reaction and not its cause. The cut is real anyway, so that
 * both tests are pointed at the same failure. Causation and timing are the slow
 * test's job, and it does establish them.
 */
test('a stream that goes quiet stops claiming to be live', async ({ page, browser, venue }) => {
  const name = 'Court six, Thursday';
  const viewer = await shareAScoredBoard(page, browser, venue, name);

  // Installed against a loaded page and then re-navigated, so the boot itself
  // never depends on fake timers.
  await viewer.clock.install();
  await viewer.reload();

  await expect(viewer.getByRole('heading', { name })).toBeVisible();
  await expect(viewer.getByText(en.live.connectionLive, { exact: true })).toBeVisible();
  await expect(viewer.getByText(en.live.stalled)).toHaveCount(0);

  venue.goQuiet();
  await viewer.clock.fastForward('01:00');

  await expect(viewer.getByText(en.live.stalled)).toBeVisible();
  await expect(viewer.getByText(en.live.connectionLive, { exact: true })).toHaveCount(0);
  await expect(viewer.getByText(en.live.connectionPolling, { exact: true })).toHaveCount(0);

  // The board itself stays on screen. A stale board under a warning is useful
  // at a venue; a blank one is not.
  await expect(viewer.getByRole('rowheader')).toHaveCount(4);

  // Give the server its voice back and the warning has to clear. This is what
  // makes the cut load-bearing rather than decorative: the only thing that
  // changed between "out of touch" and "just now" is whether anything answered.
  venue.speakAgain();
  await viewer.clock.runFor('06');

  await expect(
    viewer.getByText(fill(en.live.updated, { age: en.age.justNow }), { exact: true }),
  ).toBeVisible();
  await expect(viewer.getByText(en.live.stalled)).toHaveCount(0);

  await viewer.context().close();
});

/* -------------------------------------------------------------------------- */

/**
 * The wall-clock version. No fake timers anywhere, so what it observes is what
 * a phone on a table observes, and it is the one that actually settles M3's
 * open question.
 *
 * Slow on purpose: the threshold is 45 seconds and the server's heartbeat is
 * 25, so there is no honest way to watch both halves of this rule in less than
 * about a hundred seconds. Worth it once, for the one failure in this product
 * that misleads a room full of people.
 */
test('over real seconds, a healthy stream keeps saying "Live" and a dead one stops', async ({
  page,
  browser,
  venue,
}) => {
  test.setTimeout(300_000);

  const viewer = await shareAScoredBoard(page, browser, venue, 'The long Thursday');

  // The reason M3 could not call this: a hidden page has its timers throttled,
  // so nothing observed there proves anything either way.
  expect(await viewer.evaluate(() => document.visibilityState)).toBe('visible');
  await expect(viewer.getByText(en.live.connectionLive, { exact: true })).toBeVisible();

  // --- half one: a healthy stream must not cry wolf ------------------------
  // Fifty seconds is past the 45-second threshold, so a view judging staleness
  // by the last score rather than by the last contact would be accusing the
  // organizer of being offline by now. Nothing is scored in this window; only
  // heartbeats are keeping it honest. A plain wait, because the passage of time
  // is the thing under test.
  await viewer.waitForTimeout(50_000);

  await expect(viewer.getByText(en.live.connectionLive, { exact: true })).toBeVisible();
  await expect(viewer.getByText(en.live.stalled)).toHaveCount(0);

  // --- half two: a dead stream must say so ---------------------------------
  venue.goQuiet();

  // Generous: the rule is 45 seconds and the freshness check runs every 5, so a
  // failure here should mean the app never did it, not that a loaded machine
  // was a second late.
  await expect(viewer.getByText(en.live.stalled)).toBeVisible({ timeout: 75_000 });
  await expect(viewer.getByText(en.live.connectionLive, { exact: true })).toHaveCount(0);
  await expect(viewer.getByRole('rowheader')).toHaveCount(4);

  // --- and it finds its way back -------------------------------------------
  venue.speakAgain();
  await expect(viewer.getByText(en.live.stalled)).toHaveCount(0, { timeout: 30_000 });

  await viewer.context().close();
});
