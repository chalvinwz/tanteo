/**
 * Property tests for the tanteo engine, written against SPEC.md.
 *
 * The generators build tournaments the spec claims to support — both formats,
 * 4–16 players, 1–4 courts, three point totals, three ranking metrics — and
 * then drive them forward with a script of legal organizer actions: score a
 * round, undo a score, and all five roster events. After every public call the
 * invariant under test is re-derived *by this file* from `state.rounds`, so a
 * bug in the engine's own accounting cannot vouch for itself.
 *
 * The only source of randomness is fast-check. The driver is a pure function
 * of the generated script, so any counterexample fast-check prints replays
 * exactly.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  EngineError,
  addPlayer,
  applyRosterEvent,
  clearScore,
  createTournament,
  generateNextRound,
  history,
  podium,
  recordScore,
  standings,
} from '../src/index.js';
import type {
  ErrorCode,
  Format,
  Player,
  RankingMetric,
  RosterEvent,
  Seed,
  Standing,
  TournamentConfigInput,
  TournamentState,
} from '../src/index.js';

const MAX_COURTS = 4;
/** The driver never lets the draw fall below a full court. See assumptions. */
const MIN_ACTIVE = 4;
/** Cap on latecomers, so a long script cannot balloon the schedule. */
const MAX_ROSTER = 20;
const MAX_SCRIPT = 8;
/**
 * Americano reschedules with a local search over the whole remaining draw, so
 * every roster event in a script costs real work. This is tuned to keep the
 * suite honest without making it a benchmark.
 */
const RUNS = 200;
const SLOW = 60_000;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Deep clone that keeps keys whose value is `undefined`.
 *
 * `structuredClone` needs @types/node, and cloning via JSON would silently
 * erase precisely the thing invariant 8 is hunting for, so purity snapshots
 * use this instead.
 */
function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => deepClone(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = deepClone(item);
    }
    return out as T;
  }
  return value;
}

function isEngineError(error: unknown, code: ErrorCode): boolean {
  return error instanceof EngineError && error.code === code;
}

/**
 * Invariant 7. Every public call is wrapped in this, so purity is checked on
 * every call the driver makes rather than at a handful of chosen points — and
 * on the throwing path too, where a half-finished mutation is most likely.
 */
function callPure<T>(state: TournamentState, label: string, call: (input: TournamentState) => T): T {
  const snapshot = deepClone(state);
  try {
    return call(state);
  } finally {
    expect(state, `${label} mutated the state it was given`).toStrictEqual(snapshot);
  }
}

interface Tally {
  roundsPlayed: number;
  totalPoints: number;
  wins: number;
  draws: number;
  losses: number;
  pointDiff: number;
}

const EMPTY_TALLY: Tally = {
  roundsPlayed: 0,
  totalPoints: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  pointDiff: 0,
};

/** The leaderboard, recomputed from the scoresheet without asking the engine. */
function tallyFromRounds(state: TournamentState): Map<string, Tally> {
  const tallies = new Map<string, Tally>();
  const credit = (playerId: string, mine: number, theirs: number): void => {
    const tally = tallies.get(playerId) ?? { ...EMPTY_TALLY };
    tally.roundsPlayed += 1;
    tally.totalPoints += mine;
    tally.pointDiff += mine - theirs;
    if (mine > theirs) tally.wins += 1;
    else if (mine === theirs) tally.draws += 1;
    else tally.losses += 1;
    tallies.set(playerId, tally);
  };

  for (const round of state.rounds) {
    for (const match of round.matches) {
      const { scoreA, scoreB } = match;
      if (scoreA === undefined || scoreB === undefined) continue;
      for (const playerId of match.teamA) credit(playerId, scoreA, scoreB);
      for (const playerId of match.teamB) credit(playerId, scoreB, scoreA);
    }
  }
  return tallies;
}

function lastScoredRoundIndex(state: TournamentState): number {
  for (let i = state.rounds.length - 1; i >= 0; i--) {
    const round = state.rounds[i];
    if (round && history.hasAnyScore(round)) return i;
  }
  return -1;
}

