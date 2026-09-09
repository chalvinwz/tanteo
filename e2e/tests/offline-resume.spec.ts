import { expect, test } from '@playwright/test';

import { courtCard, createTournament, en, fill } from './support.js';

/**
 * The premise of the whole client: the organizer's phone is the source of
 * truth, and courtside there is often no signal at all. A tournament that did
 * not survive a reload on a dead connection would not be a scorekeeper, it
 * would be a website.
 *
 * The service worker is switched back on for this file only. Everywhere else it
 * is blocked so that route interception is honest; here it is the thing under
 * test, because without it the reload has nothing to load from.
 */

test.use({ serviceWorkers: 'allow' });

const ROSTER = ['Ana', 'Bo', 'Cruz', 'Dee'] as const;

test('a tournament comes back after a reload with the network gone', async ({ page, context }) => {
  const name = 'Sunday morning, court two';
  await createTournament(page, { name, players: ROSTER, pointsPerMatch: 8 });

  // The shell has to be in the cache before the network can be taken away.
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });

  await context.setOffline(true);
  await page.reload();

  // Same screen, same round, same draw, with nothing on the other end of the
  // radio. This is IndexedDB and the precached shell, not a warm HTTP cache.
  await expect(
    page.getByRole('heading', { name: fill(en.play.roundHeading, { current: 1 }) }),
  ).toBeVisible();
  const card = courtCard(page, 1);
  for (const player of ROSTER) await expect(card).toContainText(player);

  // And the tournament is still findable from the front door, which is a
  // second navigation the service worker has to answer with no network.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: en.home.resumeTitle })).toBeVisible();
  // Anchored: the discard button beside the card is labelled with the same
  // name and would otherwise match too.
  const resumeCard = page.getByRole('button', { name: new RegExp(`^${name}`) });
  await expect(resumeCard).toBeVisible();
  await expect(resumeCard).toContainText(en.home.resumeAction);
});
