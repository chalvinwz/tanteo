/**
 * Edge cases the engine settles on the caller's behalf.
 *
 * Each case here is one the brief left open and the engine now answers in a
 * specific way. They live together because the reason they exist is the same:
 * a shell over the engine should never have to guess, and a future native port
 * reading SPEC.md should find these pinned rather than discover them.
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
import type { Player, Round, TournamentState } from '../src/index.js';

const STARTERS: Player[] = [
  { id: 'adi', name: 'Adi' },
  { id: 'bima', name: 'Bima' },
  { id: 'cahya', name: 'Cahya' },
  { id: 'dewi', name: 'Dewi' },
];

/** Score every court in the current round, team A taking the larger share. */
function playRound(state: TournamentState, roundIndex: number): TournamentState {
  const round = state.rounds[roundIndex];
  if (!round) throw new Error(`no round ${roundIndex} to play`);
  const points = state.config.pointsPerMatch;
  return round.matches.reduce(
    (acc, match) => recordScore(acc, roundIndex, match.court, points - 10, 10),
    state,
  );
}

describe('a name on the roster sheet is not yet a competitor', () => {
  it('leaves a registered but never-joined player off the board', () => {
    const base = createTournament(
      { name: 'Friday social', format: 'mexicano', courts: 1, seed: 'edges' },
      STARTERS,
    );
    const withGhost = addPlayer(base, { id: 'eko', name: 'Eko' });

    expect(standings(base).map((row) => row.playerId)).toEqual(
      standings(withGhost).map((row) => row.playerId),
    );
    expect(standings(withGhost).map((row) => row.playerId)).not.toContain('eko');
  });

  it('puts them on the board the moment a join dates their entry', () => {
    let state = createTournament(
      { name: 'Friday social', format: 'mexicano', courts: 1, seed: 'edges' },
      STARTERS,
    );
    state = addPlayer(state, { id: 'eko', name: 'Eko' });
    state = generateNextRound(state);
    state = playRound(state, 0);
    state = applyRosterEvent(state, {
      type: 'join',
      playerId: 'eko',
      beforeRound: 1,
      seed: 'middle',
    });

    const row = standings(state).find((entry) => entry.playerId === 'eko');
    expect(row).toBeDefined();
    // On the board, but with nothing to his name yet — which is the honest
    // reading of someone who has just walked onto the court.
    expect(row?.roundsPlayed).toBe(0);
    expect(row?.ppr).toBe(0);
  });
});

describe('there is no podium before the first score', () => {
  it('returns an empty podium on an all-zero board', () => {
    const state = createTournament(
      { name: 'Friday social', format: 'mexicano', courts: 1, seed: 'edges' },
      STARTERS,
    );

    // Everyone is on the board and technically clears a bar of zero...
    expect(standings(state)).toHaveLength(4);
    expect(standings(state).every((row) => row.podiumEligible)).toBe(true);
    // ...but crowning three of them would rank people on typing order alone.
    expect(podium(state)).toEqual([]);
  });

  it('returns a podium once a round is on the sheet', () => {
    let state = createTournament(
      { name: 'Friday social', format: 'mexicano', courts: 1, seed: 'edges' },
      STARTERS,
    );
    state = generateNextRound(state);
    state = playRound(state, 0);

    expect(podium(state).length).toBeGreaterThan(0);
  });
});

describe('a late join fills the draw it arrives into, not a longer one', () => {
  it('keeps the americano round count fixed when someone joins', () => {
    let state = createTournament(
      { name: 'Friday social', format: 'americano', courts: 1, seed: 'edges' },
      STARTERS,
    );
    const plannedRounds = state.rounds.length;
    // Four players on one court: C(4,2) = 6 pairs, 2 per round, so 3 rounds.
    expect(plannedRounds).toBe(3);

    state = playRound(state, 0);
    state = addPlayer(state, { id: 'eko', name: 'Eko' });
    state = applyRosterEvent(state, { type: 'join', playerId: 'eko', beforeRound: 1 });

    // The brief says a roster event regenerates future rounds to include the
    // newcomer. It does not say the evening gets longer, and an organizer who
    // planned three rounds gets three rounds. The cost is that five players on
    // one court cannot give everyone every partner, which is the truth of the
    // situation rather than a defect.
    expect(state.rounds).toHaveLength(plannedRounds);

    // Eko is in the draw from round 1 on: either on court or sitting out, but
    // accounted for. Note he is not the one who sits — the fairness rule picks
    // on sit-out count, and everyone is level at zero, so it falls to roster
    // order. Walking in late does not cost you the next round.
    const round = state.rounds[1];
    const onCourt = round?.matches.flatMap((match) => [...match.teamA, ...match.teamB]) ?? [];
    expect([...onCourt, ...(round?.sitOuts ?? [])]).toContain('eko');
    expect(round?.sitOuts).toHaveLength(1);
  });

  it('does not disturb a round that already has a score', () => {
    let state = createTournament(
      { name: 'Friday social', format: 'americano', courts: 1, seed: 'edges' },
      STARTERS,
    );
    state = playRound(state, 0);
    // State is plain JSON by design, so this is a faithful deep copy.
    const played = JSON.parse(JSON.stringify(state.rounds[0])) as Round;

    state = addPlayer(state, { id: 'eko', name: 'Eko' });
    state = applyRosterEvent(state, { type: 'join', playerId: 'eko', beforeRound: 1 });

    expect(state.rounds[0]).toStrictEqual(played);
  });
});
