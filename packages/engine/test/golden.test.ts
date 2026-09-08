/**
 * THE GOLDEN FIXTURE — the executable spec.
 *
 * If you are porting this engine to another language, port this file first and
 * make it pass. It is one complete tournament, told as a story, with the state
 * snapshotted after every single round.
 *
 * THE STORY
 * ---------
 * Eight friends book two courts for a Mexicano to 24 points. Over nine rounds
 * the roster changes four times, and the whole point of tanteo is that every
 * point ever scored stays with the human who actually played it.
 *
 *   round  who is in the draw                                        active
 *   -----  -------------------------------------------------------  ------
 *     0    Adi Bima Cahya Dewi Eko Gita Hana Indra                      8
 *     1    (same)                                                       8
 *     2    (same)                                                       8
 *     3    (same)                                                       8
 *     4    + Budi joins, seeded 'middle'                                9   -> 1 sits out
 *     5    (same)                                                       9   -> 1 sits out
 *     6    - Dewi leaves.  Eko -> Fajar (substitution)                  8
 *     7    + Citra joins, no seed at all                                9   -> 1 sits out
 *     8    (same)                                                       9   -> 1 sits out
 *
 * Nothing here is random in the everyday sense: the engine's only source of
 * randomness is the seeded PRNG carried in state, so this whole file replays bit
 * for bit. That is asserted at the bottom.
 *
 * Two kinds of check live below:
 *   1. `toMatchSnapshot()` on the full state after every round — the byte-exact
 *      record, in test/__snapshots__/golden.test.ts.snap.
 *   2. A block of named assertions that pin the things that must hold whatever
 *      the pairing algorithm decides. Those are the real spec; the snapshot is
 *      the receipt.
 */
import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  applyRosterEvent,
  createTournament,
  generateNextRound,
  podium,
  recordScore,
  standings,
} from '../src/index.js';
import type { Round, Standing, TournamentState } from '../src/index.js';

// ---------------------------------------------------------------------------
// The setup
// ---------------------------------------------------------------------------

const SEED = 'tanteo-golden';
const COURTS = 2;
const POINTS_PER_MATCH = 24;
const ROUNDS = 9;

/** Round indices at which the roster changes, named so assertions read as prose. */
const BUDI_JOINS_BEFORE = 4;
const HANDOVER_ROUND = 6; // Dewi leaves and Fajar takes Eko's slot before this round
const CITRA_JOINS_BEFORE = 7;

const STARTERS = [
  { id: 'adi', name: 'Adi' },
  { id: 'bima', name: 'Bima' },
  { id: 'cahya', name: 'Cahya' },
  { id: 'dewi', name: 'Dewi' },
  { id: 'eko', name: 'Eko' },
  { id: 'gita', name: 'Gita' },
  { id: 'hana', name: 'Hana' },
  { id: 'indra', name: 'Indra' },
];

type ScoreLine = readonly [number, number];

/**
 * The results, decided in advance so the fixture is arithmetic rather than luck.
 * One row per round, one entry per court in the order the round lists them.
 * Every line totals 24, because Mexicano is fixed-total scoring.
 *
 * Deliberately included: a 12-12 draw (round 1, court 2 and others) so draws are
 * exercised, and a 24-0 whitewash (round 6) so zero is proved to be a legal
 * score rather than an accident of the validator.
 */
const SCORE_TABLE: readonly (readonly ScoreLine[])[] = [
  /* round 0 */ [[15, 9], [13, 11]],
  /* round 1 */ [[12, 12], [16, 8]],
  /* round 2 */ [[14, 10], [11, 13]],
  /* round 3 */ [[18, 6], [12, 12]],
  /* round 4 */ [[13, 11], [17, 7]],
  /* round 5 */ [[10, 14], [15, 9]],
  /* round 6 */ [[24, 0], [12, 12]],
  /* round 7 */ [[13, 11], [14, 10]],
  /* round 8 */ [[16, 8], [12, 12]],
];

/** Shown as the test name, so the snapshot file reads as the story too. */
const ROUND_STORY: readonly string[] = [
  'round 0 — eight starters, paired by the seeded shuffle',
  'round 1 — pairing now follows the standings',
  'round 2',
  'round 3 — the last round of the original eight',
  'round 4 — Budi joins with a middle seed, so somebody sits out',
  'round 5',
  'round 6 — Dewi leaves, and Fajar takes over Eko’s slot',
  'round 7 — Citra joins, no seed',
  'round 8 — last round',
];

