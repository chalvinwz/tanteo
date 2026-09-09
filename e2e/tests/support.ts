import { expect } from '@playwright/test';
import type { Browser, BrowserContextOptions, Locator, Page } from '@playwright/test';

import { en } from '../../apps/web/src/i18n/en.js';

/**
 * The organizer's hands, and the strings the app actually shows.
 *
 * Copy is imported from the app's own catalog rather than retyped. A test that
 * hardcodes "Add player" passes for the wrong reason the day somebody reworks
 * the wording; a test that imports the catalog keeps asserting the same
 * behaviour and reads the new words.
 */

export { en };

/**
 * The default viewport. 390x844 is a phone, which is where this product is
 * used; a suite that only ever ran at desktop width would not be testing the
 * screen anybody stands on a court holding.
 */
export const PHONE = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
} as const;

/**
 * What a spectator's context looks like. `browser.newContext()` does not
 * inherit the config's `use` block, so the viewer's phone shape and the
 * service-worker rule are restated here rather than silently lost.
 */
export const VIEWER_CONTEXT: BrowserContextOptions = {
  ...PHONE,
  serviceWorkers: 'block',
};

/** The same `{placeholder}` substitution the app's `t()` does. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}

/* -------------------------------------------------------------------------- */

export interface NewTournament {
  name: string;
  players: readonly string[];
  /**
   * Fixed total per match. The app defaults to 24; the tests turn it down so a
   * match is a handful of taps instead of two dozen. 8 is the app's own floor,
   * so nothing here exercises a value the UI would refuse.
   */
  pointsPerMatch: number;
  courts?: number;
  /**
   * Where the app is served from. Defaults to the suite's own server; the
   * stalled-stream test points this at a server it is allowed to strangle.
   */
  origin?: string;
}

/** Walk the setup form the way an organizer does, and land on the score screen. */
export async function createTournament(page: Page, tournament: NewTournament): Promise<void> {
  await page.goto(tournament.origin === undefined ? '/' : `${tournament.origin}/`);
  await page.getByRole('button', { name: en.home.newTournament }).click();
  await expect(page.getByRole('heading', { name: en.setup.title })).toBeVisible();

  await page.getByLabel(en.setup.nameLabel, { exact: true }).fill(tournament.name);

  await step(page, en.setup.courtsLabel, tournament.courts ?? 1);
  await step(page, en.setup.pointsLabel, tournament.pointsPerMatch);

  const roster = page.getByLabel(en.setup.playersLabel, { exact: true });
  for (const name of tournament.players) {
    await roster.fill(name);
    await roster.press('Enter');
  }

  await page.getByRole('button', { name: en.setup.start }).click();
  await expect(
    page.getByRole('heading', { name: fill(en.play.roundHeading, { current: 1 }) }),
  ).toBeVisible();
}

/**
 * Drive one of the setup steppers to a value.
 *
 * The stepper is a pair of buttons and an `<output>`, so this reads the output
 * and presses until it agrees, which is also what proves the control works.
 */
async function step(page: Page, label: string, target: number): Promise<void> {
  const value = page.getByRole('status', { name: label });
  const less = page.getByRole('button', { name: `${label}: one less` });
  const more = page.getByRole('button', { name: `${label}: one more` });

  // Bounded: a stepper that will not reach its target should fail as a hang in
  // this helper, not as a mystery timeout twenty lines later.
  for (let guard = 0; guard < 40; guard++) {
    const current = Number((await value.textContent()) ?? Number.NaN);
    expect(Number.isFinite(current), `${label} should show a number`).toBe(true);
    if (current === target) return;
    await (current > target ? less : more).click();
  }
  throw new Error(`${label} never reached ${target}`);
}

/* -------------------------------------------------------------------------- */

/** The whole court card is one button, which is also what a keyboard gets. */
export function courtCard(page: Page, court: number): Locator {
  return page.getByRole('button', {
    name: new RegExp(`^${fill(en.score.heading, { court })}\\b`),
  });
}

export interface Teams {
  teamA: [string, string];
  teamB: [string, string];
}

/**
 * Who the engine put on which side of the net.
 *
 * The draw is seeded per tournament, so the pairing is not knowable in advance
 * and the test has to read it off the card. Names come back in DOM order:
 * team A, then the net, then team B.
 */
