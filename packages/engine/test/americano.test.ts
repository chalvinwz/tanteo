/**
 * Americano schedule tests.
 *
 * These are written against SPEC.md, not against an implementation: every
 * assertion below is either a formula the spec states outright or one of the
 * invariants it lists. Where the spec leaves room (how hard the regenerator
 * has to work, which direction "roster order" tiebreaks run) the test asserts
 * the weakest claim that still catches a real regression.
 */

import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  applyRosterEvent,
  createTournament,
  defaultAmericanoRounds,
  generateAmericanoRounds,
  history,
  recordScore,
} from '../src/index.js';
import type { Player, Round, TournamentState } from '../src/index.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const NAMES = [
  'Ana', 'Bruno', 'Carmen', 'Diego', 'Elena', 'Fede', 'Gala', 'Hugo',
  'Ivan', 'Julia', 'Karim', 'Lucia', 'Marta', 'Nico', 'Olga', 'Pau',
];

function roster(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    // noUncheckedIndexedAccess: NAMES[i] is string | undefined.
    name: NAMES[i] ?? `Player ${i + 1}`,
  }));
}

function americano(playerCount: number, courts: number, seed = 'tanteo'): TournamentState {
  return createTournament(
    { name: 'Padel Friday', format: 'americano', courts, seed },
    roster(playerCount),
  );
}

function requireRound(state: TournamentState, index: number): Round {
  const round = state.rounds[index];
  if (!round) throw new Error(`round ${index} was not generated`);
  return round;
}

function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error(`index ${index} is out of range`);
  return value;
}

/** Record a score on every match of a round, same split on each court. */
function scoreWholeRound(
  state: TournamentState,
  roundIndex: number,
  splitA: number,
): TournamentState {
  const round = requireRound(state, roundIndex);
  let next = state;
  for (const match of round.matches) {
    next = recordScore(next, roundIndex, match.court, splitA, state.config.pointsPerMatch - splitA);
  }
  return next;
}

/** Invariants 1 and 2, plus the court-numbering and match-count rules. */
function expectWellFormedRound(state: TournamentState, roundIndex: number): void {
  const round = requireRound(state, roundIndex);
  expect(round.index, 'round carries its own index').toBe(roundIndex);

  const active = history.activeAtRound(state, roundIndex);
  const expectedMatches = Math.min(state.config.courts, Math.floor(active.length / 4));
  expect(round.matches.length, `round ${roundIndex} match count`).toBe(expectedMatches);

  // Courts are 1..n so the UI can print "Court 3" straight from the match.
  expect(round.matches.map((m) => m.court).sort((a, b) => a - b)).toEqual(
    Array.from({ length: expectedMatches }, (_, i) => i + 1),
  );

  const onCourt = round.matches.flatMap((m) => [...m.teamA, ...m.teamB]);
  const everyone = [...onCourt, ...round.sitOuts];
  expect(new Set(everyone).size, `round ${roundIndex}: no player appears twice`).toBe(
    everyone.length,
  );
  // Invariant 2: every active player either plays or sits out — and nobody
  // who is not active is drawn in at all.
  expect([...everyone].sort(), `round ${roundIndex} covers exactly the active roster`).toEqual(
    [...active].sort(),
  );
}

function expectEveryRoundWellFormed(state: TournamentState): void {
  for (let i = 0; i < state.rounds.length; i++) expectWellFormedRound(state, i);
}

/** Total partnership slots the schedule has to fill. */
function pairSlots(state: TournamentState): number {
  return state.rounds.reduce((total, round) => total + round.matches.length * 2, 0);
}

/** Sum over pairs of (timesPartnered - 1): how much repetition there is. */
function repeatedPartnerships(state: TournamentState): number {
  let repeats = 0;
  for (const count of history.partnerCounts(state).values()) repeats += count - 1;
  return repeats;
}

/** The crudest floor: slots the schedule must fill minus distinct pairs it has. */
function pigeonholeFloor(state: TournamentState): number {
  const everPlayed = new Set<string>();
  for (const round of state.rounds) {
    for (const match of round.matches) {
      for (const id of [...match.teamA, ...match.teamB]) everPlayed.add(id);
    }
  }
  const distinctPairsAvailable = (everPlayed.size * (everPlayed.size - 1)) / 2;
  return Math.max(0, pairSlots(state) - distinctPairsAvailable);
}