// ---------------------------------------------------------------------------
// Playing the tournament
// ---------------------------------------------------------------------------

function roundAt(state: TournamentState, index: number): Round {
  const round = state.rounds[index];
  if (!round) throw new Error(`fixture error: round ${index} was never generated`);
  return round;
}

/**
 * Mexicano keeps no precomputed schedule, and a roster event drops the unscored
 * tail, so the fixture only asks for a round once the roster for it is settled.
 * `createTournament` may or may not have already laid down round 0 — both are
 * spec-legal — so pull rounds forward until the one we want exists.
 */
function ensureRound(state: TournamentState, index: number): TournamentState {
  let next = state;
  while (next.rounds.length <= index) next = generateNextRound(next);
  return next;
}

/** Records the table's result on every court of one round. */
function scoreEveryCourt(state: TournamentState, roundIndex: number): TournamentState {
  const results = SCORE_TABLE[roundIndex];
  if (!results) throw new Error(`fixture error: no scores written for round ${roundIndex}`);

  let next = state;
  roundAt(state, roundIndex).matches.forEach((match, slot) => {
    const line = results[slot];
    if (!line) {
      throw new Error(
        `fixture error: round ${roundIndex} has ${roundAt(state, roundIndex).matches.length} ` +
          `courts but the score table only covers ${results.length}`,
      );
    }
    next = recordScore(next, roundIndex, match.court, line[0], line[1]);
  });
  return next;
}

/**
 * The roster changes, applied just before the round they take effect in — which
 * is also the only time they are legal, since an event at or below the last
 * scored round is HISTORY_IMMUTABLE.
 */
function rosterChangesBefore(state: TournamentState, roundIndex: number): TournamentState {
  switch (roundIndex) {
    case BUDI_JOINS_BEFORE: {
      // Budi turns up three rounds late with no results to sort him on, so he
      // carries a 'middle' pairing seed. Mexicano slots him into the middle of
      // the standings for pairing purposes only; the seed never reaches the
      // leaderboard and expires the moment he has one played round.
      const registered = addPlayer(state, { id: 'budi', name: 'Budi' });
      return applyRosterEvent(registered, {
        type: 'join',
        playerId: 'budi',
        beforeRound: BUDI_JOINS_BEFORE,
        seed: 'middle',
      });
    }
    case HANDOVER_ROUND: {
      // Dewi has to go. Her five rounds stay on the board exactly as they are.
      const withoutDewi = applyRosterEvent(state, {
        type: 'leave',
        playerId: 'dewi',
        beforeRound: HANDOVER_ROUND,
      });
      // Eko hands his slot to Fajar. Eko keeps every point he scored in rounds
      // 0-5 forever; Fajar inherits the schedule position and nothing else.
      const registered = addPlayer(withoutDewi, { id: 'fajar', name: 'Fajar' });
      return applyRosterEvent(registered, {
        type: 'substitute',
        outgoingId: 'eko',
        incomingId: 'fajar',
        beforeRound: HANDOVER_ROUND,
      });
    }
    case CITRA_JOINS_BEFORE: {
      // Citra arrives with no seed at all. Under exactOptionalPropertyTypes the
      // key is absent, not set to undefined — the engine must handle both the
      // seeded and the unseeded late joiner.
      const registered = addPlayer(state, { id: 'citra', name: 'Citra' });
      return applyRosterEvent(registered, {
        type: 'join',
        playerId: 'citra',
        beforeRound: CITRA_JOINS_BEFORE,
      });
    }
    default:
      return state;
  }
}

/** Returns the state after each round was fully scored, indexed by round. */
function playGoldenTournament(): readonly TournamentState[] {
  let state = createTournament(
    {
      name: 'Golden Mexicano',
      format: 'mexicano',
      courts: COURTS,
      pointsPerMatch: POINTS_PER_MATCH,
      seed: SEED,
    },
    [...STARTERS],
  );

  const afterRound: TournamentState[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    state = rosterChangesBefore(state, round);
    state = ensureRound(state, round);
    state = scoreEveryCourt(state, round);
    afterRound.push(state);
  }
  return afterRound;
}

