import type { PlayerStatus, Round, Seed, TournamentState } from './types.js';

/**
 * Read-only views over what has already happened.
 *
 * Two callers need these: the pairing engines, which weigh who has partnered
 * whom, and the standings, which count what was actually scored. Nothing here
 * mutates; everything takes an explicit round bound so a regenerated round 6
 * sees exactly what rounds 0-5 contain and nothing beyond.
 */

export type PairKey = string;

/** Order-independent key for a pair of players. */
export function pairKey(a: string, b: string): PairKey {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function roundStatus(round: Round): 'scheduled' | 'partial' | 'complete' {
  if (round.matches.length === 0) return 'complete';
  const scored = round.matches.filter((m) => m.scoreA !== undefined && m.scoreB !== undefined);
  if (scored.length === 0) return 'scheduled';
  return scored.length === round.matches.length ? 'complete' : 'partial';
}

export function hasAnyScore(round: Round): boolean {
  return round.matches.some((m) => m.scoreA !== undefined || m.scoreB !== undefined);
}

/** Highest round index carrying at least one score, or -1 if nothing is played. */
export function lastScoredRoundIndex(state: TournamentState): number {
  for (let i = state.rounds.length - 1; i >= 0; i--) {
    const round = state.rounds[i];
    if (round && hasAnyScore(round)) return i;
  }
  return -1;
}

/** First round not yet complete: the one the organizer is standing in front of. */
export function currentRoundIndex(state: TournamentState): number {
  for (let i = 0; i < state.rounds.length; i++) {
    const round = state.rounds[i];
    if (round && roundStatus(round) !== 'complete') return i;
  }
  return state.rounds.length;
}

/**
 * Replay the event log to find a player's status as of a given round.
 * 'absent' means they had not joined yet, or had already left.
 */
export function statusAtRound(
  state: TournamentState,
  playerId: string,
  roundIndex: number,
): PlayerStatus | 'absent' {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return 'absent';
  if (player.joinedBeforeRound > roundIndex) return 'absent';

  let status: PlayerStatus = 'active';
  for (const event of state.events) {
    if (event.beforeRound > roundIndex) continue;
    if (event.type === 'substitute') {
      if (event.outgoingId === playerId) status = 'left';
      if (event.incomingId === playerId) status = 'active';
      continue;
    }
    if (event.playerId !== playerId) continue;
    if (event.type === 'join' || event.type === 'resume') status = 'active';
    else if (event.type === 'leave') status = 'left';
    else if (event.type === 'pause') status = 'paused';
  }
  return status === 'left' ? 'absent' : status;
}

/** Everyone eligible to be drawn into a given round, in roster order. */
export function activeAtRound(state: TournamentState, roundIndex: number): string[] {
  return state.players
    .filter((p) => statusAtRound(state, p.id, roundIndex) === 'active')
    .map((p) => p.id);
}

/** Rounds this player has a recorded score in, below the given bound. */
export function roundsPlayed(
  state: TournamentState,
  playerId: string,
  uptoRoundExclusive = state.rounds.length,
): number {
  let count = 0;
  for (const round of state.rounds) {
    if (round.index >= uptoRoundExclusive) continue;
    for (const match of round.matches) {
      if (match.scoreA === undefined || match.scoreB === undefined) continue;
      if (match.teamA.includes(playerId) || match.teamB.includes(playerId)) count++;
    }
  }
  return count;
}

/**
 * A late joiner's pairing seed, or undefined once they have a played round.
 * The seed is a hint for where to slot an unknown quantity into the standings
 * sort. It is never a result, and it expires the moment there is a real one.
 */
export function seedAtRound(
  state: TournamentState,
  playerId: string,
  roundIndex: number,
): Seed | undefined {
  const player = state.players.find((p) => p.id === playerId);
  if (!player?.seed) return undefined;
  return roundsPlayed(state, playerId, roundIndex) === 0 ? player.seed : undefined;
}

/** How often each pair has been on the same side of the net. */
export function partnerCounts(
  state: TournamentState,
  uptoRoundExclusive = state.rounds.length,
): Map<PairKey, number> {
  const counts = new Map<PairKey, number>();
  for (const round of state.rounds) {
    if (round.index >= uptoRoundExclusive) continue;
    for (const match of round.matches) {
      for (const team of [match.teamA, match.teamB]) {
        const key = pairKey(team[0], team[1]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** How often each pair has faced each other across the net. */
export function opponentCounts(
  state: TournamentState,
  uptoRoundExclusive = state.rounds.length,
): Map<PairKey, number> {
  const counts = new Map<PairKey, number>();
  for (const round of state.rounds) {
    if (round.index >= uptoRoundExclusive) continue;
    for (const match of round.matches) {
      for (const a of match.teamA) {
        for (const b of match.teamB) {
          const key = pairKey(a, b);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
  }
  return counts;
}

export interface SitOutHistory {
  /** Times each player has sat out. */
  count: Map<string, number>;
  /** Most recent round each player sat out, or -1 for never. */
  last: Map<string, number>;
}

export function sitOutHistory(
  state: TournamentState,
  uptoRoundExclusive = state.rounds.length,
): SitOutHistory {
  const count = new Map<string, number>();
  const last = new Map<string, number>();
  for (const player of state.players) {
    count.set(player.id, 0);
    last.set(player.id, -1);
  }
  for (const round of state.rounds) {
    if (round.index >= uptoRoundExclusive) continue;
    for (const id of round.sitOuts) {
      count.set(id, (count.get(id) ?? 0) + 1);
      last.set(id, round.index);
    }
  }
  return { count, last };
}

/** How many players actually take the court, given the roster and the courts. */
export function playingCount(activeCount: number, courts: number): number {
  return Math.min(courts, Math.floor(activeCount / 4)) * 4;
}
