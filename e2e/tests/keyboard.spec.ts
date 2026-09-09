import { expect, test } from '@playwright/test';

import { courtCard, createTournament, en, fill, readCourt } from './support.js';

/**
 * The score sheet is the one surface in the app that traps focus, so it is the
 * one surface that can strand a keyboard. Escape has to let go of it, and focus
 * has to land back where it started rather than at the top of the page.
 *
 * Escape also commits, which is deliberate: the sheet's own comment says losing
 * twenty taps to a stray press is worse courtside than a save that Clear can
 * undo. That is asserted here so the choice cannot be reversed by accident.
 *
 * Two courts, so scoring one of them leaves the round open and the card that
 * focus has to come back to is still on screen.
 */

const ROSTER = ['Ana', 'Bo', 'Cruz', 'Dee', 'Eve', 'Finn', 'Gil', 'Hana'] as const;

test('Escape closes the score sheet, returns focus, and keeps the score', async ({ page }) => {
  await createTournament(page, {
    name: 'Escape hatch',
    players: ROSTER,
    pointsPerMatch: 8,
    courts: 2,
  });

  const round1 = await readCourt(page, 1, ROSTER);

  // Opened from the keyboard, not tapped: a touch tap does not focus a button,
  // so tapping it in would test nothing about where focus goes afterwards. The
  // court card is a real button, so Enter is all a keyboard needs.
  const card = courtCard(page, 1);
  await card.focus();
  await card.press('Enter');

  const sheet = page.getByRole('dialog', { name: fill(en.score.heading, { court: 1 }) });
  await expect(sheet).toBeVisible();

  await sheet
    .getByRole('button', { name: fill(en.score.increment, { team: round1.teamA.join(' ') }) })
    .click();

  await page.keyboard.press('Escape');

  await expect(sheet).toBeHidden();
  await expect(card).toBeFocused();
  // One point to team A out of eight, so the card now reads 1 and 7 rather
  // than "Not scored".
  await expect(card).not.toContainText(en.play.notScored);
  await expect(card).toContainText('7');
});
