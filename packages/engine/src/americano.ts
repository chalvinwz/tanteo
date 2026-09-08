import type { Match, RngState, Round, TournamentState } from './types.js';
import { nextInt } from './rng.js';
import type { PairKey } from './history.js';
import {
  activeAtRound,
  opponentCounts,
  pairKey,
  partnerCounts,
  playingCount,
  sitOutHistory,
} from './history.js';

/**
 * Americano scheduling.
 *
 * The ideal is a whist rotation: over the whole tournament everyone partners
 * everyone exactly once. A perfect rotation only exists for particular
 * (players, courts, rounds) combinations, and tanteo's roster is mutable
 * mid-tournament, so an exact solver would be both overkill and frequently
 * infeasible. Instead each round is built greedily from the cheapest available
 * partnership and then hill-climbed with a bounded number of swap passes. That
 * reaches a repeat-free schedule for the common shapes (8 players / 2 courts /
 * 7 rounds) and degrades gracefully everywhere else.
 *
 * Every tie is broken through the state's PRNG cursor, so the same state and
 * the same seed always produce the same schedule.
 */

/** A pair of players on the same side of the net. */
type Team = [string, string];

/** The two slots inside a team, as literals so tuple indexing stays typed. */
const SLOTS = [0, 1] as const;

/**
 * Partnership repeats must always outrank opponent imbalance. What has to stay
 * dominant is the *difference* between two candidate rounds: the smallest
 * meaningful partner difference is 1 (e.g. team costs {9,1,1,1} against
 * {4,4,4,1}), worth 1000 here, and the opponent term keeps its own counts so
 * tightly balanced that the spread between candidates stays two orders of
 * magnitude below that. A field left running long enough for opponent counts to
 * diverge sharply could in principle tip one comparison; nothing that short of
 * pathological has been observed.
 */
const W_PARTNER = 1000;
const W_OPPONENT = 1;

/**
 * Ceiling on swap evaluations per round. Local search here is a polish pass on
 * an already-decent greedy round, not the search itself, so a hard budget keeps
 * generation O(1)-ish per round no matter how large the field gets.
 */
const MAX_SWAP_ATTEMPTS = 200;

/**
 * How many rounds a full Americano schedule spans.
 *
 * `ceil(C(n,2) / pairsPerRound)`: every round consumes two partnerships per
 * court in play, and a court only comes into play once there are four bodies
 * for it. For 8 players on 2 courts this is 7 — exactly the whist rotation.
 */
export function defaultAmericanoRounds(playerCount: number, courts: number): number {
  const players = Math.max(0, Math.floor(playerCount));
  const courtCount = Math.max(0, Math.floor(courts));
  // The floor of 1 keeps the division defined for rosters too small to fill a
  // single court, where no partnership is consumed at all.
  const pairsPerRound = Math.max(1, 2 * Math.min(courtCount, Math.floor(players / 4)));
  const distinctPairs = (players * (players - 1)) / 2;
  // Math.max also normalises the -0 that an empty roster would otherwise
  // produce, so the result is always a plain non-negative integer.
  return Math.max(0, Math.ceil(distinctPairs / pairsPerRound));
}

/**
 * Lay out rounds `fromRoundIndex .. totalRounds-1`. The caller splices the
 * result onto `state.rounds.slice(0, fromRoundIndex)`.
 *
 * Pairing history is read strictly *below* `fromRoundIndex` — the rounds at or
 * above it are the ones being replaced, so their contents must not steer the
 * rebuild — and is then advanced by each round this function emits. That is
 * what makes a mid-tournament regeneration respect what was actually played
 * while still avoiding repeats among the rounds it is laying out now.
 */
