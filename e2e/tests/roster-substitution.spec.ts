import { expect, test } from '@playwright/test';

import {
  boardRow,
  createTournament,
  en,
  fill,
  goTo,
  readCourt,
  scoreCourt,
} from './support.js';

/**
 * The product thesis, end to end:
 *
 *   the roster is mutable at any point during a tournament, and every point
 *   ever scored is attributed to the human who actually played it.
 *
 * A substitution is where that sentence is easiest to get wrong. The person
 * walking off has to keep their points and stay on the board; the person
 * walking on inherits a slot in the draw and nothing else. If those two facts
 * ever swap, the app is lying about who won the evening.
 */

const ROSTER = ['Ana', 'Bo', 'Cruz', 'Dee'] as const;
const INCOMING = 'Zed';

test('a substituted player keeps their points and stays on the board', async ({ page }) => {
  await createTournament(page, {
    name: 'Wednesday league',
    players: ROSTER,
    pointsPerMatch: 8,
  });

  const round1 = await readCourt(page, 1, ROSTER);
  await scoreCourt(page, 1, round1.teamA, 6);

  const outgoing = round1.teamA[0];
  const partner = round1.teamA[1];

  // --- the swap -----------------------------------------------------------
  await goTo(page, 'players');
  await page
    .getByRole('group', { name: outgoing })
    .getByRole('button', { name: en.players.substitute })
    .click();

  const sheet = page.getByRole('dialog', {
    name: fill(en.players.substituteTitle, { name: outgoing }),
  });
  await expect(sheet).toBeVisible();
  // The sheet states the rule before anybody commits to it.
  await expect(sheet.getByText(fill(en.players.substituteHint, { name: outgoing }))).toBeVisible();
  await sheet.getByLabel(en.players.nameLabel, { exact: true }).fill(INCOMING);
  await sheet.getByRole('button', { name: en.players.substituteAction }).click();
  await expect(sheet).toBeHidden();

  // --- the roster says it from both ends ----------------------------------
  await expect(page.getByText(fill(en.players.replacedBy, { name: INCOMING }))).toBeVisible();
  await expect(page.getByText(fill(en.players.replaces, { name: outgoing }))).toBeVisible();
  // Frozen, not erased: the row still carries the round and the points.
  const departed = page.getByRole('group', { name: outgoing });
  await expect(departed.getByRole('button', { name: en.players.resume })).toBeVisible();

  // --- the board is where it counts ---------------------------------------
  await goTo(page, 'board');

  const kept = boardRow(page, outgoing);
  await expect(kept).toContainText('6.00');
  await expect(kept).toContainText(en.players.left);
  // Six points in one round is still the best rate in the tournament, so the
  // player who walked off is still the one being crowned.
  await expect(kept).toContainText(en.board.leader);

  // The partner who stayed is untouched by any of this.
  await expect(boardRow(page, partner)).toContainText('6.00');

  // The newcomer takes a slot in the draw and nothing else.
  const arrived = boardRow(page, INCOMING);
  await expect(arrived).toContainText('0.00');
  await expect(arrived).toContainText(en.board.notEnoughRounds);

  // Five rows: four originals, none of them dropped, plus the newcomer.
  await expect(page.getByRole('rowheader')).toHaveCount(5);
});
