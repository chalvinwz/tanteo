import { expect, test } from '@playwright/test';

import {
  addLatePlayer,
  boardOrder,
  boardRow,
  createShareLink,
  createTournament,
  en,
  fill,
  goTo,
  openViewer,
  readCourt,
  scoreCourt,
} from './support.js';

/**
 * The scenario the brief asks for, start to finish, in one test.
 *
 * Set up an evening, score a round, let somebody turn up late, check the board
 * ranks them all honestly, hand out the read-only link, and watch a spectator's
 * phone move on its own. It is one test because the value is in the whole
 * chain: any of these steps passing while the next one fails is not a working
 * product.
 */

const ROSTER = ['Ana', 'Bo', 'Cruz', 'Dee'] as const;
const LATE = 'Eve';
const POINTS = 8;

/** Roster order is the leaderboard's last tiebreak, so the test needs it too. */
function byEntryOrder(a: string, b: string): number {
  const all = [...ROSTER, LATE];
  return all.indexOf(a) - all.indexOf(b);
}

test('a round, a late joiner, and a spectator who sees the next score arrive', async ({
  page,
  browser,
}) => {
  const name = 'Friday night at the club';
  await createTournament(page, { name, players: ROSTER, pointsPerMatch: POINTS });

  // --- a round of scores -------------------------------------------------
  const round1 = await readCourt(page, 1, ROSTER);
  await scoreCourt(page, 1, round1.teamA, 6);

  // --- somebody turns up late --------------------------------------------
  // Round 1 is already scored, so the engine can only land them on round 2, and
  // the sheet promises exactly that before anyone commits.
  await addLatePlayer(page, LATE, 2);
  await expect(page.getByText(LATE, { exact: true })).toBeVisible();

  // --- the board, ranked by points per round -----------------------------
  await goTo(page, 'board');
  await expect(
    page.getByText(fill(en.board.rankedBy, { metric: en.setup.metricPpr })),
  ).toBeVisible();

  // 6 points in one round beats 2 points in one round beats never having
  // played. Inside a team every number ties, so entry order settles it.
  const expected = [
    ...[...round1.teamA].sort(byEntryOrder),
    ...[...round1.teamB].sort(byEntryOrder),
    LATE,
  ];
  await expect(page.getByRole('rowheader')).toHaveCount(5);
  expect(await boardOrder(page, [...ROSTER, LATE])).toEqual(expected);

  for (const winner of round1.teamA) await expect(boardRow(page, winner)).toContainText('6.00');
  for (const loser of round1.teamB) await expect(boardRow(page, loser)).toContainText('2.00');
  // On the board from the moment they were dated in, on zero until they play,
  // and held off the podium rather than quietly ranked into it.
  await expect(boardRow(page, LATE)).toContainText('0.00');
  await expect(boardRow(page, LATE)).toContainText(en.board.notEnoughRounds);
  await expect(boardRow(page, expected[0] as string)).toContainText(en.board.leader);

  // --- the share link, opened in a second browser context ----------------
  const shareUrl = await createShareLink(page);
  const viewer = await openViewer(browser, shareUrl);

  await expect(viewer.getByRole('heading', { name })).toBeVisible();
  await expect(viewer.getByText(en.live.connectionLive, { exact: true })).toBeVisible();
  // The spectator is reading the same five-row board, late joiner included.
  await expect(viewer.getByRole('rowheader')).toHaveCount(5);
  expect(await boardOrder(viewer, [...ROSTER, LATE])).toEqual(expected);
  await expect(
    viewer.getByText(fill(en.play.roundHeading, { current: 2 }), { exact: true }),
  ).toBeVisible();
  // Nothing a spectator could press that would change the tournament.
  await expect(viewer.getByRole('button', { name: en.share.open })).toHaveCount(0);

  // --- a live update arrives, with no reload -----------------------------
  await goTo(page, 'score');
  const round2 = await readCourt(page, 1, [...ROSTER, LATE]);
  await scoreCourt(page, 1, round2.teamA, 5);

  // The viewer was never touched. Round 2 is complete, so the board it is
  // holding rolls on to round 3 by itself.
  await expect(
    viewer.getByText(fill(en.play.roundHeading, { current: 3 }), { exact: true }),
  ).toBeVisible();
  await expect(viewer.getByText(en.live.connectionLive, { exact: true })).toBeVisible();

  await viewer.context().close();
});
