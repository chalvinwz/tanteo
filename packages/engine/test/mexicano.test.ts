/**
 * Mexicano round-generation tests.
 *
 * Written against SPEC.md rather than an implementation. Mexicano has no
 * precomputed schedule, so almost everything here is "given this history, the
 * next round must look exactly like this" — which is the only way to pin down
 * a generator whose whole job is to react to the leaderboard.
 */

import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  applyRosterEvent,
  createTournament,
  generateMexicanoRound,
  generateNextRound,
  history,
  podium,
  recordScore,
  standings,
} from '../src/index.js';
import type { Player, Round, Seed, TournamentState } from '../src/index.js';

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
    name: NAMES[i] ?? `Player ${i + 1}`,
  }));
}

function mexicano(playerCount: number, courts: number, seed = 'tanteo'): TournamentState {
  return createTournament(
    { name: 'Padel Friday', format: 'mexicano', courts, seed },
    roster(playerCount),
  );
}

function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error(`index ${index} is out of range`);
  return value;
}

function requireRound(state: TournamentState, index: number): Round {
  const round = state.rounds[index];
  if (!round) throw new Error(`round ${index} was not generated`);
  return round;
}

/**
 * Mexicano rounds appear one at a time. The spec does not say whether
 * createTournament lays down round 0 or whether the organizer has to ask for
 * it, so every test reaches a round through this: it works either way.
 */
function ensureRound(state: TournamentState, index: number): TournamentState {
  let next = state;
  while (next.rounds.length <= index) next = generateNextRound(next);
  return next;
}

/** Record a score on every match of a round; splitsByCourt[i] is court i+1's teamA score. */
function playRound(
  state: TournamentState,
  roundIndex: number,
  splitsByCourt: readonly number[],
): TournamentState {
  const round = requireRound(state, roundIndex);
  let next = state;
  for (const match of round.matches) {
    const scoreA = splitsByCourt[match.court - 1];
    if (scoreA === undefined) throw new Error(`no split supplied for court ${match.court}`);
    next = recordScore(next, roundIndex, match.court, scoreA, state.config.pointsPerMatch - scoreA);
  }
  return next;
}

function expectWellFormedRound(state: TournamentState, roundIndex: number): void {
  const round = requireRound(state, roundIndex);
  expect(round.index, 'round carries its own index').toBe(roundIndex);

  const active = history.activeAtRound(state, roundIndex);
  const expectedMatches = Math.min(state.config.courts, Math.floor(active.length / 4));
  expect(round.matches.length, `round ${roundIndex} match count`).toBe(expectedMatches);
  expect(round.matches.map((m) => m.court).sort((a, b) => a - b)).toEqual(
    Array.from({ length: expectedMatches }, (_, i) => i + 1),
  );

  const onCourt = round.matches.flatMap((m) => [...m.teamA, ...m.teamB]);
  const everyone = [...onCourt, ...round.sitOuts];
  expect(new Set(everyone).size, `round ${roundIndex}: no player appears twice`).toBe(
    everyone.length,
  );
  expect([...everyone].sort(), `round ${roundIndex} covers exactly the active roster`).toEqual(
    [...active].sort(),
  );
}

/**
 * Canonical string for a round's pairings. Team membership is compared as a
 * set because the spec fixes *who* is on each side, not the order inside the
 * tuple; teamA vs teamB is kept distinct because "1st + 4th vs 2nd + 3rd"
 * does name teamA as the 1st-and-4th side.
 */
function pairingKey(round: Round): string {
  return [...round.matches]
    .sort((a, b) => a.court - b.court)
    .map(
      (m) =>
        `${m.court}:A[${[...m.teamA].sort().join(',')}]B[${[...m.teamB].sort().join(',')}]`,
    )
    .join(' | ');
}

/** What pairingKey should be, given a ranked list of the players who take the court. */
function predictPairingKey(order: readonly string[], courts: number): string {
  const parts: string[] = [];
  const groups = Math.min(courts, Math.floor(order.length / 4));
  for (let c = 0; c < groups; c++) {
    const g = order.slice(c * 4, c * 4 + 4);
    const teamA = [at(g, 0), at(g, 3)].sort().join(',');
    const teamB = [at(g, 1), at(g, 2)].sort().join(',');
    parts.push(`${c + 1}:A[${teamA}]B[${teamB}]`);
  }
  return parts.join(' | ');
}

function insertAt(items: readonly string[], index: number, value: string): string[] {
  const out = [...items];
  out.splice(index, 0, value);
  return out;
}