/** First round still missing a score on at least one court. */
function firstUnscoredRoundIndex(state: TournamentState): number {
  for (let i = 0; i < state.rounds.length; i++) {
    const round = state.rounds[i];
    if (!round || round.matches.length === 0) continue;
    if (round.matches.some((match) => match.scoreA === undefined || match.scoreB === undefined)) {
      return i;
    }
  }
  return -1;
}

/**
 * The earliest round a roster event may point at. SPEC.md makes any round at
 * or below a scored one immutable, so the first legal target is one past the
 * last round carrying a score. `null` means there is nothing left to
 * reschedule: an Americano schedule fully consumed.
 */
function nextOpenRound(state: TournamentState): number | null {
  const beforeRound = lastScoredRoundIndex(state) + 1;
  if (state.config.format === 'mexicano') return beforeRound; // rounds are minted on demand
  return beforeRound < state.rounds.length ? beforeRound : null;
}

function idsWithStatus(state: TournamentState, status: 'active' | 'paused'): string[] {
  return state.players.filter((player) => player.status === status).map((player) => player.id);
}

// ---------------------------------------------------------------------------
// Invariant checks
// ---------------------------------------------------------------------------

type Check = (state: TournamentState, label: string) => void;

const noCheck: Check = () => {};

function allOf(...checks: readonly Check[]): Check {
  return (state, label) => {
    for (const check of checks) check(state, label);
  };
}

/** Invariant 1: no player appears twice in one round, on court or on the bench. */
const checkNoDoubleBooking: Check = (state, label) => {
  state.rounds.forEach((round, position) => {
    // history.ts filters rounds by `round.index`, so index and position must
    // agree or every derived count silently drifts.
    expect(round.index, `${label}: round at position ${position} carries index ${round.index}`).toBe(
      position,
    );

    const drawn: string[] = [];
    for (const match of round.matches) {
      drawn.push(match.teamA[0], match.teamA[1], match.teamB[0], match.teamB[1]);
    }
    drawn.push(...round.sitOuts);

    expect(new Set(drawn).size, `${label}: round ${position} draws a player twice`).toBe(
      drawn.length,
    );

    const courts = round.matches.map((match) => match.court);
    expect(new Set(courts).size, `${label}: round ${position} reuses a court number`).toBe(
      courts.length,
    );
  });
};

/**
 * Invariant 2: every active player is either on a court or on the bench in
 * every round — and nobody who is paused, gone, or not yet joined is on the
 * sheet at all. `history.activeAtRound` replays the event log, so this also
 * pins the round-scoped meaning of `beforeRound`.
 */
const checkCoversActiveRoster: Check = (state, label) => {
  state.rounds.forEach((round, position) => {
    const drawn: string[] = [...round.sitOuts];
    for (const match of round.matches) {
      drawn.push(match.teamA[0], match.teamA[1], match.teamB[0], match.teamB[1]);
    }
    const active = history.activeAtRound(state, position);

    expect(
      [...drawn].sort(),
      `${label}: round ${position} does not cover exactly the active roster`,
    ).toStrictEqual([...active].sort());

    // playing = min(courts, floor(active / 4)) * 4, so the court count follows.
    expect(round.matches.length, `${label}: round ${position} has the wrong court count`).toBe(
      history.playingCount(active.length, state.config.courts) / 4,
    );
  });
};

/** Invariant 3: fixed-total scoring, both halves non-negative integers. */
const checkScoresTotalCorrectly: Check = (state, label) => {
  const points = state.config.pointsPerMatch;
  state.rounds.forEach((round, position) => {
    round.matches.forEach((match, court) => {
      const { scoreA, scoreB } = match;
      const where = `${label}: round ${position} court index ${court}`;
      if (scoreA === undefined && scoreB === undefined) return;
      // A half-scored match would let a player bank points from a phantom
      // opponent, so the two sides must appear and vanish together.
      expect(scoreA, `${where} has scoreB but no scoreA`).toBeTypeOf('number');
      expect(scoreB, `${where} has scoreA but no scoreB`).toBeTypeOf('number');
      if (scoreA === undefined || scoreB === undefined) return;
      expect(Number.isInteger(scoreA) && Number.isInteger(scoreB), `${where} is not integral`).toBe(
        true,
      );
      expect(scoreA >= 0 && scoreB >= 0, `${where} is negative`).toBe(true);
      expect(scoreA + scoreB, `${where} does not total pointsPerMatch`).toBe(points);
    });
  });
};