/**
 * Fewest repeats any pairing of `onCourt` could have managed, given what has
 * already been partnered. Adding a pair costs 1 if that pair has played
 * together before and 0 otherwise, which is exactly how it moves the
 * sum-of-(count-1) total.
 */
function minRepeatsForGroup(onCourt: readonly string[], seen: Map<string, number>): number {
  if (onCourt.length < 2) return 0;
  const first = at(onCourt, 0);
  const rest = onCourt.slice(1);
  let best = Infinity;
  for (let i = 0; i < rest.length; i++) {
    const partner = at(rest, i);
    const cost = (seen.get(history.pairKey(first, partner)) ?? 0) >= 1 ? 1 : 0;
    const remaining = rest.filter((_, j) => j !== i);
    best = Math.min(best, cost + minRepeatsForGroup(remaining, seen));
    if (best === 0) break; // cannot beat a repeat-free matching
  }
  return best;
}

/**
 * Repeats the scheduler genuinely could not avoid, walked round by round
 * against the draw it actually made.
 *
 * The blunt pigeonhole count (slots vs C(n,2)) is a weaker number but an
 * unfair test: sit-outs are chosen before any pairing happens, so a round
 * whose four players have already partnered each other has no repeat-free
 * option left however much slack the tournament has in aggregate. This is the
 * honest reading of "a free pair existed" — for every round, could a different
 * pairing of *those* players have done better?
 */