function sitOutCounts(state: TournamentState, uptoExclusive: number): Map<string, number> {
  const counts = new Map<string, number>(state.players.map((p) => [p.id, 0]));
  for (const round of state.rounds) {
    if (round.index >= uptoExclusive) continue;
    for (const id of round.sitOuts) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// round 0
// ---------------------------------------------------------------------------

describe('round 0', () => {
  it('is a shuffle that covers everyone without erroring', () => {
    for (const [players, courts] of [[8, 2], [9, 2], [11, 2], [12, 3], [5, 1]] as const) {
      const state = ensureRound(mexicano(players, courts, `r0-${players}`), 0);
      expectWellFormedRound(state, 0);

      const round = requireRound(state, 0);
      expect(round.matches.length).toBe(Math.min(courts, Math.floor(players / 4)));
      expect(round.sitOuts.length).toBe(players - round.matches.length * 4);
      for (const match of round.matches) {
        expect(match.scoreA).toBeUndefined();
        expect(match.scoreB).toBeUndefined();
      }
    }
  });

  it('is identical for the same seed', () => {
    const a = ensureRound(mexicano(10, 2, 'twice'), 0);
    const b = ensureRound(mexicano(10, 2, 'twice'), 0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it('actually consults the seed', () => {
    // Round 0 has no standings to sort on, so the seed is the only thing that
    // can decide the draw. A generator that ignored it would return the same
    // layout for every seed here.
    const layouts = new Set(
      ['tanteo', 'alpha', 'beta', 'gamma', 'delta', 'epsilon'].map((seed) =>
        pairingKey(requireRound(ensureRound(mexicano(8, 2, seed), 0), 0)),
      ),
    );
    expect(layouts.size, 'every seed produced the same round 0').toBeGreaterThan(1);
  });

  it('leaves the input state untouched when asked for a round directly', () => {
    let state = ensureRound(mexicano(8, 2, 'direct'), 0);
    state = playRound(state, 0, [20, 16]);

    const snapshot = JSON.stringify(state);
    const nextIndex = state.rounds.length;
    const { round, rng } = generateMexicanoRound(state, nextIndex);

    expect(JSON.stringify(state), 'generateMexicanoRound mutated its input').toBe(snapshot);
    expect(round.index).toBe(nextIndex);
    expect(rng.seed).toBe(state.rng.seed);

    // generateNextRound is the same computation, spliced into state.
    expect(generateNextRound(state).rounds[nextIndex]).toEqual(round);
  });
});

// ---------------------------------------------------------------------------
// pairing by standings
// ---------------------------------------------------------------------------

describe('round 1 pairs strictly by standings', () => {
  /**
   * 8 players, 2 courts, 24 points a match. Court 1 splits 20/4 and court 2
   * splits 16/8, so after round 0 there are four distinct scoring levels
   * (20, 16, 8, 4) and every remaining tie is inside a partnership, where
   * ppr, total, diff and wins are all equal and roster order decides. That
   * makes the full ranking knowable without asking standings() for it.
   */
  function scenario(seed: string): { state: TournamentState; order: string[] } {
    let state = ensureRound(mexicano(8, 2, seed), 0);
    const round0 = requireRound(state, 0);

    const points = new Map<string, number>();
    for (const match of round0.matches) {
      const scoreA = match.court === 1 ? 20 : 16;
      const scoreB = 24 - scoreA;
      for (const id of match.teamA) points.set(id, scoreA);
      for (const id of match.teamB) points.set(id, scoreB);
    }

    state = playRound(state, 0, [20, 16]);

    const rosterIndex = new Map(state.players.map((p, i) => [p.id, i]));
    const order = [...points.keys()].sort((a, b) => {
      const pa = points.get(a) ?? 0;
      const pb = points.get(b) ?? 0;
      if (pa !== pb) return pb - pa;
      return (rosterIndex.get(a) ?? 0) - (rosterIndex.get(b) ?? 0);
    });

    return { state: ensureRound(state, 1), order };
  }

  it('agrees with the leaderboard about the order', () => {
    const { state, order } = scenario('order');
    expect(standings(state).map((s) => s.playerId)).toEqual(order);
  });

  it('puts ranks 0-3 on court 1 and ranks 4-7 on court 2', () => {
    const { state, order } = scenario('courts');
    const round1 = requireRound(state, 1);
    expect(round1.sitOuts).toEqual([]);

    const court1 = round1.matches.find((m) => m.court === 1);
    const court2 = round1.matches.find((m) => m.court === 2);
    expect(court1).toBeDefined();
    expect(court2).toBeDefined();
    if (!court1 || !court2) return;

    expect(new Set([...court1.teamA, ...court1.teamB])).toEqual(new Set(order.slice(0, 4)));
    expect(new Set([...court2.teamA, ...court2.teamB])).toEqual(new Set(order.slice(4, 8)));
  });

  it('pairs 1st + 4th against 2nd + 3rd inside each court', () => {
    const { state, order } = scenario('pairs');
    const round1 = requireRound(state, 1);

    const court1 = round1.matches.find((m) => m.court === 1);
    const court2 = round1.matches.find((m) => m.court === 2);
    expect(court1).toBeDefined();
    expect(court2).toBeDefined();
    if (!court1 || !court2) return;

    expect([...court1.teamA].sort()).toEqual([at(order, 0), at(order, 3)].sort());
    expect([...court1.teamB].sort()).toEqual([at(order, 1), at(order, 2)].sort());
    expect([...court2.teamA].sort()).toEqual([at(order, 4), at(order, 7)].sort());
    expect([...court2.teamB].sort()).toEqual([at(order, 5), at(order, 6)].sort());

    expect(pairingKey(round1)).toBe(predictPairingKey(order, 2));
  });
});

// ---------------------------------------------------------------------------
// sit-out fairness
// ---------------------------------------------------------------------------

describe('sit-out fairness over many rounds', () => {
  const ROUNDS = 12;

  for (const players of [9, 10, 11]) {
    it(`keeps ${players} players on 2 courts within one sit-out of each other`, () => {
      let state = mexicano(players, 2, `sitouts-${players}`);
      const sitPerRound = players - Math.min(2, Math.floor(players / 4)) * 4;

      for (let r = 0; r < ROUNDS; r++) {
        state = ensureRound(state, r);
        expectWellFormedRound(state, r);
        expect(requireRound(state, r).sitOuts.length).toBe(sitPerRound);
        // Vary the splits so the leaderboard genuinely churns between rounds.
        state = playRound(state, r, [17 - (r % 5), 13 + (r % 3)]);
      }

      const ids = state.players.map((p) => p.id);
      for (let upto = 1; upto <= ROUNDS; upto++) {
        const counts = sitOutCounts(state, upto);
        const values = ids.map((id) => counts.get(id) ?? 0);
        const max = Math.max(...values);
        const min = Math.min(...values);

        expect(max - min, `${players} players: spread after ${upto} round(s)`).toBeLessThanOrEqual(1);
        // The same rule as an organizer would state it.
        if (max >= 2) {
          expect(
            min,
            `${players} players: someone sat out twice before everyone sat out once (round ${upto})`,
          ).toBeGreaterThanOrEqual(1);
        }
      }

      // Sanity: the totals add up, so no sit-out went unrecorded.
      const total = ids.reduce((sum, id) => sum + (sitOutCounts(state, ROUNDS).get(id) ?? 0), 0);
      expect(total).toBe(sitPerRound * ROUNDS);
    });
  }
});

// ---------------------------------------------------------------------------
// late-joiner seeding
// ---------------------------------------------------------------------------

/** The round the joiner first appears in. */
const JOIN_ROUND = 2;

/**
 * 7 starters on 2 courts. One court runs per round with three sitting out, so
 * two rounds are played first — by then the three who sat out round 0 have all
 * had a turn and every incumbent carries a real result. The eighth player then
 * joins, which takes the draw to exactly 8: two full courts, nobody sitting
 * out.
 *
 * Both of those matter. No sit-out means the seed is the only thing that can
 * move anyone around. No incumbent on zero rounds means the joiner is the only
 * unknown quantity in the draw, so the test says something about *seeding* and
 * not about how an engine ranks a player who has not scored yet.
 */
function joinerScenario(seed: Seed): {
  state: TournamentState;
  incumbents: string[];
} {
  let state = ensureRound(mexicano(7, 2, `joiner-${seed}`), 0);
  state = playRound(state, 0, [20]);
  state = ensureRound(state, 1);
  state = playRound(state, 1, [18]);

  // Order of the seven, straight off the leaderboard, before the joiner exists.
  const incumbents = standings(state).map((s) => s.playerId);

  state = addPlayer(state, { id: 'p8', name: 'Hugo' });
  state = applyRosterEvent(state, {
    type: 'join',
    playerId: 'p8',
    beforeRound: JOIN_ROUND,
    seed,
  });
  state = ensureRound(state, JOIN_ROUND);

  return { state, incumbents };
}

/**
 * Which insertion points for the joiner would explain the round we actually
 * got. Insertions 1/2 and 5/6 are indistinguishable (they swap two players
 * within the same team), but 0, 3, 4 and 7 each produce a unique layout — so
 * this pins down "front", "midpoint" and "back" exactly.
 */
function matchingInsertions(round: Round, incumbents: readonly string[], joiner: string): number[] {
  const actual = pairingKey(round);
  const out: number[] = [];
  for (let i = 0; i <= incumbents.length; i++) {
    if (predictPairingKey(insertAt(incumbents, i, joiner), 2) === actual) out.push(i);
  }
  return out;
}

describe('late-joiner seeding', () => {
  it('sets the scenario up with a full draw and a known incumbent order', () => {
    const { state, incumbents } = joinerScenario('top');
    expect(incumbents).toHaveLength(7);
    expect(requireRound(state, JOIN_ROUND).sitOuts).toEqual([]);
    expect(state.players.find((p) => p.id === 'p8')?.seed).toBe('top');
    expectWellFormedRound(state, JOIN_ROUND);

    // The premise the seed assertions rest on: the joiner is the only player
    // in the draw without a result.
    for (const id of incumbents) {
      expect(history.roundsPlayed(state, id, JOIN_ROUND), `${id} has a result`).toBeGreaterThan(0);
    }
    expect(history.roundsPlayed(state, 'p8', JOIN_ROUND)).toBe(0);
  });

  it("pairs a 'top' seed as if ranked first", () => {
    const { state, incumbents } = joinerScenario('top');
    const round = requireRound(state, JOIN_ROUND);
    expect(matchingInsertions(round, incumbents, 'p8')).toEqual([0]);
    expect(pairingKey(round)).toBe(predictPairingKey(['p8', ...incumbents], 2));
  });

  it("pairs a 'bottom' seed as if ranked last", () => {
    const { state, incumbents } = joinerScenario('bottom');
    const round = requireRound(state, JOIN_ROUND);
    expect(matchingInsertions(round, incumbents, 'p8')).toEqual([7]);
    expect(pairingKey(round)).toBe(predictPairingKey([...incumbents, 'p8'], 2));
  });

  it("pairs a 'middle' seed at the midpoint", () => {
    const { state, incumbents } = joinerScenario('middle');
    const matches = matchingInsertions(requireRound(state, JOIN_ROUND), incumbents, 'p8');

    // Seven incumbents have two defensible midpoints — index 3 (the middle of
    // the existing list) and index 4 (the middle of the resulting list of
    // eight). Either reading is fine; the front and the back are not.
    expect(matches, 'no insertion point explains the round').not.toEqual([]);
    expect(matches).toHaveLength(1);
    expect([3, 4]).toContain(at(matches, 0));
  });

  it('stops honouring the seed once the joiner has a played round', () => {
    const { state: seeded } = joinerScenario('top');

    // The joiner was slotted onto court 1 by the seed and then lost badly.
    // The next round has to rank them on that result instead.
    let state = playRound(seeded, JOIN_ROUND, [3, 10]);
    state = ensureRound(state, JOIN_ROUND + 1);

    expect(history.seedAtRound(state, 'p8', JOIN_ROUND + 1)).toBeUndefined();

    const round = requireRound(state, JOIN_ROUND + 1);
    expect(round.sitOuts).toEqual([]);

    const board = standings(state).map((s) => s.playerId);
    expect(pairingKey(round)).toBe(predictPairingKey(board, 2));

    // Three points off one match is the worst rate in the draw, so a seed that
    // still counted would be the only thing that could keep them on court 1.
    expect(
      board.indexOf('p8'),
      'the seed is still dragging the joiner to the front',
    ).toBeGreaterThan(0);
    const joinerCourt = round.matches.find(
      (m) => m.teamA.includes('p8') || m.teamB.includes('p8'),
    )?.court;
    expect(joinerCourt).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// the seed is a pairing hint, never a result
// ---------------------------------------------------------------------------

describe('the pairing seed never reaches the leaderboard', () => {
  it('is absent from every standing and every podium slot', () => {
    for (const seed of ['top', 'middle', 'bottom'] as const) {
      const { state } = joinerScenario(seed);
      const played = playRound(state, JOIN_ROUND, [15, 9]);

      const board = standings(played);
      expect(board.length).toBe(played.players.length);
      for (const row of board) {
        expect(row, `seed leaked into standings for ${row.playerId}`).not.toHaveProperty('seed');
        for (const key of [
          'playerId', 'roundsPlayed', 'totalPoints', 'ppr',
          'wins', 'draws', 'losses', 'pointDiff', 'podiumEligible',
        ]) {
          expect(row).toHaveProperty(key);
        }
      }
      expect(JSON.stringify(board), 'the word "seed" appears in standings output').not.toContain(
        '"seed"',
      );
      expect(JSON.stringify(podium(played))).not.toContain('"seed"');

      // The record still carries the hint — the test would be vacuous otherwise.
      expect(played.players.find((p) => p.id === 'p8')?.seed).toBe(seed);
    }
  });

  it('does not lift an unplayed joiner up the board', () => {
    const { state } = joinerScenario('top');
    const board = standings(state);
    // p8 has no result yet: ppr 0, so they cannot outrank anyone who scored.
    const joiner = board.find((s) => s.playerId === 'p8');
    expect(joiner?.roundsPlayed).toBe(0);
    expect(joiner?.ppr).toBe(0);
    expect(joiner?.totalPoints).toBe(0);
    expect(board[0]?.playerId, "a 'top' seed reached the top of the leaderboard").not.toBe('p8');
  });
});