const timeline = playGoldenTournament();

function at(round: number): TournamentState {
  const state = timeline[round];
  if (!state) throw new Error(`fixture error: no state recorded for round ${round}`);
  return state;
}

const final = at(ROUNDS - 1);

// ---------------------------------------------------------------------------
// Reading the results back
// ---------------------------------------------------------------------------

function standingFor(state: TournamentState, playerId: string): Standing {
  const found = standings(state).find((s) => s.playerId === playerId);
  if (!found) throw new Error(`${playerId} is missing from the leaderboard`);
  return found;
}

type Earned = Pick<
  Standing,
  'roundsPlayed' | 'totalPoints' | 'ppr' | 'wins' | 'draws' | 'losses' | 'pointDiff'
>;

/**
 * The fields a player earns on court. `podiumEligible` is left out on purpose:
 * it is measured against the busiest player in the field, so it can change after
 * somebody leaves without anything of theirs having moved.
 */
function earned(s: Standing): Earned {
  return {
    roundsPlayed: s.roundsPlayed,
    totalPoints: s.totalPoints,
    ppr: s.ppr,
    wins: s.wins,
    draws: s.draws,
    losses: s.losses,
    pointDiff: s.pointDiff,
  };
}

interface Tally {
  rounds: number;
  points: number;
  conceded: number;
}

/**
 * Recounts a player's results straight off the match log, independently of
 * standings(). If these two ever disagree, the leaderboard is lying about who
 * scored what — which is the one thing this engine may not do.
 */
function tally(
  state: TournamentState,
  playerId: string,
  fromRound = 0,
  toRoundExclusive = Number.MAX_SAFE_INTEGER,
): Tally {
  const result: Tally = { rounds: 0, points: 0, conceded: 0 };
  for (const round of state.rounds) {
    if (round.index < fromRound || round.index >= toRoundExclusive) continue;
    for (const match of round.matches) {
      const { scoreA, scoreB } = match;
      if (scoreA === undefined || scoreB === undefined) continue;
      if (match.teamA.includes(playerId)) {
        result.rounds += 1;
        result.points += scoreA;
        result.conceded += scoreB;
      } else if (match.teamB.includes(playerId)) {
        result.rounds += 1;
        result.points += scoreB;
        result.conceded += scoreA;
      }
    }
  }
  return result;
}

/** In the draw for this round at all — on court or explicitly sitting out. */
function inDraw(round: Round, playerId: string): boolean {
  return (
    round.sitOuts.includes(playerId) ||
    round.matches.some((m) => m.teamA.includes(playerId) || m.teamB.includes(playerId))
  );
}

function roundsFrom(state: TournamentState, firstIndex: number): Round[] {
  return state.rounds.filter((r) => r.index >= firstIndex);
}

/** A readable leaderboard for the snapshot: ids alone are hard to proofread. */
function leaderboard(state: TournamentState): unknown[] {
  const names = new Map(state.players.map((p) => [p.id, p.name]));
  return standings(state).map((s, i) => ({
    rank: i + 1,
    player: names.get(s.playerId) ?? s.playerId,
    played: s.roundsPlayed,
    points: s.totalPoints,
    ppr: Number(s.ppr.toFixed(4)),
    record: `${s.wins}W ${s.draws}D ${s.losses}L`,
    diff: s.pointDiff,
    podiumEligible: s.podiumEligible,
  }));
}

// ===========================================================================
// 1. The byte-exact record
// ===========================================================================

describe('the tournament, round by round', () => {
  for (const [index, state] of timeline.entries()) {
    it(ROUND_STORY[index] ?? `round ${index}`, () => {
      expect(state).toMatchSnapshot();
    });
  }

  it('final leaderboard', () => {
    expect(leaderboard(final)).toMatchSnapshot();
  });

  it('podium', () => {
    const names = new Map(final.players.map((p) => [p.id, p.name]));
    expect(podium(final).map((s) => names.get(s.playerId) ?? s.playerId)).toMatchSnapshot();
  });
});