/**
 * Invariant 4: every number on the leaderboard is the scoresheet added up.
 * Also pins the derived rules around it — ppr's zero case, the podium bar, and
 * podium() itself — since they all read from the same tally.
 */
const checkStandingsMatchTheScoresheet: Check = (state, label) => {
  const rows = callPure(state, 'standings', standings);
  const tallies = tallyFromRounds(state);

  const ids = rows.map((row) => row.playerId);
  expect(new Set(ids).size, `${label}: a player appears twice in the standings`).toBe(ids.length);

  // Anyone with a recorded score must be on the board; whether a registered
  // but never-activated player also gets a row is left to the engine.
  for (const playerId of tallies.keys()) {
    expect(ids, `${label}: ${playerId} scored points but has no standings row`).toContain(playerId);
  }

  const maxRoundsPlayed = rows.reduce((max, row) => Math.max(max, row.roundsPlayed), 0);
  const bar = Math.ceil(state.config.podiumMinRoundsPct * maxRoundsPlayed);

  for (const row of rows) {
    const tally = tallies.get(row.playerId) ?? EMPTY_TALLY;
    const who = `${label}: ${row.playerId}`;
    expect(row.roundsPlayed, `${who} roundsPlayed`).toBe(tally.roundsPlayed);
    expect(row.totalPoints, `${who} totalPoints`).toBe(tally.totalPoints);
    expect(row.pointDiff, `${who} pointDiff`).toBe(tally.pointDiff);
    expect(row.wins, `${who} wins`).toBe(tally.wins);
    expect(row.draws, `${who} draws`).toBe(tally.draws);
    expect(row.losses, `${who} losses`).toBe(tally.losses);
    expect(Number.isNaN(row.ppr), `${who} ppr is NaN`).toBe(false);
    expect(row.ppr, `${who} ppr`).toBeCloseTo(
      tally.roundsPlayed === 0 ? 0 : tally.totalPoints / tally.roundsPlayed,
      9,
    );
    expect(row.podiumEligible, `${who} podiumEligible`).toBe(tally.roundsPlayed >= bar);
  }

  const top = callPure(state, 'podium', podium);
  // Before the first score, the bar is ceil(pct x 0) === 0, so everyone clears
  // it and the "top three" would be whoever the organizer typed in first.
  // There is no podium yet, and the engine says so rather than making one up.
  const anyonePlayed = rows.some((row) => row.roundsPlayed > 0);
  expect(
    top,
    `${label}: podium is not the first three eligible rows in standings order`,
  ).toStrictEqual(anyonePlayed ? rows.filter((row) => row.podiumEligible).slice(0, 3) : []);
};

/** Invariant 8: nothing that JSON cannot carry has leaked into state. */
const checkJsonRoundTrip: Check = (state, label) => {
  const roundTripped: unknown = JSON.parse(JSON.stringify(state));
  // toStrictEqual, not toEqual: a key explicitly set to `undefined` (illegal
  // under exactOptionalPropertyTypes), a Map serialised down to `{}`, and an
  // Infinity turned into null all survive toEqual and must not survive this.
  expect(roundTripped, `${label}: state does not survive a JSON round trip`).toStrictEqual(state);
};

// ---------------------------------------------------------------------------
// Scenario generation
// ---------------------------------------------------------------------------

type Command =
  | { t: 'play'; splits: number[]; leavePartial: boolean }
  | { t: 'clear'; pick: number }
  | { t: 'leave'; pick: number }
  | { t: 'pause'; pick: number }
  | { t: 'resume'; pick: number }
  | { t: 'join'; seedPick: number }
  | { t: 'sub'; pick: number; seedPick: number };

interface Scenario {
  format: Format;
  playerCount: number;
  courts: number;
  pointsPerMatch: number;
  rankingMetric: RankingMetric;
  podiumMinRoundsPct: number;
  seed: string;
  script: Command[];
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');

const seedArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...ALPHABET), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(''));

