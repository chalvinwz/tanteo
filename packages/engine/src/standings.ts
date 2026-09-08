import { UNENTERED } from './types.js';
import type { RankingMetric, Standing, TournamentState } from './types.js';

/**
 * The leaderboard.
 *
 * This module is where the product thesis becomes visible: every point is
 * attributed to the human who actually played it, so everyone who has ever
 * been in the draw keeps a row — players who left, players who were paused,
 * players who were substituted out. Points never migrate to whoever inherited
 * a schedule slot, because standings are derived from the ids written on the
 * matches rather than from anything carried on a PlayerRecord.
 */

/** Running tally for one player. Local to a standings() call; never stored. */
interface Tally {
  roundsPlayed: number;
  totalPoints: number;
  wins: number;
  draws: number;
  losses: number;
  pointDiff: number;
}

function emptyTally(): Tally {
  return { roundsPlayed: 0, totalPoints: 0, wins: 0, draws: 0, losses: 0, pointDiff: 0 };
}

/** The value the board sorts on, before tiebreaks. */
function metricValue(standing: Standing, metric: RankingMetric): number {
  switch (metric) {
    case 'ppr':
      return standing.ppr;
    case 'total':
      return standing.totalPoints;
    case 'wins':
      return standing.wins;
  }
}

export function standings(state: TournamentState): Standing[] {
  // Roster order is both the output's build order and the specified final
  // tiebreak, so tallies are indexed by position in state.players. A repeated
  // id folds into its first row rather than producing two rows that split one
  // person's history — createTournament rejects duplicates, but splitting a
  // history is the one failure mode this module must never introduce.
  const order = new Map<string, number>();
  const ids: string[] = [];
  const tallies: Tally[] = [];
  for (const player of state.players) {
    if (order.has(player.id)) continue;
    // A player registered by addPlayer but never activated is a name on the
    // roster sheet, not a competitor. Showing them as an all-zero row would put
    // a ghost on the live board and, before anyone has played, let them onto
    // the podium. They appear the moment a join or substitute dates their entry.
    if (player.joinedBeforeRound === UNENTERED) continue;
    order.set(player.id, ids.length);
    ids.push(player.id);
    tallies.push(emptyTally());
  }

  const credit = (playerId: string, own: number, other: number): void => {
    const index = order.get(playerId);
    if (index === undefined) return; // on a court but not on the roster: nothing to credit
    const tally = tallies[index];
    if (!tally) return;
    tally.roundsPlayed += 1;
    tally.totalPoints += own;
    tally.pointDiff += own - other;
    if (own > other) tally.wins += 1;
    else if (own < other) tally.losses += 1;
    else tally.draws += 1;
  };

  // One pass over every scored match. history.roundsPlayed() would hand back
  // that single field directly, but the other five counters need exactly this
  // walk anyway, so deriving them together keeps one definition of "played"
  // instead of two that could drift. Invariant 1 (no player twice in a round)
  // is what lets a match counted here stand for a round played.
  for (const round of state.rounds) {
    for (const match of round.matches) {
      const { scoreA, scoreB } = match;
      // A half-entered score is not a result yet and must not move the board.
      if (scoreA === undefined || scoreB === undefined) continue;
      for (const id of match.teamA) credit(id, scoreA, scoreB);
      for (const id of match.teamB) credit(id, scoreB, scoreA);
    }
  }

  // Eligibility is relative to the busiest player, not to the round count, so
  // that sit-outs and a schedule cut short do not silently disqualify anyone.
  // Nobody played yet => ceil(pct x 0) === 0 => everyone clears the bar.
  let maxRoundsPlayed = 0;
  for (const tally of tallies) {
    if (tally.roundsPlayed > maxRoundsPlayed) maxRoundsPlayed = tally.roundsPlayed;
  }
  const minRoundsForPodium = Math.ceil(state.config.podiumMinRoundsPct * maxRoundsPlayed);

  const rows: Standing[] = ids.map((playerId, index) => {
    const tally = tallies[index] ?? emptyTally();
    return {
      playerId,
      roundsPlayed: tally.roundsPlayed,
      totalPoints: tally.totalPoints,
      // Guarded division. A 0/0 here would be NaN, which poisons the sort
      // (every comparison against it is false) and serializes to null over
      // the wire, so an unplayed player is defined to sit at 0.
      ppr: tally.roundsPlayed === 0 ? 0 : tally.totalPoints / tally.roundsPlayed,
      wins: tally.wins,
      draws: tally.draws,
      losses: tally.losses,
      pointDiff: tally.pointDiff,
      podiumEligible: tally.roundsPlayed >= minRoundsForPodium,
    };
  });

  const metric = state.config.rankingMetric;
  // Carrying the roster index through the sort rather than leaning on
  // Array#sort stability: roster order is a specified tiebreak, so it is
  // compared explicitly and the result is deterministic on any engine.
  return rows
    .map((standing, rosterIndex) => ({ standing, rosterIndex }))
    .sort((a, b) => {
      // Descending on the metric, then the tiebreak ladder from SPEC.md.
      // Some metrics duplicate a tiebreak (rankingMetric 'total' vs the total
      // points tiebreak); the duplicate is a no-op, which is cheaper than
      // special-casing the ladder per metric.
      const byMetric = metricValue(b.standing, metric) - metricValue(a.standing, metric);
      if (byMetric !== 0) return byMetric;
      const byPoints = b.standing.totalPoints - a.standing.totalPoints;
      if (byPoints !== 0) return byPoints;
      const byDiff = b.standing.pointDiff - a.standing.pointDiff;
      if (byDiff !== 0) return byDiff;
      const byWins = b.standing.wins - a.standing.wins;
      if (byWins !== 0) return byWins;
      return a.rosterIndex - b.rosterIndex;
    })
    .map((entry) => entry.standing);
}

export function podium(state: TournamentState): Standing[] {
  // standings() has already ranked everyone, so the podium is that order with
  // the ineligible stepped over — they keep their row and their badge on the
  // board, they just cannot occupy a final place. Fewer than three players
  // (or fewer than three eligible) yields a short podium rather than padding.
  const ranked = standings(state);
  // Before a single score is in, the eligibility bar is ceil(pct x 0) === 0, so
  // everyone clears it and the top three of an all-zero board would be crowned
  // on roster order alone. There is no podium yet; say so.
  if (ranked.every((standing) => standing.roundsPlayed === 0)) return [];
  return ranked.filter((standing) => standing.podiumEligible).slice(0, 3);
}
