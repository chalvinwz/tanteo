import { describe, expect, it } from 'vitest';

import { describeAge, isOutOfTouch } from '../src/live-source.js';

/**
 * The freshness rules behind the live view.
 *
 * These are unit tests rather than browser checks on purpose. The behaviour
 * they protect is "a board on a screen at the venue must never look current
 * when it is not", and that is a timing rule: reproducing it in a browser means
 * killing a server and waiting out a timeout, which is slow, and which a hidden
 * tab quietly falsifies because browsers throttle timers when the page is not
 * visible. The rule itself is pure, so it is pinned here where the clock is an
 * argument.
 */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

describe('isOutOfTouch', () => {
  const now = 1_000_000;

  it('treats never having heard from the server as out of touch', () => {
    // A viewer who has not managed a single request has nothing to trust.
    expect(isOutOfTouch(null, now)).toBe(true);
  });

  it('is in touch immediately after contact', () => {
    expect(isOutOfTouch(now, now)).toBe(false);
  });

  it('stays in touch across a gap between scores', () => {
    // The whole point of splitting contact from the last score: a padel game
    // runs minutes between points, and the heartbeat keeps contact fresh.
    expect(isOutOfTouch(now - 30 * SECOND, now)).toBe(false);
  });

  it('goes out of touch once the heartbeat window passes', () => {
    // The server sends a heartbeat every 25s, so nothing at all for 46s means
    // the connection is gone, not that the game is quiet.
    expect(isOutOfTouch(now - 46 * SECOND, now)).toBe(true);
    expect(isOutOfTouch(now - 5 * MINUTE, now)).toBe(true);
  });

  it('does not flip on the last score being old', () => {
    // The regression this guards: judging the connection by the age of the last
    // score made a healthy stream accuse the organizer of being offline
    // halfway through every game.
    const lastScore = now - 10 * MINUTE;
    const lastContact = now - 2 * SECOND;
    expect(isOutOfTouch(lastContact, now)).toBe(false);
    expect(isOutOfTouch(lastScore, now)).toBe(true);
  });
});

describe('describeAge', () => {
  const now = 1_000_000;

  it('says nothing when nothing has arrived', () => {
    expect(describeAge(null, now)).toBeNull();
  });

  it('reads as just now inside ten seconds', () => {
    expect(describeAge(now, now)).toBe('just now');
    expect(describeAge(now - 9 * SECOND, now)).toBe('just now');
  });

  it('counts seconds, then minutes, then hours', () => {
    expect(describeAge(now - 30 * SECOND, now)).toBe('30s ago');
    expect(describeAge(now - 5 * MINUTE, now)).toBe('5 min ago');
    expect(describeAge(now - 3 * 60 * MINUTE, now)).toBe('3 h ago');
  });

  it('never reports a negative age from a clock that disagrees', () => {
    // The organizer's phone stamps nothing here, but a viewer's clock can still
    // sit behind the value it was handed. "in -4s" would be nonsense on screen.
    expect(describeAge(now + 4 * SECOND, now)).toBe('just now');
  });
});