/** One raw number per court, folded into a legal split at scoring time. */
const splitsArb = fc.array(fc.nat({ max: 1_000_000 }), {
  minLength: MAX_COURTS,
  maxLength: MAX_COURTS,
});

const playArb: fc.Arbitrary<Command> = fc
  .record({
    splits: splitsArb,
    // Occasionally stop one court short, so partially scored rounds — which
    // SPEC.md treats as history just as firmly as complete ones — show up.
    leavePartial: fc.nat({ max: 4 }).map((n) => n === 0),
  })
  .map(({ splits, leavePartial }) => ({ t: 'play' as const, splits, leavePartial }));

const clearArb: fc.Arbitrary<Command> = fc
  .nat({ max: 64 })
  .map((pick) => ({ t: 'clear' as const, pick }));

const leaveArb: fc.Arbitrary<Command> = fc
  .nat({ max: 64 })
  .map((pick) => ({ t: 'leave' as const, pick }));

const pauseArb: fc.Arbitrary<Command> = fc
  .nat({ max: 64 })
  .map((pick) => ({ t: 'pause' as const, pick }));

const resumeArb: fc.Arbitrary<Command> = fc
  .nat({ max: 64 })
  .map((pick) => ({ t: 'resume' as const, pick }));

const joinArb: fc.Arbitrary<Command> = fc
  .nat({ max: 8 })
  .map((seedPick) => ({ t: 'join' as const, seedPick }));

const subArb: fc.Arbitrary<Command> = fc
  .record({ pick: fc.nat({ max: 64 }), seedPick: fc.nat({ max: 8 }) })
  .map(({ pick, seedPick }) => ({ t: 'sub' as const, pick, seedPick }));

/**
 * A recipe for an illegal scoresheet entry, resolved once `pointsPerMatch` is
 * known. Drawing two independent numbers would almost never land on the
 * interesting cases — a pair that totals correctly but goes negative, or one
 * that totals correctly but is fractional — so each rejection rule is broken
 * deliberately, one at a time.
 */
type BadScore =
  | { kind: 'total'; base: number; delta: number }
  | { kind: 'negative'; over: number }
  | { kind: 'fraction'; base: number };

const badScoreArb: fc.Arbitrary<BadScore> = fc.oneof(
  fc
    .record({ base: fc.nat({ max: 64 }), delta: fc.constantFrom(-5, -3, -1, 1, 2, 7) })
    .map(({ base, delta }) => ({ kind: 'total' as const, base, delta })),
  fc.integer({ min: 1, max: 5 }).map((over) => ({ kind: 'negative' as const, over })),
  fc.nat({ max: 64 }).map((base) => ({ kind: 'fraction' as const, base })),
);

function badScore(recipe: BadScore, points: number): [number, number] {
  switch (recipe.kind) {
    case 'total': {
      const scoreA = recipe.base % (points + 1);
      return [scoreA, points - scoreA + recipe.delta]; // right shape, wrong total
    }
    case 'negative':
      return [-recipe.over, points + recipe.over]; // totals correctly, but negative
    default: {
      const scoreA = (recipe.base % points) + 0.5;
      return [scoreA, points - scoreA]; // totals correctly, but fractional
    }
  }
}

/** Roster churn only, for the properties that need an event to land. */
const rosterArb: fc.Arbitrary<Command> = fc.oneof(leaveArb, pauseArb, joinArb, subArb);

const commandArb: fc.Arbitrary<Command> = fc.oneof(
  // Weighted towards play so the generated histories are mostly padel and only
  // occasionally paperwork.
  { arbitrary: playArb, weight: 8 },
  { arbitrary: clearArb, weight: 1 },
  { arbitrary: leaveArb, weight: 1 },
  { arbitrary: pauseArb, weight: 1 },
  { arbitrary: resumeArb, weight: 1 },
  { arbitrary: joinArb, weight: 2 },
  { arbitrary: subArb, weight: 2 },
);

