/**
 * Example-based tests for the leaderboard.
 *
 * The states here are hand-built rather than played out through
 * `createTournament`, because the point of every fixture is a specific set of
 * numbers — a tie that has to be broken a specific way, a player sitting
 * exactly on the podium bar. `standings` takes a `TournamentState` and reads
 * `config`, `players` and `rounds`; a literal is as valid an input as a played
 * tournament, and it makes the intent of each case readable off the page.
 *
 * Every fixture's arithmetic is written out in a comment beside it.
 */

import { describe, expect, it } from 'vitest';

import { podium, standings } from '../src/index.js';
import type {
  Match,
  PlayerRecord,
  RankingMetric,
  Round,
  RosterEvent,
  Standing,
  TournamentState,
} from '../src/index.js';

const POINTS = 24;

/** One match written the way a scoresheet reads: two pairs and team A's score. */
interface MatchSpec {
  a: [string, string];
  b: [string, string];
  scoreA: number;
}

/** `roster` is who was active for this round; whoever is not on court sits. */
function makeRound(index: number, roster: readonly string[], specs: readonly MatchSpec[]): Round {
  const matches: Match[] = specs.map((spec, court) => ({
    court: court + 1,
    teamA: [...spec.a],
    teamB: [...spec.b],
    scoreA: spec.scoreA,
    scoreB: POINTS - spec.scoreA,
  }));
  const onCourt = new Set(matches.flatMap((match) => [...match.teamA, ...match.teamB]));
  return { index, matches, sitOuts: roster.filter((id) => !onCourt.has(id)) };
}

function activePlayer(id: string): PlayerRecord {
  return { id, name: id, status: 'active', joinedBeforeRound: 0 };
}

function departedPlayer(id: string): PlayerRecord {
  return { id, name: id, status: 'left', joinedBeforeRound: 0 };
}

function roster(ids: readonly string[]): PlayerRecord[] {
  return ids.map(activePlayer);
}

interface Fixture {
  players: readonly PlayerRecord[];
  rounds: readonly Round[];
  rankingMetric?: RankingMetric;
  podiumMinRoundsPct?: number;
  events?: readonly RosterEvent[];
}

function makeState(fixture: Fixture): TournamentState {
  return {
    config: {
      name: 'fixture',
      format: 'americano',
      courts: 1,
      pointsPerMatch: POINTS,
      rankingMetric: fixture.rankingMetric ?? 'ppr',
      podiumMinRoundsPct: fixture.podiumMinRoundsPct ?? 0.5,
      seed: 'fixture',
    },
    players: [...fixture.players],
    rounds: [...fixture.rounds],
    events: [...(fixture.events ?? [])],
    rng: { seed: 'fixture', cursor: 0 },
    revision: 1,
  };
}

function order(rows: readonly Standing[]): string[] {
  return rows.map((row) => row.playerId);
}

function rowFor(rows: readonly Standing[], playerId: string): Standing {
  const row = rows.find((candidate) => candidate.playerId === playerId);
  if (!row) throw new Error(`no standings row for ${playerId}`);
  return row;
}

/** Where a player finished, for tie-break assertions. */
function placeOf(rows: readonly Standing[], playerId: string): number {
  const place = order(rows).indexOf(playerId);
  if (place < 0) throw new Error(`${playerId} is missing from the standings`);
  return place;
}

// ---------------------------------------------------------------------------
// The three-metric fixture
// ---------------------------------------------------------------------------

const SIX = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

/**
 * Six players, one court, 24 points a match, six rounds.
 *
 * Tuned so the three ranking metrics genuinely disagree. A is a one-and-done
 * star: the best rate on the night, the worst total, and too few rounds for the
 * podium. B grinds out the most of everything. F turns up late enough to sit on
 * the eligibility bar exactly.
 *
 *   player  rounds  total    ppr    W-D-L   diff
 *   A            1      22   22.0   1-0-0    +20
 *   B            5      84   16.8   4-1-0    +48
 *   C            5      63   12.6   3-1-1     +6
 *   D            5      49    9.8   2-1-2    -22
 *   E            5      45    9.0   0-1-4    -30
 *   F            3      25    8.33  0-0-3    -22
 */
