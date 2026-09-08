import {
  activeAtRound,
  playingCount,
  roundsPlayed,
  seedAtRound,
  sitOutHistory,
} from './history.js';
import { shuffle } from './rng.js';
import { standings } from './standings.js';
import type { Match, RngState, Round, Seed, TournamentState } from './types.js';

/**
 * Mexicano pairing: one round at a time, drawn from the current standings.
 *
 * Nothing is precomputed. Each call reads the board as it stands, seats the
 * players who owe a sit-out, ranks the rest, and cuts the ranking into courts.
 * That is the whole format: court 1 is the top four, and inside every court the
 * best plays with the worst so the match is as close as those four allow.
 */

/** Court size is fixed at 2v2; every count below derives from it. */
const COURT_SIZE = 4;

export function generateMexicanoRound(
  state: TournamentState,
  roundIndex: number,
): { round: Round; rng: RngState } {
  const active = activeAtRound(state, roundIndex);

  // Three players cannot fill a court. The round still exists so the timeline
  // stays contiguous and the UI can show "waiting for a fourth".
  if (active.length < COURT_SIZE) {
    return {
      round: { index: roundIndex, matches: [], sitOuts: [...active] },
      rng: state.rng,
    };
  }

  const playing = playingCount(active.length, state.config.courts);
  const sittingOut = chooseSitOuts(state, active, active.length - playing, roundIndex);
  const inPlay = active.filter((id) => !sittingOut.has(id));

  const { ranked, rng } = rankForPairing(state, inPlay, roundIndex);

  const matches: Match[] = [];
  for (let start = 0; start + COURT_SIZE <= ranked.length; start += COURT_SIZE) {
    const first = ranked[start];
    const second = ranked[start + 1];
    const third = ranked[start + 2];
    const fourth = ranked[start + 3];
    // The loop bound guarantees all four exist; the guard only satisfies
    // noUncheckedIndexedAccess.
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      fourth === undefined
    ) {
      continue;
    }
    matches.push({
      court: start / COURT_SIZE + 1,
      teamA: [first, fourth],
      teamB: [second, third],
    });
  }

  return {
    // Sit-outs are reported in roster order rather than in the order the
    // fairness sort picked them: the selection ranking is an implementation
    // detail, roster order is what the UI lists.
    round: { index: roundIndex, matches, sitOuts: active.filter((id) => sittingOut.has(id)) },
    rng,
  };
}

/**
 * The shared sit-out fairness rule: fewest sit-outs so far, then whoever sat
 * out longest ago, then roster order as the final deterministic tiebreak.
 *
 * History is read strictly below `roundIndex` so regenerating round 6 sees
 * rounds 0-5 and nothing that a later regeneration may have written past it.
 */
function chooseSitOuts(
  state: TournamentState,
  active: readonly string[],
  needed: number,
  roundIndex: number,
): Set<string> {
  if (needed <= 0) return new Set<string>();

  const { count, last } = sitOutHistory(state, roundIndex);
  const roster = rosterOrder(state);

  const queue = [...active].sort((a, b) => {
    const byCount = (count.get(a) ?? 0) - (count.get(b) ?? 0);
    if (byCount !== 0) return byCount;
    // `last` is -1 for a player who has never sat out, which sorts first
    // exactly as intended: never is the longest possible time ago.
    const byLast = (last.get(a) ?? -1) - (last.get(b) ?? -1);
    if (byLast !== 0) return byLast;
    return (roster.get(a) ?? 0) - (roster.get(b) ?? 0);
  });

  return new Set(queue.slice(0, needed));
}

/**
 * Order the players who take the court, strongest first.
 *
 * Returns the RNG cursor because the opening draw consumes it; every other
 * path is a pure sort and hands `state.rng` straight back.
 */
function rankForPairing(
  state: TournamentState,
  inPlay: readonly string[],
  roundIndex: number,
): { ranked: string[]; rng: RngState } {
  const playedRounds = (id: string): number => roundsPlayed(state, id, roundIndex);

  // Round 0 — and any later round where the whole field is still unscored,
  // which happens when the organizer generates ahead before playing — carries
  // no signal to rank on. Falling back to roster order there would hand the
  // top court to whoever was typed in first, so shuffle instead.
  const hasResults = roundIndex > 0 && state.players.some((p) => playedRounds(p.id) > 0);
  if (!hasResults) {
    const [shuffled, rng] = shuffle(inPlay, state.rng);
    return { ranked: shuffled, rng };
  }

  const board = standings(state);
  const stillIn = new Set(inPlay);
  const placed = new Set<string>();
  const ordered: string[] = [];
  for (const standing of board) {
    if (stillIn.has(standing.playerId) && !placed.has(standing.playerId)) {
      placed.add(standing.playerId);
      ordered.push(standing.playerId);
    }
  }
  // Defensive: a player the board somehow omits still has to be drawn, or the
  // round would silently lose them and break the "everyone plays or sits out"
  // invariant.
  for (const id of inPlay) {
    if (!placed.has(id)) ordered.push(id);
  }

  // Anyone with no result yet is an unknown quantity: their standings row is
  // all zeros, which would dump them at the bottom of the ranking and hand
  // them the weakest court regardless of how they actually play. Pull them out
  // and re-place them by their pairing seed instead.
  const withResults: string[] = [];
  const seeded: Record<Seed, string[]> = { top: [], middle: [], bottom: [] };
  for (const id of ordered) {
    if (playedRounds(id) > 0) {
      withResults.push(id);
      continue;
    }
    // No seed and no history means nobody has an opinion about them, so the
    // middle of the pack is the least wrong guess.
    seeded[seedAtRound(state, id, roundIndex) ?? 'middle'].push(id);
  }

  const roster = rosterOrder(state);
  const byRoster = (a: string, b: string): number =>
    (roster.get(a) ?? 0) - (roster.get(b) ?? 0);
  for (const group of [seeded.top, seeded.middle, seeded.bottom]) {
    group.sort(byRoster);
  }

  const ranked = [...withResults];
  // 'middle' means "about average against the players who have results", so
  // the midpoint is taken over that ranked core only. Measuring it after the
  // 'top' and 'bottom' joiners were spliced in would let the number of other
  // newcomers shove the midpoint around, which the seed says nothing about.
  ranked.splice(Math.floor(ranked.length / 2), 0, ...seeded.middle);

  return { ranked: [...seeded.top, ...ranked, ...seeded.bottom], rng: state.rng };
}

/** Roster position by player id — the engine's universal last-resort tiebreak. */
function rosterOrder(state: TournamentState): Map<string, number> {
  const order = new Map<string, number>();
  state.players.forEach((player, index) => order.set(player.id, index));
  return order;
}