function scenarioArb(options: {
  script: fc.Arbitrary<Command[]>;
  format?: fc.Arbitrary<Format>;
}): fc.Arbitrary<Scenario> {
  return fc.record({
    format: options.format ?? fc.constantFrom<Format>('americano', 'mexicano'),
    playerCount: fc.integer({ min: 4, max: 16 }),
    courts: fc.integer({ min: 1, max: MAX_COURTS }),
    pointsPerMatch: fc.constantFrom(16, 24, 32),
    rankingMetric: fc.constantFrom<RankingMetric>('ppr', 'total', 'wins'),
    podiumMinRoundsPct: fc.constantFrom(0, 0.5, 1),
    seed: seedArb,
    script: options.script,
  });
}

const anyScenario = scenarioArb({
  script: fc.array(commandArb, { minLength: 1, maxLength: MAX_SCRIPT }),
});

/** Play-only histories, for the properties that apply their own event next. */
const playedScenario = scenarioArb({ script: fc.array(playArb, { minLength: 1, maxLength: 4 }) });

const playedAmericano = scenarioArb({
  format: fc.constant<Format>('americano'),
  script: fc.array(playArb, { minLength: 1, maxLength: 4 }),
});

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

interface World {
  state: TournamentState;
  /** Monotonic counter, so generated ids never collide. */
  nextId: number;
}

const SEEDS: readonly (Seed | undefined)[] = ['top', 'middle', 'bottom', undefined];

function pickSeed(pick: number): Seed | undefined {
  return SEEDS[pick % SEEDS.length];
}

/** exactOptionalPropertyTypes: build the event with the key, or without it. */
function joinEvent(playerId: string, beforeRound: number, seed: Seed | undefined): RosterEvent {
  return seed === undefined
    ? { type: 'join', playerId, beforeRound }
    : { type: 'join', playerId, beforeRound, seed };
}

function substituteEvent(
  outgoingId: string,
  incomingId: string,
  beforeRound: number,
  seed: Seed | undefined,
): RosterEvent {
  return seed === undefined
    ? { type: 'substitute', outgoingId, incomingId, beforeRound }
    : { type: 'substitute', outgoingId, incomingId, beforeRound, seed };
}

function playOneRound(world: World, command: Extract<Command, { t: 'play' }>, check: Check): World {
  let state = world.state;
  let index = firstUnscoredRoundIndex(state);

  if (index < 0) {
    // Mexicano lays rounds down one at a time; Americano precomputed the lot,
    // so asking for another once the schedule is spent is a legal dead end.
    try {
      state = callPure(state, 'generateNextRound', generateNextRound);
    } catch (error) {
      if (isEngineError(error, 'SCHEDULE_EXHAUSTED')) return world;
      throw error;
    }
    check(state, 'generateNextRound');
    index = firstUnscoredRoundIndex(state);
    if (index < 0) return { ...world, state };
  }

  const roundIndex = index;
  const round = state.rounds[roundIndex];
  if (!round) return { ...world, state };

  const points = state.config.pointsPerMatch;
  const courtCount = round.matches.length;
  for (let i = 0; i < courtCount; i++) {
    const match = round.matches[i];
    if (!match) continue;
    if (match.scoreA !== undefined && match.scoreB !== undefined) continue;
    if (command.leavePartial && courtCount > 1 && i === courtCount - 1) continue;

    const raw = command.splits[i % command.splits.length] ?? 0;
    const scoreA = raw % (points + 1);
    const court = match.court;
    state = callPure(state, 'recordScore', (input) =>
      recordScore(input, roundIndex, court, scoreA, points - scoreA),
    );
    check(state, 'recordScore');
  }
  return { ...world, state };
}

function clearOneScore(
  world: World,
  command: Extract<Command, { t: 'clear' }>,
  check: Check,
): World {
  const state = world.state;
  // Only ever undo the most recent round: correcting a typo on the sheet in
  // front of you is unambiguously legal, rewriting round 1 at the death is not.
  const index = lastScoredRoundIndex(state);
  if (index < 0) return world;
  const round = state.rounds[index];
  if (!round) return world;

  const scored = round.matches.filter(
    (match) => match.scoreA !== undefined || match.scoreB !== undefined,
  );
  const match = scored[command.pick % scored.length];
  if (!match) return world;

  const next = callPure(state, 'clearScore', (input) => clearScore(input, index, match.court));
  check(next, 'clearScore');
  return { ...world, state: next };
}