const MIXED_ROUNDS: Round[] = [
  makeRound(0, SIX, [{ a: ['A', 'B'], b: ['C', 'D'], scoreA: 22 }]),
  makeRound(1, SIX, [{ a: ['B', 'C'], b: ['E', 'F'], scoreA: 20 }]),
  makeRound(2, SIX, [{ a: ['B', 'D'], b: ['E', 'F'], scoreA: 14 }]),
  makeRound(3, SIX, [{ a: ['B', 'C'], b: ['D', 'E'], scoreA: 16 }]),
  makeRound(4, SIX, [{ a: ['C', 'D'], b: ['E', 'F'], scoreA: 13 }]),
  makeRound(5, SIX, [{ a: ['B', 'D'], b: ['C', 'E'], scoreA: 12 }]),
];

function mixedState(rankingMetric: RankingMetric, podiumMinRoundsPct = 0.5): TournamentState {
  return makeState({
    players: roster(SIX),
    rounds: MIXED_ROUNDS,
    rankingMetric,
    podiumMinRoundsPct,
  });
}

describe('standings', () => {
  it('adds the scoresheet up exactly', () => {
    const rows = standings(mixedState('ppr'));

    // Highest max is 5 rounds, so at the default 50% the bar is ceil(2.5) = 3.
    expect(rowFor(rows, 'A')).toStrictEqual({
      playerId: 'A',
      roundsPlayed: 1,
      totalPoints: 22,
      ppr: 22,
      wins: 1,
      draws: 0,
      losses: 0,
      pointDiff: 20,
      podiumEligible: false,
    });
    expect(rowFor(rows, 'B')).toStrictEqual({
      playerId: 'B',
      roundsPlayed: 5,
      totalPoints: 84,
      ppr: 84 / 5,
      wins: 4,
      draws: 1,
      losses: 0,
      pointDiff: 48,
      podiumEligible: true,
    });
    expect(rowFor(rows, 'C')).toStrictEqual({
      playerId: 'C',
      roundsPlayed: 5,
      totalPoints: 63,
      ppr: 63 / 5,
      wins: 3,
      draws: 1,
      losses: 1,
      pointDiff: 6,
      podiumEligible: true,
    });
    expect(rowFor(rows, 'D')).toStrictEqual({
      playerId: 'D',
      roundsPlayed: 5,
      totalPoints: 49,
      ppr: 49 / 5,
      wins: 2,
      draws: 1,
      losses: 2,
      pointDiff: -22,
      podiumEligible: true,
    });
    expect(rowFor(rows, 'E')).toStrictEqual({
      playerId: 'E',
      roundsPlayed: 5,
      totalPoints: 45,
      ppr: 9,
      wins: 0,
      draws: 1,
      losses: 4,
      pointDiff: -30,
      podiumEligible: true,
    });
    expect(rowFor(rows, 'F')).toStrictEqual({
      playerId: 'F',
      roundsPlayed: 3,
      totalPoints: 25,
      ppr: 25 / 3,
      wins: 0,
      draws: 0,
      losses: 3,
      pointDiff: -22,
      podiumEligible: true,
    });
  });

  it('ranks the same six players three different ways for ppr, total and wins', () => {
    // ppr: A's single 22-point round is the best rate on the night.
    const byPpr = order(standings(mixedState('ppr')));
    // total: the same round is the worst haul, so A falls to last.
    const byTotal = order(standings(mixedState('total')));
    // wins: A's one win lifts them back over E and F, who never won anything;
    // E edges F on the total-points tie-break.
    const byWins = order(standings(mixedState('wins')));

    expect(byPpr).toStrictEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(byTotal).toStrictEqual(['B', 'C', 'D', 'E', 'F', 'A']);
    expect(byWins).toStrictEqual(['B', 'C', 'D', 'A', 'E', 'F']);

    // Guard the fixture itself: if a future edit collapses two of these into
    // the same order the test above would still pass but prove nothing.
    const orders = new Set([byPpr, byTotal, byWins].map((ids) => ids.join('')));
    expect(orders.size, 'the three metrics no longer disagree').toBe(3);
  });

  it('gives a player with no played rounds a ppr of 0, not NaN', () => {
    const withBench = ['A', 'B', 'C', 'D', 'Z'];
    const state = makeState({
      players: roster(withBench),
      rounds: [makeRound(0, withBench, [{ a: ['A', 'B'], b: ['C', 'D'], scoreA: 14 }])],
    });

    const z = rowFor(standings(state), 'Z');
    expect(z.roundsPlayed).toBe(0);
    expect(z.totalPoints).toBe(0);
    expect(Number.isNaN(z.ppr), 'ppr divided by zero rounds').toBe(false);
    expect(z.ppr).toBe(0);
    expect(z.pointDiff).toBe(0);
    expect(z.wins + z.draws + z.losses).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tie-breaks, in the order SPEC.md lists them:
// metric, then total points, then point diff, then wins, then roster order.
// ---------------------------------------------------------------------------

describe('tie-break chain', () => {
  const SIX_XY = ['X', 'Y', 'P', 'Q', 'R', 'S'];
  const SIX_YX = ['Y', 'X', 'P', 'Q', 'R', 'S'];

  it('breaks a ppr tie on total points', () => {
    // X: one 12-12 draw          -> 1 round, 12 points, ppr 12
    // Y: two 12-12 draws         -> 2 rounds, 24 points, ppr 12
    // X is earlier in the roster, so only total points can lift Y above them.
    const state = makeState({
      players: roster(SIX_XY),
      rounds: [
        makeRound(0, SIX_XY, [{ a: ['X', 'P'], b: ['Y', 'Q'], scoreA: 12 }]),
        makeRound(1, SIX_XY, [{ a: ['Y', 'R'], b: ['P', 'S'], scoreA: 12 }]),
      ],
      rankingMetric: 'ppr',
    });
    const rows = standings(state);

    expect(rowFor(rows, 'Y').ppr).toBe(rowFor(rows, 'X').ppr);
    expect(rowFor(rows, 'Y').totalPoints).toBeGreaterThan(rowFor(rows, 'X').totalPoints);
    expect(placeOf(rows, 'Y')).toBeLessThan(placeOf(rows, 'X'));
  });

  it('consults total points before point diff', () => {
    // Under fixed-total scoring, diff = 2 * total - rounds * pointsPerMatch, so
    // below a ppr of half the match total the two tie-breaks point in opposite
    // directions. That makes their order observable.
    //
    // X: one 8-16 loss    -> 1 round,  8 points, ppr 8, diff  -8
    // Y: two 8-16 losses  -> 2 rounds, 16 points, ppr 8, diff -16
    //
    // Total says Y, diff says X. Total is first, so Y wins — and X is earlier
    // in the roster, so roster order is not doing the work either.
    const state = makeState({
      players: roster(SIX_XY),
      rounds: [
        makeRound(0, SIX_XY, [{ a: ['X', 'P'], b: ['Q', 'R'], scoreA: 8 }]),
        makeRound(1, SIX_XY, [{ a: ['Y', 'P'], b: ['Q', 'S'], scoreA: 8 }]),
        makeRound(2, SIX_XY, [{ a: ['Y', 'R'], b: ['P', 'S'], scoreA: 8 }]),
      ],
      rankingMetric: 'ppr',
    });
    const rows = standings(state);

    expect(rowFor(rows, 'Y').ppr).toBe(rowFor(rows, 'X').ppr);
    expect(rowFor(rows, 'Y').totalPoints).toBeGreaterThan(rowFor(rows, 'X').totalPoints);
    expect(rowFor(rows, 'Y').pointDiff).toBeLessThan(rowFor(rows, 'X').pointDiff);
    expect(placeOf(rows, 'Y'), 'point diff overruled total points').toBeLessThan(
      placeOf(rows, 'X'),
    );
  });

  it('breaks a total-points tie on point diff', () => {
    // Ranking on total, where every one of the six ends on exactly 24 points,
    // so the primary metric and the first tie-break are both spent.
    //
    // X: one 24-0 win    -> 1 round,  24 points, diff +24
    // Y: two 12-12 draws -> 2 rounds, 24 points, diff   0
    // Y is earlier in the roster, so only diff can lift X above them.
    const state = makeState({
      players: roster(SIX_YX),
      rounds: [
        makeRound(0, SIX_YX, [{ a: ['X', 'P'], b: ['Q', 'R'], scoreA: 24 }]),
        makeRound(1, SIX_YX, [{ a: ['Y', 'Q'], b: ['R', 'S'], scoreA: 12 }]),
        makeRound(2, SIX_YX, [{ a: ['Y', 'R'], b: ['Q', 'S'], scoreA: 12 }]),
      ],
      rankingMetric: 'total',
    });
    const rows = standings(state);

    expect(rowFor(rows, 'X').totalPoints).toBe(rowFor(rows, 'Y').totalPoints);
    expect(rowFor(rows, 'X').pointDiff).toBeGreaterThan(rowFor(rows, 'Y').pointDiff);
    expect(placeOf(rows, 'X')).toBeLessThan(placeOf(rows, 'Y'));

    // The whole board, which also pins roster order as the last resort three
    // times over: X/P, Y/S and Q/R are each pairs with identical rows.
    expect(order(rows)).toStrictEqual(['X', 'P', 'Y', 'S', 'Q', 'R']);
  });

  it('consults point diff before wins', () => {
    // X: three 12-12 draws                -> 3 rounds, 36 points, diff   0, 0 wins
    // Y: 13-11, 13-11, 10-14, 0-24        -> 4 rounds, 36 points, diff -24, 2 wins
    //
    // Diff says X, wins says Y. Diff is first, so X wins — and Y is earlier in
    // the roster, so roster order is not doing the work either.
    const SIX_A = ['Y', 'X', 'A1', 'A2', 'A3', 'A4'];
    const state = makeState({
      players: roster(SIX_A),
      rounds: [
        makeRound(0, SIX_A, [{ a: ['X', 'A1'], b: ['A2', 'A3'], scoreA: 12 }]),
        makeRound(1, SIX_A, [{ a: ['X', 'A2'], b: ['A3', 'A4'], scoreA: 12 }]),
        makeRound(2, SIX_A, [{ a: ['X', 'A3'], b: ['A1', 'A4'], scoreA: 12 }]),
        makeRound(3, SIX_A, [{ a: ['Y', 'A1'], b: ['A2', 'A3'], scoreA: 13 }]),
        makeRound(4, SIX_A, [{ a: ['Y', 'A2'], b: ['A3', 'A4'], scoreA: 13 }]),
        makeRound(5, SIX_A, [{ a: ['Y', 'A3'], b: ['A1', 'A4'], scoreA: 10 }]),
        makeRound(6, SIX_A, [{ a: ['Y', 'A4'], b: ['A1', 'A2'], scoreA: 0 }]),
      ],
      rankingMetric: 'total',
    });
    const rows = standings(state);

    expect(rowFor(rows, 'X').totalPoints).toBe(rowFor(rows, 'Y').totalPoints);
    expect(rowFor(rows, 'X').pointDiff).toBeGreaterThan(rowFor(rows, 'Y').pointDiff);
    expect(rowFor(rows, 'Y').wins).toBeGreaterThan(rowFor(rows, 'X').wins);
    expect(placeOf(rows, 'X'), 'wins overruled point diff').toBeLessThan(placeOf(rows, 'Y'));
  });

  it('breaks a ppr, total and diff tie on wins', () => {
    // X: two 12-12 draws     -> 2 rounds, 24 points, ppr 12, diff 0, 0 wins
    // Y: one 20-4, one 4-20  -> 2 rounds, 24 points, ppr 12, diff 0, 1 win
    //
    // Under fixed-total scoring, equal ppr plus equal total forces equal
    // rounds and therefore equal diff, so wins is the first tie-break that can
    // separate these two at all. X is earlier in the roster.
    const state = makeState({
      players: roster(SIX_XY),
      rounds: [
        makeRound(0, SIX_XY, [{ a: ['X', 'P'], b: ['Q', 'R'], scoreA: 12 }]),
        makeRound(1, SIX_XY, [{ a: ['X', 'Q'], b: ['R', 'S'], scoreA: 12 }]),
        makeRound(2, SIX_XY, [{ a: ['Y', 'P'], b: ['Q', 'S'], scoreA: 20 }]),
        makeRound(3, SIX_XY, [{ a: ['Y', 'R'], b: ['P', 'S'], scoreA: 4 }]),
      ],
      rankingMetric: 'ppr',
    });
    const rows = standings(state);

    const x = rowFor(rows, 'X');
    const y = rowFor(rows, 'Y');
    expect(y.ppr).toBe(x.ppr);
    expect(y.totalPoints).toBe(x.totalPoints);
    expect(y.pointDiff).toBe(x.pointDiff);
    expect(y.wins).toBeGreaterThan(x.wins);
    expect(placeOf(rows, 'Y')).toBeLessThan(placeOf(rows, 'X'));
  });

  it('falls back to roster order when every metric ties', () => {
    // All four sat through the same 12-12 draw, so every field is identical
    // and the order they entered the draw is the only thing left.
    const four = ['D', 'C', 'B', 'A'];
    const state = makeState({
      players: roster(four),
      rounds: [makeRound(0, four, [{ a: ['D', 'C'], b: ['B', 'A'], scoreA: 12 }])],
    });
    const rows = standings(state);

    expect(order(rows)).toStrictEqual(four);
  });
});

// ---------------------------------------------------------------------------
// Podium eligibility
// ---------------------------------------------------------------------------

describe('podium eligibility', () => {
  // The bar is ceil(pct x maxRoundsPlayed); in this fixture the max is 5, A
  // played 1 and F played 3.
  const CASES: ReadonlyArray<{ pct: number; bar: number; eligible: string[] }> = [
    { pct: 0, bar: 0, eligible: ['A', 'B', 'C', 'D', 'E', 'F'] },
    // ceil(0.2 x 5) = 1, and A has exactly 1: exactly at the bar is in.
    { pct: 0.2, bar: 1, eligible: ['A', 'B', 'C', 'D', 'E', 'F'] },
    // A hair above, and A's single round is no longer enough.
    { pct: 0.21, bar: 2, eligible: ['B', 'C', 'D', 'E', 'F'] },
    // ceil(2.5) = 3, and F has exactly 3: exactly at a rounded-up bar is in.
    { pct: 0.5, bar: 3, eligible: ['B', 'C', 'D', 'E', 'F'] },
    { pct: 0.7, bar: 4, eligible: ['B', 'C', 'D', 'E'] },
    { pct: 1, bar: 5, eligible: ['B', 'C', 'D', 'E'] },
  ];

  for (const { pct, bar, eligible } of CASES) {
    it(`marks ${eligible.length} of six eligible at ${pct * 100}% of the max`, () => {
      // Restate the arithmetic so a floating-point surprise in the table shows
      // up here rather than as a mysterious eligibility failure.
      expect(Math.ceil(pct * 5), 'the expected bar in this case is wrong').toBe(bar);

      const rows = standings(mixedState('ppr', pct));
      const marked = rows.filter((row) => row.podiumEligible).map((row) => row.playerId);
      expect(marked.slice().sort()).toStrictEqual(eligible.slice().sort());

      // Ineligible players stay on the board with a badge; they are not hidden.
      expect(rows).toHaveLength(6);
    });
  }
});

describe('podium', () => {
  it('takes the top three eligible players and steps over the rest', () => {
    // A tops the ppr board on a rate of 22 a round but played only 1 of the 5
    // the leaders played, so the podium starts at B.
    const state = mixedState('ppr');
    expect(order(standings(state))[0]).toBe('A');
    expect(rowFor(standings(state), 'A').podiumEligible).toBe(false);
    expect(order(podium(state))).toStrictEqual(['B', 'C', 'D']);
  });

  it('lets the same player onto the podium once the bar is dropped to zero', () => {
    expect(order(podium(mixedState('ppr', 0)))).toStrictEqual(['A', 'B', 'C']);
  });

  it('returns the standings rows themselves, unchanged', () => {
    const state = mixedState('total');
    const rows = standings(state);
    expect(podium(state)).toStrictEqual(rows.filter((row) => row.podiumEligible).slice(0, 3));
  });

  it('returns fewer than three when fewer than three qualify', () => {
    // A and B play every round; the other four rotate through two apiece or
    // fewer. At 100% the bar is 3 rounds, so only two players clear it.
    const six = ['A', 'B', 'C', 'D', 'E', 'F'];
    const state = makeState({
      players: roster(six),
      rounds: [
        makeRound(0, six, [{ a: ['A', 'B'], b: ['C', 'D'], scoreA: 20 }]),
        makeRound(1, six, [{ a: ['A', 'C'], b: ['B', 'E'], scoreA: 12 }]),
        makeRound(2, six, [{ a: ['A', 'D'], b: ['B', 'F'], scoreA: 15 }]),
      ],
      podiumMinRoundsPct: 1,
    });

    const top = podium(state);
    expect(order(top)).toStrictEqual(['A', 'B']);
    expect(top.length).toBeLessThanOrEqual(3);
  });

  it('never returns more than three', () => {
    for (const metric of ['ppr', 'total', 'wins'] as const) {
      expect(podium(mixedState(metric, 0)).length).toBeLessThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Departures
// ---------------------------------------------------------------------------

describe('players who left', () => {
  const FIVE = ['A', 'B', 'C', 'D', 'X'];
  const FOUR = ['A', 'B', 'C', 'D'];

  // X plays rounds 0 and 1, then leaves before round 2:
  //   18-6 loss (6 points) and 10-14 loss (10 points)
  //   -> 2 rounds, 16 points, ppr 8, diff -16, 0-0-2.
  const PLAYED_WITH_X: Round[] = [
    makeRound(0, FIVE, [{ a: ['A', 'B'], b: ['C', 'X'], scoreA: 18 }]),
    makeRound(1, FIVE, [{ a: ['A', 'X'], b: ['B', 'D'], scoreA: 10 }]),
    makeRound(2, FOUR, [{ a: ['A', 'B'], b: ['C', 'D'], scoreA: 12 }]),
  ];

  const AFTER_X: Round[] = [
    makeRound(3, FOUR, [{ a: ['A', 'C'], b: ['B', 'D'], scoreA: 20 }]),
    makeRound(4, FOUR, [{ a: ['A', 'D'], b: ['B', 'C'], scoreA: 9 }]),
  ];

  const departure: RosterEvent = { type: 'leave', playerId: 'X', beforeRound: 2 };

  function stateWith(rounds: readonly Round[]): TournamentState {
    return makeState({
      players: [...roster(FOUR), departedPlayer('X')],
      rounds,
      events: [departure],
    });
  }

  it('keeps a departed player on the board with the points they actually scored', () => {
    const rows = standings(stateWith(PLAYED_WITH_X));

    expect(order(rows), 'X fell off the leaderboard on leaving').toContain('X');
    expect(rowFor(rows, 'X')).toStrictEqual({
      playerId: 'X',
      roundsPlayed: 2,
      totalPoints: 16,
      ppr: 8,
      wins: 0,
      draws: 0,
      losses: 2,
      pointDiff: -16,
      podiumEligible: true,
    });
  });

  it('freezes their stats while the tournament plays on without them', () => {
    const before = rowFor(standings(stateWith(PLAYED_WITH_X)), 'X');
    const after = rowFor(standings(stateWith([...PLAYED_WITH_X, ...AFTER_X])), 'X');

    expect(after.roundsPlayed).toBe(before.roundsPlayed);
    expect(after.totalPoints).toBe(before.totalPoints);
    expect(after.ppr).toBe(before.ppr);
    expect(after.wins).toBe(before.wins);
    expect(after.draws).toBe(before.draws);
    expect(after.losses).toBe(before.losses);
    expect(after.pointDiff).toBe(before.pointDiff);

    // podiumEligible is the one field that may move, and it is not their stats
    // moving: the bar is a fraction of the *current* maximum, which climbs from
    // 3 rounds to 5 while X stands still on 2. ceil(0.5 x 3) = 2 lets X in,
    // ceil(0.5 x 5) = 3 does not.
    expect(before.podiumEligible).toBe(true);
    expect(after.podiumEligible).toBe(false);
  });
});