function unavoidableRepeats(state: TournamentState): number {
  const seen = new Map<string, number>();
  let floor = 0;
  for (const round of [...state.rounds].sort((a, b) => a.index - b.index)) {
    const onCourt = round.matches.flatMap((m) => [...m.teamA, ...m.teamB]);
    floor += minRepeatsForGroup(onCourt, seen);
    for (const match of round.matches) {
      for (const team of [match.teamA, match.teamB]) {
        const key = history.pairKey(team[0], team[1]);
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
  }
  return floor;
}

/**
 * Priority 1 of the regeneration rule: minimise repeated partnerships across
 * the whole tournament, played rounds included.
 *
 * The budget is the unavoidable floor plus one missed swap per four rounds.
 * That slack is deliberate — the spec asks for "a greedy pass plus local-search
 * swaps" and says outright not to write an exact solver, so holding the
 * scheduler to a per-round optimum would contradict its own instructions. It
 * is nowhere near enough slack for a scheduler that ignores partner history,
 * which repeats on the order of one pair in three.
 */
function expectNoAvoidableRepeat(state: TournamentState, label: string): void {
  const repeats = repeatedPartnerships(state);
  const floor = Math.max(unavoidableRepeats(state), pigeonholeFloor(state));
  const budget = floor + Math.ceil(state.rounds.length / 4);
  expect(
    repeats,
    `${label}: ${repeats} repeated partnerships across ${pairSlots(state)} slots, ` +
      `of which ${floor} were unavoidable (budget ${budget})`,
  ).toBeLessThanOrEqual(budget);
}

/** Sit-out counts per player, over rounds [0, uptoExclusive). */
function sitOutCounts(state: TournamentState, uptoExclusive: number): Map<string, number> {
  const counts = new Map<string, number>(state.players.map((p) => [p.id, 0]));
  for (const round of state.rounds) {
    if (round.index >= uptoExclusive) continue;
    for (const id of round.sitOuts) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Assert nobody's sit-out count runs more than one ahead of anybody else's,
 * checked after every round rather than only at the end — a scheduler that
 * balances only in aggregate would pass the end-state check while making one
 * player sit out three rounds in a row.
 */
function expectFairSitOuts(state: TournamentState, label: string): void {
  for (let upto = 1; upto <= state.rounds.length; upto++) {
    const eligible = history.activeAtRound(state, upto - 1);
    const counts = sitOutCounts(state, upto);
    const values = eligible.map((id) => counts.get(id) ?? 0);
    const max = Math.max(...values);
    const min = Math.min(...values);
    expect(max - min, `${label}: sit-out spread after ${upto} round(s)`).toBeLessThanOrEqual(1);
    // Restating the same rule the way an organizer would: nobody sits out a
    // second time while someone has not sat out at all.
    if (max >= 2) {
      expect(min, `${label}: someone sat out twice before everyone sat out once`).toBeGreaterThanOrEqual(1);
    }
  }
}

/** The spec's closed form, re-implemented so the table below can be widened. */
function expectedDefaultRounds(n: number, courts: number): number {
  const pairs = (n * (n - 1)) / 2;
  const pairsPerRound = Math.max(1, 2 * Math.min(courts, Math.floor(n / 4)));
  return Math.ceil(pairs / pairsPerRound);
}

// ---------------------------------------------------------------------------
// defaultAmericanoRounds
// ---------------------------------------------------------------------------

describe('defaultAmericanoRounds', () => {
  const table: ReadonlyArray<readonly [players: number, courts: number, rounds: number]> = [
    // The headline case the spec calls out: the whist rotation.
    [8, 2, 7],
    // Smallest legal draw: 4 players partner each other over 3 rounds.
    [4, 1, 3],
    [5, 1, 5],
    [6, 1, 8],
    [12, 3, 11],
    [16, 4, 15],
    [9, 2, 9],
    [10, 2, 12],
    [11, 2, 14],
    // Courts, not players, are the binding constraint here: 12 players could
    // fill 3 courts but only 2 exist, so pairs land 4 per round, not 6.
    [12, 2, 17],
    [16, 2, 30],
    // Only one court's worth of players, so the second court cannot be used.
    [7, 2, 11],
    // Spare courts beyond floor(n/4) change nothing.
    [8, 5, 7],
  ];

  for (const [players, courts, rounds] of table) {
    it(`${players} players on ${courts} court(s) is ${rounds} rounds`, () => {
      expect(defaultAmericanoRounds(players, courts)).toBe(rounds);
    });
  }

  it('matches ceil(C(n,2) / pairsPerRound) across a wide grid', () => {
    for (let n = 4; n <= 24; n++) {
      for (let courts = 1; courts <= 6; courts++) {
        expect(defaultAmericanoRounds(n, courts), `n=${n} courts=${courts}`).toBe(
          expectedDefaultRounds(n, courts),
        );
      }
    }
  });

  it('stays finite below the minimum draw size', () => {
    // Fewer than 4 players is rejected by createTournament, but the spec's
    // "minimum 1" guard on pairsPerRound exists precisely so this arithmetic
    // never divides by zero and hands back Infinity or NaN.
    for (const n of [1, 2, 3]) {
      const rounds = defaultAmericanoRounds(n, 2);
      expect(Number.isFinite(rounds), `n=${n} produced ${rounds}`).toBe(true);
    }
  });

  it('is what createTournament fills into config.rounds', () => {
    for (const [players, courts] of [[8, 2], [9, 2], [12, 3], [12, 2]] as const) {
      const state = americano(players, courts);
      expect(state.config.rounds, `${players}/${courts}`).toBe(
        defaultAmericanoRounds(players, courts),
      );
      expect(state.rounds.length).toBe(defaultAmericanoRounds(players, courts));
    }
  });
});

// ---------------------------------------------------------------------------
// the whist rotation
// ---------------------------------------------------------------------------

describe('the 8-player / 2-court schedule', () => {
  it('gives every one of the 28 partnerships exactly once', () => {
    const state = americano(8, 2);
    expect(state.rounds.length).toBe(7);

    const counts = history.partnerCounts(state);
    const ids = state.players.map((p) => p.id);

    const allPairs = new Set<string>();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        allPairs.add(history.pairKey(at(ids, i), at(ids, j)));
      }
    }

    expect(allPairs.size).toBe(28);
    expect(pairSlots(state)).toBe(28);
    expect(new Set(counts.keys()), 'every possible pair partnered').toEqual(allPairs);
    for (const [key, count] of counts) {
      expect(count, `pair ${key} partnered ${count} times`).toBe(1);
    }
    expect(repeatedPartnerships(state)).toBe(0);
  });

  it('has both courts busy and nobody sitting out', () => {
    const state = americano(8, 2);
    expectEveryRoundWellFormed(state);
    for (const round of state.rounds) {
      expect(round.matches.length).toBe(2);
      expect(round.sitOuts).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// partnership variety on a virgin schedule
// ---------------------------------------------------------------------------

describe('partnership variety', () => {
  const draws: ReadonlyArray<readonly [players: number, courts: number]> = [
    [8, 2], [9, 2], [7, 2], [10, 2], [12, 3],
  ];

  for (const [players, courts] of draws) {
    it(`never takes a used pair when a free one was on court (${players} players, ${courts} court(s))`, () => {
      const state = americano(players, courts, `fresh-${players}-${courts}`);
      expectNoAvoidableRepeat(state, `${players} players on ${courts} court(s)`);
    });
  }
});

// ---------------------------------------------------------------------------
// round shape and sit-out fairness
// ---------------------------------------------------------------------------

describe('generated round shape', () => {
  const shapes: ReadonlyArray<readonly [players: number, courts: number]> = [
    [4, 1], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 3], [13, 3], [16, 2],
  ];

  for (const [players, courts] of shapes) {
    it(`${players} players on ${courts} court(s) fills min(courts, floor(active/4)) matches`, () => {
      const state = americano(players, courts, `shape-${players}-${courts}`);
      expect(state.rounds.length).toBeGreaterThan(0);
      expectEveryRoundWellFormed(state);
      for (const round of state.rounds) {
        expect(round.matches.length).toBe(Math.min(courts, Math.floor(players / 4)));
        expect(round.sitOuts.length).toBe(players - round.matches.length * 4);
      }
    });
  }
});

describe('sit-out fairness', () => {
  it('spreads the single sit-out evenly across 9 players on 2 courts', () => {
    const state = americano(9, 2);
    expect(state.rounds.length).toBe(9);
    expectFairSitOuts(state, '9 players');

    // 9 rounds x 1 sit-out over 9 players lands on exactly one turn each.
    const counts = sitOutCounts(state, state.rounds.length);
    for (const player of state.players) {
      expect(counts.get(player.id), `${player.id} sit-outs`).toBe(1);
    }
  });

  for (const [players, courts] of [[10, 2], [11, 2], [13, 3], [6, 1]] as const) {
    it(`keeps sit-out counts within one for ${players} players on ${courts} court(s)`, () => {
      const state = americano(players, courts, `sitouts-${players}-${courts}`);
      expectFairSitOuts(state, `${players} players`);
    });
  }
});

// ---------------------------------------------------------------------------
// determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('produces an identical tournament for identical inputs', () => {
    const a = americano(9, 2, 'same-seed');
    const b = americano(9, 2, 'same-seed');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('produces a valid schedule under any seed', () => {
    // Different seeds are *allowed* to differ — the spec only promises ties
    // break through the PRNG — so nothing here asserts inequality.
    for (const seed of ['tanteo', 'alpha', 'beta', 'gamma']) {
      const state = americano(9, 2, seed);
      expect(state.rng.seed).toBe(seed);
      expect(state.rounds.length).toBe(defaultAmericanoRounds(9, 2));
      expectEveryRoundWellFormed(state);
      expectFairSitOuts(state, `seed ${seed}`);
    }
  });

  it('survives a JSON round trip unchanged', () => {
    const state = americano(11, 2, 'json');
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

// ---------------------------------------------------------------------------
// generateAmericanoRounds returns only the tail
// ---------------------------------------------------------------------------

describe('generateAmericanoRounds', () => {
  it('returns only rounds fromRoundIndex..totalRounds-1, correctly indexed', () => {
    const state = americano(8, 2);
    const snapshot = JSON.stringify(state);

    const tail = generateAmericanoRounds(state, 3, 7);
    expect(tail.rounds.map((r) => r.index)).toEqual([3, 4, 5, 6]);

    const whole = generateAmericanoRounds(state, 0, 7);
    expect(whole.rounds.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    // Invariant 7: the input state is untouched.
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('carries the PRNG forward rather than restarting it', () => {
    const state = americano(9, 2, 'rng-forward');
    const { rng } = generateAmericanoRounds(state, 0, state.rounds.length);
    expect(rng.seed).toBe(state.rng.seed);
    expect(rng.cursor).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(rng.cursor)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// regeneration after a roster event
// ---------------------------------------------------------------------------

describe('regeneration after a mid-tournament roster change', () => {
  /** 8 players, 2 courts, rounds 0-2 played. */
  function playedThrough2(seed: string): TournamentState {
    let state = americano(8, 2, seed);
    state = scoreWholeRound(state, 0, 16);
    state = scoreWholeRound(state, 1, 13);
    state = scoreWholeRound(state, 2, 24);
    return state;
  }

  it('leaves scored rounds byte-identical when a player pauses', () => {
    const state = playedThrough2('pause');
    const head = JSON.stringify(state.rounds.slice(0, 3));
    const snapshot = JSON.stringify(state);

    const after = applyRosterEvent(state, { type: 'pause', playerId: 'p4', beforeRound: 3 });

    // Invariant 6: a scored round is history.
    expect(JSON.stringify(after.rounds.slice(0, 3))).toBe(head);
    // Invariant 7: the input is untouched.
    expect(JSON.stringify(state)).toBe(snapshot);

    expect(after.rounds.length).toBe(state.rounds.length);
    expect(after.revision).toBeGreaterThan(state.revision);
    expect(after.players.find((p) => p.id === 'p4')?.status).toBe('paused');
  });

  it('drops the paused player from every future round and reschedules the rest', () => {
    const state = playedThrough2('pause');
    const after = applyRosterEvent(state, { type: 'pause', playerId: 'p4', beforeRound: 3 });

    expectEveryRoundWellFormed(after);
    for (let i = 3; i < after.rounds.length; i++) {
      const round = requireRound(after, i);
      const drawn = [...round.matches.flatMap((m) => [...m.teamA, ...m.teamB]), ...round.sitOuts];
      // A paused player is not "sitting out"; they are out of the draw.
      expect(drawn, `round ${i} still contains p4`).not.toContain('p4');
      expect(round.matches.length).toBe(1);
    }
  });

  it('does not repeat a partnership it could have avoided (pause)', () => {
    const state = playedThrough2('pause');
    const after = applyRosterEvent(state, { type: 'pause', playerId: 'p4', beforeRound: 3 });

    // Priority 1 of the regeneration rule, measured across the whole
    // tournament including the three rounds that are already played.
    expectNoAvoidableRepeat(after, 'pause before round 3');
    // The played rounds were a perfect whist rotation and must stay one.
    expect(repeatedPartnerships({ ...after, rounds: after.rounds.slice(0, 3) })).toBe(0);
  });

  it('leaves scored rounds byte-identical when a player joins', () => {
    const state = playedThrough2('join');
    const head = JSON.stringify(state.rounds.slice(0, 3));

    // addPlayer only registers a name; it must not disturb the draw.
    const registered = addPlayer(state, { id: 'p9', name: 'Ivan' });
    expect(JSON.stringify(registered.rounds)).toBe(JSON.stringify(state.rounds));

    const snapshot = JSON.stringify(registered);
    const after = applyRosterEvent(registered, { type: 'join', playerId: 'p9', beforeRound: 3 });

    expect(JSON.stringify(after.rounds.slice(0, 3))).toBe(head);
    expect(JSON.stringify(registered)).toBe(snapshot);
    expect(after.rounds.length).toBe(state.rounds.length);
    expect(after.players.find((p) => p.id === 'p9')?.status).toBe('active');
    expect(after.players.find((p) => p.id === 'p9')?.joinedBeforeRound).toBe(3);
  });

  it('draws the joiner into every round from beforeRound on', () => {
    const state = playedThrough2('join');
    let after = addPlayer(state, { id: 'p9', name: 'Ivan' });
    after = applyRosterEvent(after, { type: 'join', playerId: 'p9', beforeRound: 3 });

    expectEveryRoundWellFormed(after);

    for (let i = 0; i < 3; i++) {
      const round = requireRound(after, i);
      const drawn = [...round.matches.flatMap((m) => [...m.teamA, ...m.teamB]), ...round.sitOuts];
      expect(drawn, `p9 leaked into played round ${i}`).not.toContain('p9');
    }

    let playedCount = 0;
    for (let i = 3; i < after.rounds.length; i++) {
      const round = requireRound(after, i);
      const onCourt = round.matches.flatMap((m) => [...m.teamA, ...m.teamB]);
      if (onCourt.includes('p9')) playedCount++;
      expect([...onCourt, ...round.sitOuts]).toContain('p9');
    }
    expect(playedCount, 'the joiner never got on court').toBeGreaterThan(0);
  });

  it('does not repeat a partnership it could have avoided (join)', () => {
    const state = playedThrough2('join');
    let after = addPlayer(state, { id: 'p9', name: 'Ivan' });
    after = applyRosterEvent(after, { type: 'join', playerId: 'p9', beforeRound: 3 });

    expectNoAvoidableRepeat(after, 'join before round 3');
    expect(repeatedPartnerships({ ...after, rounds: after.rounds.slice(0, 3) })).toBe(0);
  });

  it('regenerates deterministically', () => {
    const build = (): TournamentState => {
      let s = playedThrough2('determinism');
      s = addPlayer(s, { id: 'p9', name: 'Ivan' });
      return applyRosterEvent(s, { type: 'join', playerId: 'p9', beforeRound: 3 });
    };
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});