export async function readCourt(
  page: Page,
  court: number,
  roster: readonly string[],
): Promise<Teams> {
  const card = courtCard(page, court);
  await expect(card).toBeVisible();
  const lines = (await card.innerText())
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => roster.includes(line));
  expect(lines, `court ${court} should hold four named players`).toHaveLength(4);
  const [a1, a2, b1, b2] = lines as [string, string, string, string];
  return { teamA: [a1, a2], teamB: [b1, b2] };
}

/**
 * Score a court by tapping team A's plus button, then commit.
 *
 * Team B's score is the remainder, because the total is fixed; that is the
 * engine's rule and the sheet's whole shape, so the test enters it the same way
 * a thumb does rather than reaching past the UI.
 */
export async function scoreCourt(
  page: Page,
  court: number,
  teamA: readonly [string, string],
  pointsToTeamA: number,
): Promise<void> {
  const card = courtCard(page, court);
  await card.click();

  const sheet = page.getByRole('dialog', { name: fill(en.score.heading, { court }) });
  await expect(sheet).toBeVisible();

  const add = sheet.getByRole('button', {
    name: fill(en.score.increment, { team: teamA.join(' ') }),
  });
  for (let point = 0; point < pointsToTeamA; point++) await add.click();

  // Closing is committing, by design. No assertion on the card afterwards: on
  // a one-court tournament the completed round hands the screen straight to the
  // next one, so the card the score went into is already gone.
  await sheet.getByRole('button', { name: en.common.done }).click();
  await expect(sheet).toBeHidden();
}

/* -------------------------------------------------------------------------- */

/** The three tabs an open tournament has. */
export async function goTo(page: Page, tab: 'score' | 'players' | 'board'): Promise<void> {
  const label = { score: en.play.title, players: en.players.open, board: en.board.open }[tab];
  await page.getByRole('link', { name: label, exact: true }).click();
}

/**
 * Somebody turns up after the tournament started.
 *
 * `joinsRound` is the 1-based round the sheet promises they will land on. Pass
 * it and the promise is checked before the swap is committed, which is the only
 * moment it can be checked at all.
 */
export async function addLatePlayer(
  page: Page,
  name: string,
  joinsRound?: number,
): Promise<void> {
  await goTo(page, 'players');
  await page.getByRole('button', { name: en.players.addAction }).click();

  const sheet = page.getByRole('dialog', { name: en.players.addTitle });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel(en.players.nameLabel, { exact: true }).fill(name);
  if (joinsRound !== undefined) {
    await expect(sheet.getByText(fill(en.players.joinsNextRound, { round: joinsRound }))).toBeVisible();
  }
  await sheet.getByRole('button', { name: en.players.addAction }).click();
  await expect(sheet).toBeHidden();
}

/** Mint the read-only link and hand back the absolute URL it puts on screen. */
export async function createShareLink(page: Page): Promise<string> {
  await goTo(page, 'board');
  await page.getByRole('button', { name: en.share.open }).click();

  const sheet = page.getByRole('dialog', { name: en.share.title });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: en.share.start }).click();

  const link = sheet.getByRole('textbox', { name: en.share.title });
  await expect(link).toHaveValue(/^http.*\/t\/[A-Za-z0-9_-]{16,64}$/);
  const url = await link.inputValue();

  await sheet.getByRole('button', { name: en.common.done }).click();
  await expect(sheet).toBeHidden();
  return url;
}

/** A spectator, in their own context with their own storage. */
export async function openViewer(browser: Browser, shareUrl: string): Promise<Page> {
  const context = await browser.newContext(VIEWER_CONTEXT);
  const page = await context.newPage();
  await page.goto(shareUrl);
  return page;
}

/* -------------------------------------------------------------------------- */

/** One player's line on a leaderboard, organizer's or spectator's. */
export function boardRow(page: Page, name: string): Locator {
  return page
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name, exact: false }) });
}

/**
 * The names on the leaderboard, top to bottom.
 *
 * A row header carries the rank, the name and any badges, so this picks the
 * roster name out of the tokens rather than assuming how the row wraps.
 */
export async function boardOrder(page: Page, roster: readonly string[]): Promise<string[]> {
  const headers = await page.getByRole('rowheader').allInnerTexts();
  return headers.map((text) => {
    const name = text.split(/\s+/).find((token) => roster.includes(token));
    if (name === undefined) throw new Error(`no roster name in board row: ${JSON.stringify(text)}`);
    return name;
  });
}