// ===========================================================================
// 2. The things that must hold however the pairing shuffles
//
//    Read these, not the snapshot, to understand what the engine promises.
// ===========================================================================

describe('the roster moved, but the points did not', () => {
  it('Dewi left after round 5, so her round-5 stats ARE her final stats', () => {
    const atHerLastRound = earned(standingFor(at(5), 'dewi'));
    const atTheEnd = earned(standingFor(final, 'dewi'));

    expect(atTheEnd).toEqual(atHerLastRound);
    // Guard against a vacuously-true match: she really did play.
    expect(atTheEnd.roundsPlayed).toBeGreaterThan(0);
    expect(atTheEnd.totalPoints).toBeGreaterThan(0);

    // Three more rounds happened without her, and she was in none of them...
    for (const round of roundsFrom(final, HANDOVER_ROUND)) {
      expect(inDraw(round, 'dewi')).toBe(false);
    }
    // ...but she is still on the leaderboard. Leaving is not deletion.
    expect(standings(final).map((s) => s.playerId)).toContain('dewi');
  });

  it('Eko keeps every point from rounds 0-5 after Fajar takes his slot', () => {
    const atHandover = earned(standingFor(at(HANDOVER_ROUND - 1), 'eko'));
    const atTheEnd = earned(standingFor(final, 'eko'));

    // Invariant 5: substitution never moves historical points between players.
    expect(atTheEnd).toEqual(atHandover);
    expect(atTheEnd.roundsPlayed).toBeGreaterThan(0);

    // And the leaderboard agrees with the match log, recounted from scratch.
    const fromTheLog = tally(final, 'eko');
    expect(fromTheLog.rounds).toBe(atTheEnd.roundsPlayed);
    expect(fromTheLog.points).toBe(atTheEnd.totalPoints);
    expect(fromTheLog.points - fromTheLog.conceded).toBe(atTheEnd.pointDiff);

    // Every one of those rounds is before the handover; none after.
    expect(tally(final, 'eko', HANDOVER_ROUND).rounds).toBe(0);
    for (const round of roundsFrom(final, HANDOVER_ROUND)) {
      expect(inDraw(round, 'eko')).toBe(false);
    }

    // The two records point at each other, so the UI can tell the story.
    expect(final.players.find((p) => p.id === 'eko')?.replacedBy).toBe('fajar');
    expect(final.players.find((p) => p.id === 'fajar')?.replaces).toBe('eko');
  });

  it('Fajar is credited with the rounds since he arrived, and not one before', () => {
    const fajar = standingFor(final, 'fajar');

    // He came in before round 6 of 9, so rounds 6, 7 and 8 were available to
    // him — minus any he sat out. Sit-outs are counted rather than assumed,
    // because which player rests in which round is the pairing engine's call.
    const roundsAvailable = ROUNDS - HANDOVER_ROUND;
    const satOut = roundsFrom(final, HANDOVER_ROUND).filter((r) =>
      r.sitOuts.includes('fajar'),
    ).length;
    expect(fajar.roundsPlayed).toBe(roundsAvailable - satOut);

    // Nothing from Eko's half of the tournament leaked onto him.
    expect(tally(final, 'fajar', 0, HANDOVER_ROUND).rounds).toBe(0);
    expect(fajar.roundsPlayed).toBe(tally(final, 'fajar').rounds);
    expect(fajar.totalPoints).toBe(tally(final, 'fajar').points);
    expect(final.players.find((p) => p.id === 'fajar')?.joinedBeforeRound).toBe(HANDOVER_ROUND);
  });

  it('Budi and Citra are judged on their own rounds: ppr divides by rounds PLAYED', () => {
    const lateJoiners = [
      { id: 'budi', joinedBefore: BUDI_JOINS_BEFORE },
      { id: 'citra', joinedBefore: CITRA_JOINS_BEFORE },
    ];

    for (const { id, joinedBefore } of lateJoiners) {
      const s = standingFor(final, id);
      const log = tally(final, id);

      // They played, but they did not play everything.
      expect(s.roundsPlayed).toBeGreaterThan(0);
      expect(s.roundsPlayed).toBeLessThanOrEqual(ROUNDS - joinedBefore);
      expect(tally(final, id, 0, joinedBefore).rounds).toBe(0);

      // The leaderboard's arithmetic, recomputed independently.
      expect(s.roundsPlayed).toBe(log.rounds);
      expect(s.totalPoints).toBe(log.points);
      expect(s.ppr).toBeCloseTo(log.points / log.rounds, 10);

      // The whole reason ppr is the default metric: dividing by the nine rounds
      // the tournament ran would punish them for arriving late. It does not.
      expect(s.ppr).toBeGreaterThan(s.totalPoints / ROUNDS);
    }

    // Citra played 2 rounds of a 9-round night, so she stays on the leaderboard
    // with a badge but cannot take a podium place off someone who played all of
    // it. The threshold is recomputed here rather than hard-coded.
    const busiest = Math.max(...standings(final).map((s) => s.roundsPlayed));
    const needed = Math.ceil(final.config.podiumMinRoundsPct * busiest);
    expect(standingFor(final, 'citra').roundsPlayed).toBeLessThan(needed);
    expect(standingFor(final, 'citra').podiumEligible).toBe(false);
    expect(podium(final).map((s) => s.playerId)).not.toContain('citra');
    expect(standings(final).map((s) => s.playerId)).toContain('citra');
  });
});

