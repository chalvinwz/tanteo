/**
 * tanteo engine — domain types.
 *
 * The whole package is pure: no DOM, no network, no clock, no Math.random.
 * Every state value here is plain JSON, so a tournament can be written to
 * IndexedDB or POSTed to the share server without a serializer.
 */

export type Format = 'americano' | 'mexicano';
export type RankingMetric = 'ppr' | 'total' | 'wins';
export type Seed = 'top' | 'middle' | 'bottom';

export interface TournamentConfig {
  name: string;
  format: Format;
  courts: number;
  /** Fixed-total scoring: scoreA + scoreB === pointsPerMatch. */
  pointsPerMatch: number;
  rankingMetric: RankingMetric;
  /** A player needs ceil(pct x maxRoundsPlayed) rounds to reach the podium. */
  podiumMinRoundsPct: number;
  /**
   * Americano: how many rounds the schedule spans. Omitted means "as many as
   * it takes for everyone to partner everyone once", derived at creation.
   * Mexicano ignores this — rounds are generated until the organizer stops.
   */
  rounds?: number;
  /**
   * Seeds the engine's PRNG. Mexicano round 1 has no standings to pair on and
   * Americano breaks ties randomly; both draw from here, so a tournament
   * replays identically from its events. Callers supply it — the engine never
   * reaches for a clock or Math.random.
   */
  seed: string;
}

/** Config as an organizer supplies it; the engine fills in the rest. */
export type TournamentConfigInput = Pick<TournamentConfig, 'name' | 'format' | 'courts'> &
  Partial<Omit<TournamentConfig, 'name' | 'format' | 'courts'>>;

export interface Player {
  id: string;
  name: string;
}

export type PlayerStatus = 'active' | 'paused' | 'left';

/** A player plus everything the engine tracks about their time in the draw. */
export interface PlayerRecord extends Player {
  status: PlayerStatus;
  /** Round index they entered before. 0 for the starting roster. */
  joinedBeforeRound: number;
  /**
   * Pairing hint for a late joiner with no results yet. Never shown on the
   * leaderboard, and dropped the moment they have one played round.
   */
  seed?: Seed;
  /** Set on the outgoing player of a substitution. */
  replacedBy?: string;
  /** Set on the incoming player of a substitution. */
  replaces?: string;
}

export type RosterEvent =
  | { type: 'join'; playerId: string; beforeRound: number; seed?: Seed }
  | { type: 'leave'; playerId: string; beforeRound: number }
  | { type: 'pause'; playerId: string; beforeRound: number }
  | { type: 'resume'; playerId: string; beforeRound: number }
  | {
      type: 'substitute';
      outgoingId: string;
      incomingId: string;
      beforeRound: number;
      seed?: Seed;
    };

export interface Match {
  court: number;
  teamA: [string, string];
  teamB: [string, string];
  scoreA?: number;
  scoreB?: number;
}

export interface Round {
  index: number;
  matches: Match[];
  sitOuts: string[];
}

export interface Standing {
  playerId: string;
  roundsPlayed: number;
  totalPoints: number;
  ppr: number;
  wins: number;
  draws: number;
  losses: number;
  pointDiff: number;
  podiumEligible: boolean;
}

/** Serializable PRNG cursor. Advancing it returns a new cursor, never mutates. */
export interface RngState {
  seed: string;
  cursor: number;
}

export interface TournamentState {
  config: TournamentConfig;
  /** Everyone who has ever been in the draw, in the order they entered. */
  players: PlayerRecord[];
  /**
   * Every round the engine has laid out. Americano fills this at creation;
   * Mexicano appends one at a time. A round with recorded scores is history.
   */
  rounds: Round[];
  /** Append-only log of roster changes, for replay and for the UI's timeline. */
  events: RosterEvent[];
  rng: RngState;
  /** Bumped on every mutation, so the share server can order snapshots. */
  revision: number;
}

export type ErrorCode =
  | 'DUPLICATE_PLAYER'
  | 'UNKNOWN_PLAYER'
  | 'INVALID_CONFIG'
  | 'INVALID_SCORE'
  | 'ROUND_NOT_FOUND'
  | 'MATCH_NOT_FOUND'
  | 'HISTORY_IMMUTABLE'
  | 'PLAYER_NOT_ACTIVE'
  | 'PLAYER_ALREADY_ACTIVE'
  | 'NOT_ENOUGH_PLAYERS'
  | 'SCHEDULE_EXHAUSTED';

export class EngineError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}