export function generateAmericanoRounds(
  state: TournamentState,
  fromRoundIndex: number,
  totalRounds: number,
): { rounds: Round[]; rng: RngState } {
  const from = Math.max(0, Math.floor(fromRoundIndex));
  // A non-finite bound would spin forever; treat it as "nothing to generate".
  const upto = Number.isFinite(totalRounds) ? Math.floor(totalRounds) : from;

  // These helpers each hand back a fresh Map, so advancing them in place as we
  // go touches nothing the caller owns. They stay local variables — state must
  // remain plain JSON.
  const partners = partnerCounts(state, from);
  const opponents = opponentCounts(state, from);
  const sitOuts = sitOutHistory(state, from);
  const sitOutCount = sitOuts.count;
  const sitOutLast = sitOuts.last;

  // Roster order is the final deterministic tiebreak in several places, and
  // also fixes the order of the two names inside a team.
  const rosterOrder = new Map(state.players.map((player, index) => [player.id, index] as const));

  const rounds: Round[] = [];
  let rng = state.rng;

  for (let index = from; index < upto; index++) {
    const active = activeAtRound(state, index);
    const playing = playingCount(active.length, state.config.courts);

    // Sit-out fairness: fewest sit-outs so far, then longest since the last one
    // (-1 means never, and sorting ascending puts it first, which is exactly
    // "never-sat-out counts as longest ago"), then roster order.
    const fairest = active
      .map((id, order) => ({ id, order }))
      .sort((a, b) => {
        const byCount = (sitOutCount.get(a.id) ?? 0) - (sitOutCount.get(b.id) ?? 0);
        if (byCount !== 0) return byCount;
        const byRecency = (sitOutLast.get(a.id) ?? -1) - (sitOutLast.get(b.id) ?? -1);
        if (byRecency !== 0) return byRecency;
        return a.order - b.order;
      });

    // With fewer than four active players `playing` is 0, so this selects the
    // whole roster and the round below comes out empty with everyone sitting —
    // no special case needed.
    const sitting = new Set(fairest.slice(0, active.length - playing).map((entry) => entry.id));
    const onCourt = active.filter((id) => !sitting.has(id));
    const sittingOut = active.filter((id) => sitting.has(id));

    const [teams, afterTeams] = greedyTeams(onCourt, partners, rng);
    const [ordered, afterMatchUp] = greedyMatchUp(teams, opponents, afterTeams);
    rng = afterMatchUp;
    const polished = localSearch(ordered, partners, opponents);

    const matches: Match[] = [];
    for (let slot = 0; slot + 1 < polished.length; slot += 2) {
      const teamA = polished[slot];
      const teamB = polished[slot + 1];
      if (!teamA || !teamB) continue;
      matches.push({
        court: matches.length + 1,
        teamA: inRosterOrder(teamA, rosterOrder),
        teamB: inRosterOrder(teamB, rosterOrder),
      });
    }

    rounds.push({ index, matches, sitOuts: sittingOut });

    // Fold this round into the running history before laying out the next one.
    for (const match of matches) {
      bump(partners, pairKey(match.teamA[0], match.teamA[1]));
      bump(partners, pairKey(match.teamB[0], match.teamB[1]));
      for (const a of match.teamA) {
        for (const b of match.teamB) {
          bump(opponents, pairKey(a, b));
        }
      }
    }
    for (const id of sittingOut) {
      sitOutCount.set(id, (sitOutCount.get(id) ?? 0) + 1);
      sitOutLast.set(id, index);
    }
  }

  return { rounds, rng };
}

function bump(counts: Map<PairKey, number>, key: PairKey): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function inRosterOrder(team: Team, rosterOrder: ReadonlyMap<string, number>): Team {
  const [a, b] = team;
  return (rosterOrder.get(a) ?? 0) <= (rosterOrder.get(b) ?? 0) ? [a, b] : [b, a];
}

/**
 * Squared so a second repeat hurts disproportionately more than a first: given
 * the choice the schedule spreads two repeats across two pairs rather than
 * stacking both on one unlucky pair.
 */
function partnerCost(a: string, b: string, partners: ReadonlyMap<PairKey, number>): number {
  const seen = partners.get(pairKey(a, b)) ?? 0;
  return (seen + 1) * (seen + 1);
}

function opponentCost(a: string, b: string, opponents: ReadonlyMap<PairKey, number>): number {
  const seen = opponents.get(pairKey(a, b)) ?? 0;
  return (seen + 1) * (seen + 1);
}

/** Cost of putting these two teams across the net from each other. */
function crossCost(a: Team, b: Team, opponents: ReadonlyMap<PairKey, number>): number {
  let total = 0;
  for (const x of a) {
    for (const y of b) total += opponentCost(x, y, opponents);
  }
  return total;
}

/**
 * Cost of a whole candidate round, where `teams[2k]` faces `teams[2k+1]`.
 * Recomputed from scratch on every swap: the round is at most a handful of
 * teams, so an incremental delta would buy nothing but a chance to be wrong.
 */
function roundCost(
  teams: readonly Team[],
  partners: ReadonlyMap<PairKey, number>,
  opponents: ReadonlyMap<PairKey, number>,
): number {
  let total = 0;
  for (const team of teams) {
    total += W_PARTNER * partnerCost(team[0], team[1], partners);
  }
  for (let i = 0; i + 1 < teams.length; i += 2) {
    const a = teams[i];
    const b = teams[i + 1];
    if (!a || !b) continue;
    total += W_OPPONENT * crossCost(a, b, opponents);
  }
  return total;
}

/**
 * Repeatedly take the cheapest remaining partnership. Candidate pairs are
 * enumerated in the fixed order of `onCourt` (roster order), and equal-cost
 * candidates are resolved by a single PRNG draw, so the outcome depends only on
 * the roster and the cursor.
 */