function changeStatus(
  world: World,
  command: Extract<Command, { t: 'leave' | 'pause' | 'resume' }>,
  check: Check,
): World {
  const state = world.state;
  const beforeRound = nextOpenRound(state);
  if (beforeRound === null) return world;

  const pool =
    command.t === 'resume' ? idsWithStatus(state, 'paused') : idsWithStatus(state, 'active');
  // Falling below four actives is legal (the round simply has no match in it)
  // but it is not what these invariants are about, so the driver keeps a
  // playable draw. See assumptions.
  if (command.t !== 'resume' && pool.length <= MIN_ACTIVE) return world;
  const playerId = pool[command.pick % pool.length];
  if (playerId === undefined) return world;

  const label = `applyRosterEvent(${command.t})`;
  const event: RosterEvent = { type: command.t, playerId, beforeRound };
  const next = callPure(state, label, (input) => applyRosterEvent(input, event));
  check(next, label);
  return { ...world, state: next };
}

function joinLatecomer(world: World, command: Extract<Command, { t: 'join' }>, check: Check): World {
  let state = world.state;
  const beforeRound = nextOpenRound(state);
  if (beforeRound === null) return world;
  if (state.players.length >= MAX_ROSTER) return world;

  // `join` on an unregistered id is UNKNOWN_PLAYER, so the name is registered
  // first and the event activates it.
  const playerId = `late-${world.nextId}`;
  state = callPure(state, 'addPlayer', (input) =>
    addPlayer(input, { id: playerId, name: `Late ${world.nextId}` }),
  );
  check(state, 'addPlayer');

  const event = joinEvent(playerId, beforeRound, pickSeed(command.seedPick));
  state = callPure(state, 'applyRosterEvent(join)', (input) => applyRosterEvent(input, event));
  check(state, 'applyRosterEvent(join)');
  return { state, nextId: world.nextId + 1 };
}

function substitutePlayer(
  world: World,
  command: Extract<Command, { t: 'sub' }>,
  check: Check,
): World {
  let state = world.state;
  const beforeRound = nextOpenRound(state);
  if (beforeRound === null) return world;
  if (state.players.length >= MAX_ROSTER) return world;

  const active = idsWithStatus(state, 'active');
  const outgoingId = active[command.pick % active.length];
  if (outgoingId === undefined) return world;

  const incomingId = `sub-${world.nextId}`;
  state = callPure(state, 'addPlayer', (input) =>
    addPlayer(input, { id: incomingId, name: `Sub ${world.nextId}` }),
  );
  check(state, 'addPlayer');

  const event = substituteEvent(outgoingId, incomingId, beforeRound, pickSeed(command.seedPick));
  state = callPure(state, 'applyRosterEvent(substitute)', (input) =>
    applyRosterEvent(input, event),
  );
  check(state, 'applyRosterEvent(substitute)');
  return { state, nextId: world.nextId + 1 };
}

function step(world: World, command: Command, check: Check): World {
  switch (command.t) {
    case 'play':
      return playOneRound(world, command, check);
    case 'clear':
      return clearOneScore(world, command, check);
    case 'join':
      return joinLatecomer(world, command, check);
    case 'sub':
      return substitutePlayer(world, command, check);
    default:
      return changeStatus(world, command, check);
  }
}

function buildTournament(scenario: Scenario): TournamentState {
  const players: Player[] = Array.from({ length: scenario.playerCount }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
  }));
  const config: TournamentConfigInput = {
    name: 'property tournament',
    format: scenario.format,
    courts: scenario.courts,
    pointsPerMatch: scenario.pointsPerMatch,
    rankingMetric: scenario.rankingMetric,
    podiumMinRoundsPct: scenario.podiumMinRoundsPct,
    seed: scenario.seed,
    // `rounds` is deliberately omitted: Americano must derive it.
  };
  const configSnapshot = deepClone(config);
  const playersSnapshot = deepClone(players);

  const state = createTournament(config, players);

  // Invariant 7 reaches the arguments too, not just the state.
  expect(config, 'createTournament mutated its config argument').toStrictEqual(configSnapshot);
  expect(players, 'createTournament mutated its players argument').toStrictEqual(playersSnapshot);
  return state;
}

