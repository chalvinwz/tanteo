/**
 * tanteo engine — tournament lifecycle.
 *
 * Creation, scoring, and pulling the next round. This module is the
 * orchestrator: pairing lives in americano.ts / mexicano.ts, ranking in
 * standings.ts, roster mutation in roster.ts. Everything here is
 * `(state, input) => newState` over plain JSON.
 */

import { defaultAmericanoRounds, generateAmericanoRounds } from './americano.js';
import { currentRoundIndex } from './history.js';
import { generateMexicanoRound } from './mexicano.js';
import { createRng } from './rng.js';
import { EngineError } from './types.js';
import type {
  Match,
  Player,
  PlayerRecord,
  RankingMetric,
  Round,
  TournamentConfig,
  TournamentConfigInput,
  TournamentState,
} from './types.js';

const DEFAULT_POINTS_PER_MATCH = 24;
const DEFAULT_RANKING_METRIC: RankingMetric = 'ppr';
const DEFAULT_PODIUM_MIN_ROUNDS_PCT = 0.5;
const DEFAULT_SEED = 'tanteo';
const MIN_PLAYERS = 4;

/**
 * Build a tournament from an organizer's config and a starting roster.
 *
 * Americano materialises its whole schedule here, because the whist rotation is
 * a global optimisation over all rounds at once — you cannot deal round 5
 * fairly without knowing rounds 0-4 were dealt from the same plan. Mexicano
 * starts empty: every round is a function of standings that do not exist yet.
 */
export function createTournament(
  config: TournamentConfigInput,
  players: Player[],
): TournamentState {
  const pointsPerMatch = config.pointsPerMatch ?? DEFAULT_POINTS_PER_MATCH;
  const podiumMinRoundsPct = config.podiumMinRoundsPct ?? DEFAULT_PODIUM_MIN_ROUNDS_PCT;
  const rankingMetric = config.rankingMetric ?? DEFAULT_RANKING_METRIC;
  const seed = config.seed ?? DEFAULT_SEED;

  if (!Number.isInteger(config.courts) || config.courts < 1) {
    throw new EngineError('INVALID_CONFIG', `courts must be an integer >= 1, got ${config.courts}`);
  }
  if (!Number.isInteger(pointsPerMatch) || pointsPerMatch < 1) {
    throw new EngineError(
      'INVALID_CONFIG',
      `pointsPerMatch must be an integer >= 1, got ${pointsPerMatch}`,
    );
  }
  // Written as a positive range test so NaN falls through to the throw.
  if (!(podiumMinRoundsPct >= 0 && podiumMinRoundsPct <= 1)) {
    throw new EngineError(
      'INVALID_CONFIG',
      `podiumMinRoundsPct must be within [0, 1], got ${podiumMinRoundsPct}`,
    );
  }
  if (config.rounds !== undefined && (!Number.isInteger(config.rounds) || config.rounds < 0)) {
    throw new EngineError(
      'INVALID_CONFIG',
      `rounds must be a non-negative integer, got ${config.rounds}`,
    );
  }

  if (players.length < MIN_PLAYERS) {
    throw new EngineError(
      'NOT_ENOUGH_PLAYERS',
      `a tournament needs at least ${MIN_PLAYERS} players, got ${players.length}`,
    );
  }
  const seenIds = new Set<string>();
  for (const player of players) {
    if (seenIds.has(player.id)) {
      throw new EngineError('DUPLICATE_PLAYER', `player id "${player.id}" appears twice`);
    }
    seenIds.add(player.id);
  }

  const rounds =
    config.rounds ??
    (config.format === 'americano'
      ? defaultAmericanoRounds(players.length, config.courts)
      : undefined);

  const baseConfig: TournamentConfig = {
    name: config.name,
    format: config.format,
    courts: config.courts,
    pointsPerMatch,
    rankingMetric,
    podiumMinRoundsPct,
    seed,
  };
  // exactOptionalPropertyTypes: `rounds` must be absent, not `undefined`.
  const resolved: TournamentConfig = rounds === undefined ? baseConfig : { ...baseConfig, rounds };

  const records: PlayerRecord[] = players.map((player) => ({
    id: player.id,
    name: player.name,
    status: 'active',
    joinedBeforeRound: 0,
  }));

  const state: TournamentState = {
    config: resolved,
    players: records,
    rounds: [],
    events: [],
    rng: createRng(seed),
    revision: 0,
  };

  if (resolved.format !== 'americano') return state;

  const schedule = generateAmericanoRounds(state, 0, resolved.rounds ?? 0);
  return { ...state, rounds: schedule.rounds, rng: schedule.rng };
}