function greedyTeams(
  onCourt: readonly string[],
  partners: ReadonlyMap<PairKey, number>,
  rngIn: RngState,
): [Team[], RngState] {
  const remaining = [...onCourt];
  const teams: Team[] = [];
  let rng = rngIn;

  while (remaining.length >= 2) {
    let bestCost = Infinity;
    let best: [number, number] | undefined;
    let ties: Array<[number, number]> = [];

    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < remaining.length; j++) {
        const b = remaining[j];
        if (b === undefined) continue;
        const cost = partnerCost(a, b, partners);
        if (cost < bestCost) {
          bestCost = cost;
          best = [i, j];
          ties = [[i, j]];
        } else if (cost === bestCost) {
          ties.push([i, j]);
        }
      }
    }
    if (!best) break;

    let chosen = best;
    // Only draw when the draw actually decides something, so the cursor
    // advances for a reason and identical inputs stay in lockstep.
    if (ties.length > 1) {
      const [pick, advanced] = nextInt(rng, ties.length);
      rng = advanced;
      chosen = ties[pick] ?? best;
    }

    const [i, j] = chosen;
    const a = remaining[i];
    const b = remaining[j];
    if (a === undefined || b === undefined) break;
    teams.push([a, b]);
    // j > i always, so splicing the later index first keeps i valid.
    remaining.splice(j, 1);
    remaining.splice(i, 1);
  }

  return [teams, rng];
}

/**
 * Pair the teams into matches, cheapest opposition first, so the courts start
 * out opponent-balanced before local search touches anything. The returned
 * array is flat: `[2k]` plays `[2k+1]` on court `k+1`.
 */
function greedyMatchUp(
  teams: readonly Team[],
  opponents: ReadonlyMap<PairKey, number>,
  rngIn: RngState,
): [Team[], RngState] {
  const remaining = [...teams];
  const ordered: Team[] = [];
  let rng = rngIn;

  while (remaining.length >= 2) {
    let bestCost = Infinity;
    let best: [number, number] | undefined;
    let ties: Array<[number, number]> = [];

    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[i];
      if (!a) continue;
      for (let j = i + 1; j < remaining.length; j++) {
        const b = remaining[j];
        if (!b) continue;
        const cost = crossCost(a, b, opponents);
        if (cost < bestCost) {
          bestCost = cost;
          best = [i, j];
          ties = [[i, j]];
        } else if (cost === bestCost) {
          ties.push([i, j]);
        }
      }
    }
    if (!best) break;

    let chosen = best;
    if (ties.length > 1) {
      const [pick, advanced] = nextInt(rng, ties.length);
      rng = advanced;
      chosen = ties[pick] ?? best;
    }

    const [i, j] = chosen;
    const a = remaining[i];
    const b = remaining[j];
    if (!a || !b) break;
    ordered.push(a, b);
    remaining.splice(j, 1);
    remaining.splice(i, 1);
  }

  return [ordered, rng];
}

/**
 * Bounded hill climb: walk every "move one player from team i into team j and
 * take one of theirs back" swap in a fixed order and keep any that lowers the
 * round's cost, repeating until a pass finds nothing or the attempt budget runs
 * out. First-improvement without restarting the enumeration, so a full pass
 * costs exactly its combination count and the budget is a real bound.
 *
 * No PRNG here on purpose — the enumeration order is fixed and only strict
 * improvements are kept, so there is nothing left to break a tie on.
 */
function localSearch(
  teams: readonly Team[],
  partners: ReadonlyMap<PairKey, number>,
  opponents: ReadonlyMap<PairKey, number>,
): Team[] {
  const working: Team[] = teams.map((team) => [team[0], team[1]]);
  let cost = roundCost(working, partners, opponents);
  let attempts = 0;
  let improved = true;

  while (improved && attempts < MAX_SWAP_ATTEMPTS) {
    improved = false;
    passes: for (let i = 0; i < working.length; i++) {
      const teamI = working[i];
      if (!teamI) continue;
      for (let j = i + 1; j < working.length; j++) {
        const teamJ = working[j];
        if (!teamJ) continue;
        for (const si of SLOTS) {
          for (const sj of SLOTS) {
            if (attempts >= MAX_SWAP_ATTEMPTS) break passes;
            attempts++;
            const a = teamI[si];
            const b = teamJ[sj];
            teamI[si] = b;
            teamJ[sj] = a;
            const candidate = roundCost(working, partners, opponents);
            if (candidate < cost) {
              cost = candidate;
              improved = true;
            } else {
              teamI[si] = a;
              teamJ[sj] = b;
            }
          }
        }
      }
    }
  }

  return working;
}