function runScenario(scenario: Scenario, check: Check): TournamentState {
  let world: World = { state: buildTournament(scenario), nextId: 0 };
  check(world.state, 'createTournament');
  for (const command of scenario.script) world = step(world, command, check);
  return world.state;
}

function rowFor(rows: readonly Standing[], playerId: string): Standing | undefined {
  return rows.find((row) => row.playerId === playerId);
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('engine invariants', () => {
  it(
    '1. never draws the same player twice in one round',
    () => {
      fc.assert(
        fc.property(anyScenario, (scenario) => {
          runScenario(scenario, checkNoDoubleBooking);
        }),
        { numRuns: RUNS },
      );
    },
    SLOW,
  );

  it(
    '2. gives every active player a court or a bench in every round',
    () => {
      fc.assert(
        fc.property(anyScenario, (scenario) => {
          runScenario(scenario, checkCoversActiveRoster);
        }),
        { numRuns: RUNS },
      );
    },
    SLOW,
  );

  it(
    '3. records only scores that add up to pointsPerMatch',
    () => {
      fc.assert(
        fc.property(anyScenario, (scenario) => {
          runScenario(scenario, checkScoresTotalCorrectly);
        }),
        { numRuns: RUNS },
      );
    },
    SLOW,
  );

  it(
    '3. refuses a score that does not total pointsPerMatch',
    () => {
      // The check above only sees what made it into state, so it cannot tell a
      // strict validator from an absent one. This comes at the same invariant
      // from the other side: an illegal split must be rejected outright.
      fc.assert(
        fc.property(playedScenario, badScoreArb, (scenario, recipe) => {
          let state = runScenario(scenario, noCheck);
          let index = firstUnscoredRoundIndex(state);
          if (index < 0 && state.config.format === 'mexicano') {
            state = generateNextRound(state);
            index = firstUnscoredRoundIndex(state);
          }
          if (index < 0) return;

          const roundIndex = index;
          const match = state.rounds[roundIndex]?.matches.find(
            (candidate) => candidate.scoreA === undefined,
          );
          if (!match) return;

          const points = state.config.pointsPerMatch;
          const [scoreA, scoreB] = badScore(recipe, points);
          // Guard the generator: if a recipe ever produces a legal score the
          // assertion below would be testing the opposite of what it claims.
          expect(
            Number.isInteger(scoreA) &&
              Number.isInteger(scoreB) &&
              scoreA >= 0 &&
              scoreB >= 0 &&
              scoreA + scoreB === points,
            `${recipe.kind} recipe produced the legal score ${scoreA} + ${scoreB}`,
          ).toBe(false);

          let thrown: unknown;
          try {
            // callPure also asserts the rejected call left the state alone.
            callPure(state, 'recordScore', (input) =>
              recordScore(input, roundIndex, match.court, scoreA, scoreB),
            );
          } catch (error) {
            thrown = error;
          }
          expect(
            isEngineError(thrown, 'INVALID_SCORE'),
            `recordScore accepted ${scoreA} + ${scoreB} in a ${points}-point match`,
          ).toBe(true);
        }),
        { numRuns: RUNS },
      );
    },
    SLOW,
  );

  it(
    '4. reports standings that are the scoresheet added up',
    () => {
      fc.assert(
        fc.property(anyScenario, (scenario) => {
          runScenario(scenario, checkStandingsMatchTheScoresheet);
        }),
        { numRuns: RUNS },
      );
    },
    SLOW,
  );

  it(
    '5. never moves historical points when a player is substituted out',
    () => {
      fc.assert(
        fc.property(
          playedScenario,
          fc.nat({ max: 64 }),
          fc.nat({ max: 8 }),
          (scenario, outgoingPick, seedPick) => {
            const state = runScenario(scenario, noCheck);
            const beforeRound = nextOpenRound(state);
            if (beforeRound === null) return;

            const active = state.players.filter((player) => player.status === 'active');
            const outgoing = active[outgoingPick % active.length];
            if (!outgoing) return;

            const before = rowFor(callPure(state, 'standings', standings), outgoing.id);
            expect(before, 'the outgoing player was not on the board to begin with').toBeDefined();

            const incomingId = 'incoming';
            const registered = callPure(state, 'addPlayer', (input) =>
              addPlayer(input, { id: incomingId, name: 'Incoming' }),
            );
            const event = substituteEvent(
              outgoing.id,
              incomingId,
              beforeRound,
              pickSeed(seedPick),
            );
            const next = callPure(registered, 'applyRosterEvent(substitute)', (input) =>
              applyRosterEvent(input, event),
            );

            const rows = callPure(next, 'standings', standings);

            // The whole row, not just the points: no score changed, and the
            // podium bar is relative to a max that did not move either.
            expect(
              rowFor(rows, outgoing.id),
              'substitution rewrote the outgoing player’s record',
            ).toStrictEqual(before);

            const incoming = rowFor(rows, incomingId);
            expect(incoming, 'the substitute is not on the board').toBeDefined();
            if (incoming) {
              expect(incoming.roundsPlayed, 'the substitute inherited rounds').toBe(0);
              expect(incoming.totalPoints, 'the substitute inherited points').toBe(0);
              expect(incoming.ppr).toBe(0);
              expect(incoming.pointDiff).toBe(0);
              expect(incoming.wins + incoming.draws + incoming.losses).toBe(0);
            }

            // Both stay on the board, linked in both directions.
            const outgoingRecord = next.players.find((player) => player.id === outgoing.id);
            expect(outgoingRecord?.status).toBe('left');
            expect(outgoingRecord?.replacedBy).toBe(incomingId);
            const incomingRecord = next.players.find((player) => player.id === incomingId);
            expect(incomingRecord?.status).toBe('active');
            expect(incomingRecord?.replaces).toBe(outgoing.id);
            expect(incomingRecord?.joinedBeforeRound).toBe(beforeRound);
          },
        ),
        { numRuns: RUNS },
      );
    },
    SLOW,
  );

  it(
    '6. never rewrites a scored round when Americano reschedules',
    () => {
      fc.assert(
        fc.property(playedAmericano, rosterArb, (scenario, rosterCommand) => {
          const before = runScenario(scenario, noCheck);
          const scoredRounds = before.rounds.filter(history.hasAnyScore).map(deepClone);
          if (scoredRounds.length === 0) return;

          const after = step({ state: before, nextId: 0 }, rosterCommand, noCheck).state;
          if (after.events.length === before.events.length) return; // event did not apply

          for (const round of scoredRounds) {
            expect(
              after.rounds[round.index],
              `rescheduling rewrote scored round ${round.index}`,
            ).toStrictEqual(round);
          }

          // A roster event reshuffles the tail of an Americano draw; it does
          // not lengthen or truncate the schedule the organizer agreed to.
          expect(after.rounds.length, 'the Americano schedule changed length').toBe(
            before.rounds.length,
          );
        }),
        { numRuns: RUNS },
      );
    },
    SLOW,
  );

  it(
    '7. leaves every input state untouched',
    () => {
      // callPure snapshots and compares around every single public call the
      // driver makes, so simply running a scenario is the assertion.
      fc.assert(
        fc.property(anyScenario, (scenario) => {
          runScenario(scenario, noCheck);
        }),
        { numRuns: RUNS },
      );
    },
    SLOW,
  );

  it(
    '8. keeps state that survives a JSON round trip',
    () => {
      fc.assert(
        fc.property(anyScenario, (scenario) => {
          runScenario(scenario, checkJsonRoundTrip);
        }),
        { numRuns: RUNS },
      );
    },
    SLOW,
  );

  it(
    'advances the revision counter on every mutation',
    () => {
      // The driver only ever checks after a call that really changed
      // something, so "bumped on every mutation" means strictly increasing
      // here — a share server ordering snapshots by revision needs that.
      fc.assert(
        fc.property(anyScenario, (scenario) => {
          let seen: number | null = null;
          runScenario(scenario, (state, label) => {
            if (seen !== null) {
              expect(state.revision, `${label}: revision did not advance`).toBeGreaterThan(seen);
            }
            seen = state.revision;
          });
        }),
        { numRuns: RUNS },
      );
    },
    SLOW,
  );
});