/** Locate a round + court, throwing the caller-facing not-found codes. */
function locate(
  state: TournamentState,
  roundIndex: number,
  court: number,
): { round: Round; match: Match } {
  const round = state.rounds[roundIndex];
  if (!round) {
    throw new EngineError('ROUND_NOT_FOUND', `no round at index ${roundIndex}`);
  }
  const match = round.matches.find((m) => m.court === court);
  if (!match) {
    throw new EngineError('MATCH_NOT_FOUND', `round ${roundIndex} has no court ${court}`);
  }
  return { round, match };
}

/** Rebuild the rounds array with one match replaced. Nothing else is touched. */
function withMatch(
  state: TournamentState,
  roundIndex: number,
  court: number,
  replacement: Match,
): Round[] {
  return state.rounds.map((round, i) => {
    if (i !== roundIndex) return round;
    return {
      ...round,
      matches: round.matches.map((match) => (match.court === court ? replacement : match)),
    };
  });
}

/**
 * Record a fixed-total result. Both scores must be non-negative integers
 * summing to `pointsPerMatch` — padel Americano is played to a fixed total, so
 * a pair of scores that does not add up is a typo, not a valid game.
 */
export function recordScore(
  state: TournamentState,
  roundIndex: number,
  court: number,
  scoreA: number,
  scoreB: number,
): TournamentState {
  const { match } = locate(state, roundIndex, court);
  const total = state.config.pointsPerMatch;

  if (
    !Number.isInteger(scoreA) ||
    !Number.isInteger(scoreB) ||
    scoreA < 0 ||
    scoreB < 0 ||
    scoreA + scoreB !== total
  ) {
    throw new EngineError(
      'INVALID_SCORE',
      `scores must be non-negative integers summing to ${total}, got ${scoreA} + ${scoreB}`,
    );
  }

  const scored: Match = { ...match, scoreA, scoreB };
  return {
    ...state,
    rounds: withMatch(state, roundIndex, court, scored),
    revision: state.revision + 1,
  };
}

/** Undo a recorded result: the match goes back to scheduled-but-unplayed. */
export function clearScore(
  state: TournamentState,
  roundIndex: number,
  court: number,
): TournamentState {
  const { match } = locate(state, roundIndex, court);

  // Rebuilt field by field rather than spread-and-delete: under
  // exactOptionalPropertyTypes the score keys must be absent, not undefined.
  const cleared: Match = { court: match.court, teamA: match.teamA, teamB: match.teamB };
  return {
    ...state,
    rounds: withMatch(state, roundIndex, court, cleared),
    revision: state.revision + 1,
  };
}

/**
 * Hand the organizer the next round to play.
 *
 * Mexicano computes one on the spot from the current standings. Americano has
 * nothing to compute — its schedule was dealt at creation and re-dealt by any
 * roster event — so this is a no-op that returns the *same* object, letting
 * callers use identity to detect "nothing changed".
 */
export function generateNextRound(state: TournamentState): TournamentState {
  if (state.config.format === 'mexicano') {
    const { round, rng } = generateMexicanoRound(state, state.rounds.length);
    return {
      ...state,
      rounds: [...state.rounds, round],
      rng,
      revision: state.revision + 1,
    };
  }

  // First round not yet complete. Below rounds.length it is already dealt.
  if (currentRoundIndex(state) < state.rounds.length) return state;

  throw new EngineError(
    'SCHEDULE_EXHAUSTED',
    `the americano schedule of ${state.rounds.length} round(s) is complete`,
  );
}