describe('the invariants, checked over the finished tournament', () => {
  it('every recorded score totals pointsPerMatch', () => {
    for (const round of final.rounds) {
      for (const match of round.matches) {
        expect(match.scoreA).toBeTypeOf('number');
        expect(match.scoreB).toBeTypeOf('number');
        expect((match.scoreA ?? NaN) + (match.scoreB ?? NaN)).toBe(POINTS_PER_MATCH);
      }
    }
  });

  it('nobody appears twice in a round', () => {
    for (const round of final.rounds) {
      const everyone = [
        ...round.matches.flatMap((m) => [...m.teamA, ...m.teamB]),
        ...round.sitOuts,
      ];
      expect(new Set(everyone).size).toBe(everyone.length);
    }
  });

  it('every player in the draw either plays or sits out, and every court is full', () => {
    for (const round of final.rounds) {
      const onCourt = round.matches.flatMap((m) => [...m.teamA, ...m.teamB]);
      // min(courts, floor(active / 4)) * 4 players take the court.
      const active = onCourt.length + round.sitOuts.length;
      expect(onCourt.length).toBe(Math.min(COURTS, Math.floor(active / 4)) * 4);
      expect(round.matches.length).toBe(onCourt.length / 4);
    }
  });

  it('every standing agrees with the match log', () => {
    for (const s of standings(final)) {
      const log = tally(final, s.playerId);
      expect(s.roundsPlayed).toBe(log.rounds);
      expect(s.totalPoints).toBe(log.points);
      expect(s.pointDiff).toBe(log.points - log.conceded);
      expect(s.wins + s.draws + s.losses).toBe(log.rounds);
      expect(s.ppr).toBe(log.rounds === 0 ? 0 : log.points / log.rounds);
    }
  });

  it('everyone who was ever in the draw is on the final leaderboard', () => {
    const board = standings(final).map((s) => s.playerId);
    for (const id of ['adi', 'bima', 'cahya', 'dewi', 'eko', 'gita', 'hana', 'indra', 'budi', 'citra', 'fajar']) {
      expect(board).toContain(id);
    }
  });

  it('the podium is at most three eligible players, in standings order', () => {
    const board = standings(final);
    const top = podium(final);
    expect(top.length).toBeLessThanOrEqual(3);
    for (const s of top) expect(s.podiumEligible).toBe(true);
    const order = top.map((s) => board.findIndex((b) => b.playerId === s.playerId));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('determinism', () => {
  it('replays bit for bit from the seed alone', () => {
    // No clock, no Math.random: the same seed and the same events must give the
    // same nine rounds. This is what makes the snapshot above a spec rather
    // than a photograph of one lucky run.
    expect(JSON.stringify(playGoldenTournament())).toBe(JSON.stringify(timeline));
  });

  it('survives a JSON round trip unchanged', () => {
    // Invariant 8, and the reason state may hold no Map, Set, Date or class.
    const roundTripped = JSON.parse(JSON.stringify(final)) as TournamentState;
    expect(JSON.stringify(roundTripped)).toBe(JSON.stringify(final));
  });
});
