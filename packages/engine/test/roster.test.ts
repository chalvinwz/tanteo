/**
 * Roster mutation, end to end.
 *
 * The product thesis is that the roster is mutable at any point and every point
 * ever scored stays with the human who played it. This file is the guard on that
 * sentence: one describe block per roster event, then one for the guards that
 * stop an organizer from rewriting history.
 *
 * Written against SPEC.md, not against an implementation. Everything comes from
 * the public barrel.
 */
import { describe, expect, it } from 'vitest';
import { addPlayer, applyRosterEvent, createTournament, EngineError, recordScore, standings } from '../src/index.js';
import type { ErrorCode, Player, Round, RosterEvent, Standing, TournamentState } from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/**
 * Americano rather than Mexicano on purpose: Americano precomputes the whole
 * schedule, so "is this player in the draw from round N on?" is a question we
 * can ask of state directly, without generating anything first.
 */
const STARTERS: readonly Player[] = [
  { id: 'adi', name: 'Adi' },
  { id: 'bima', name: 'Bima' },
  { id: 'cahya', name: 'Cahya' },
  { id: 'dewi', name: 'Dewi' },
  { id: 'eko', name: 'Eko' },
  { id: 'gita', name: 'Gita' },
  { id: 'hana', name: 'Hana' },
  { id: 'indra', name: 'Indra' },
];

/** defaultAmericanoRounds(8, 2) = ceil(C(8,2) / 4) = 7. Pinned by SPEC.md. */
const AMERICANO_ROUNDS = 7;
const POINTS_PER_MATCH = 24;

type ScoreLine = readonly [number, number];

/** Fixed, varied, and always totalling pointsPerMatch. Includes a draw. */
const SCORE_LINES: readonly ScoreLine[] = [
  [15, 9],
  [13, 11],
  [12, 12],
  [17, 7],
  [10, 14],
];

function freshTournament(): TournamentState {
  return createTournament(
    { name: 'Roster fixture', format: 'americano', courts: 2, seed: 'roster-fixture' },
    [...STARTERS],
  );
}

function roundAt(state: TournamentState, index: number): Round {
  const round = state.rounds[index];
  if (!round) throw new Error(`fixture error: no round ${index}`);
  return round;
}

function scoreLine(offset: number): ScoreLine {
  const line = SCORE_LINES[offset % SCORE_LINES.length];
  if (!line) throw new Error('unreachable: modulo keeps the index in range');
  return line;
}

/** Records a score on every court of one round. */
function scoreRound(state: TournamentState, roundIndex: number): TournamentState {
  let next = state;
  roundAt(state, roundIndex).matches.forEach((match, slot) => {
    const [a, b] = scoreLine(roundIndex + slot);
    next = recordScore(next, roundIndex, match.court, a, b);
  });
  return next;
}

/** Plays rounds 0..lastRoundIndex inclusive. */
function playThrough(state: TournamentState, lastRoundIndex: number): TournamentState {
  let next = state;
  for (let i = 0; i <= lastRoundIndex; i++) next = scoreRound(next, i);
  return next;
}

/** Rounds 0-3 scored: the standard "mid-tournament" starting point below. */
function midTournament(): TournamentState {
  return playThrough(freshTournament(), 3);
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Applies an event and charges invariant 7 to every case in this file: the input
 * state must be byte-identical afterwards, and the result must be a new object.
 * Using this wrapper everywhere means "leaves the input untouched" is covered by
 * every test below, not only by the one that says so on the tin.
 */
function apply(state: TournamentState, event: RosterEvent): TournamentState {
  const before = JSON.stringify(state);
  const next = applyRosterEvent(state, event);
  expect(JSON.stringify(state)).toBe(before);
  expect(next).not.toBe(state);
  return next;
}

function register(state: TournamentState, player: Player): TournamentState {
  const before = JSON.stringify(state);
  const next = addPlayer(state, player);
  expect(JSON.stringify(state)).toBe(before);
  expect(next).not.toBe(state);
  return next;
}

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
 * The fields a player earns on court. `podiumEligible` is deliberately excluded:
 * it is relative to the rest of the field, so it moves after a player leaves
 * without anything of theirs having changed.
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

function playsIn(round: Round, playerId: string): boolean {
  return round.matches.some((m) => m.teamA.includes(playerId) || m.teamB.includes(playerId));
}

/** In the draw for this round at all — on court or explicitly sitting out. */
function inDraw(round: Round, playerId: string): boolean {
  return playsIn(round, playerId) || round.sitOuts.includes(playerId);
}

function roundsFrom(state: TournamentState, firstIndex: number): Round[] {
  return state.rounds.filter((r) => r.index >= firstIndex);
}

function roundsBefore(state: TournamentState, firstIndex: number): Round[] {
  return state.rounds.filter((r) => r.index < firstIndex);
}

/**
 * Asserts the call throws an EngineError carrying exactly `code`. The try/catch
 * shape matters: an `expect` inside a bare catch block never runs when nothing
 * is thrown, which is the failure mode this helper exists to avoid.
 */
function expectEngineError(code: ErrorCode, run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).code).toBe(code);
    return;
  }
  throw new Error(`expected EngineError ${code}, but the call returned normally`);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function clone(state: TournamentState): TournamentState {
  return JSON.parse(JSON.stringify(state)) as TournamentState;
}

// ---------------------------------------------------------------------------

describe('the fixture itself', () => {
  it('is the 7-round whist schedule SPEC pins for 8 players on 2 courts', () => {
    const state = freshTournament();
    expect(state.rounds.length).toBe(AMERICANO_ROUNDS);
    expect(state.config.pointsPerMatch).toBe(POINTS_PER_MATCH);
    // 8 active on 2 courts: everybody plays, nobody sits.
    for (const round of state.rounds) {
      expect(round.matches.length).toBe(2);
      expect(round.sitOuts).toEqual([]);
    }
  });
});

describe('join', () => {
  it('puts the newcomer in the draw from beforeRound on, and never before', () => {
    const before = midTournament();
    const state = apply(register(before, { id: 'budi', name: 'Budi' }), {
      type: 'join',
      playerId: 'budi',
      beforeRound: 4,
      seed: 'top',
    });

    // Rounds 0-3 are history: Budi was not there and must not appear in them.
    for (const round of roundsBefore(state, 4)) {
      expect(inDraw(round, 'budi')).toBe(false);
    }
    // Invariant 2: from round 4 on he is active, so he either plays or sits out.
    for (const round of roundsFrom(state, 4)) {
      expect(inDraw(round, 'budi')).toBe(true);
    }
    // 9 active on 2 courts still fields 8 players; exactly one sits.
    for (const round of roundsFrom(state, 4)) {
      expect(round.matches.length).toBe(2);
      expect(round.sitOuts.length).toBe(1);
    }
  });

  it('starts the newcomer on zero rounds played', () => {
    const state = apply(register(midTournament(), { id: 'budi', name: 'Budi' }), {
      type: 'join',
      playerId: 'budi',
      beforeRound: 4,
      seed: 'top',
    });

    const budi = standingFor(state, 'budi');
    expect(budi.roundsPlayed).toBe(0);
    expect(budi.totalPoints).toBe(0);
    expect(budi.wins + budi.draws + budi.losses).toBe(0);
    // ppr is 0, not NaN, when roundsPlayed is 0.
    expect(budi.ppr).toBe(0);
  });

  it('records the event, the status and the join round on the player', () => {
    const state = apply(register(midTournament(), { id: 'budi', name: 'Budi' }), {
      type: 'join',
      playerId: 'budi',
      beforeRound: 4,
      seed: 'top',
    });

    const budi = state.players.find((p) => p.id === 'budi');
    expect(budi?.status).toBe('active');
    expect(budi?.joinedBeforeRound).toBe(4);
    expect(budi?.name).toBe('Budi');
    expect(state.events.at(-1)).toEqual({
      type: 'join',
      playerId: 'budi',
      beforeRound: 4,
      seed: 'top',
    });
    expect(state.revision).toBeGreaterThan(midTournament().revision);
  });

  it('keeps the pairing seed on the player record and out of the standings', () => {
    const state = apply(register(midTournament(), { id: 'budi', name: 'Budi' }), {
      type: 'join',
      playerId: 'budi',
      beforeRound: 4,
      seed: 'top',
    });

    // The seed is a pairing hint. It exists...
    expect(state.players.find((p) => p.id === 'budi')?.seed).toBe('top');
    // ...but the leaderboard must never leak it, or a hint becomes a result.
    for (const standing of standings(state)) {
      const asRecord = standing as unknown as Record<string, unknown>;
      expect(Object.keys(asRecord)).not.toContain('seed');
      expect(asRecord['seed']).toBeUndefined();
    }
  });

  it('is optional-seed friendly: omitting the seed is legal', () => {
    const state = apply(register(midTournament(), { id: 'budi', name: 'Budi' }), {
      type: 'join',
      playerId: 'budi',
      beforeRound: 4,
    });

    expect(state.players.find((p) => p.id === 'budi')?.seed).toBeUndefined();
    expect(inDraw(roundAt(state, 4), 'budi')).toBe(true);
  });
});

describe('leave', () => {
  it('takes the player out of every round from beforeRound on', () => {
    const state = apply(midTournament(), { type: 'leave', playerId: 'dewi', beforeRound: 4 });

    for (const round of roundsFrom(state, 4)) {
      // Not on court, and not sitting out either: sit-outs are drawn from the
      // active roster, and she is no longer on it.
      expect(inDraw(round, 'dewi')).toBe(false);
    }
    expect(state.players.find((p) => p.id === 'dewi')?.status).toBe('left');
  });

  it('freezes her stats but leaves her on the leaderboard', () => {
    const before = midTournament();
    const state = apply(before, { type: 'leave', playerId: 'dewi', beforeRound: 4 });

    expect(earned(standingFor(state, 'dewi'))).toEqual(earned(standingFor(before, 'dewi')));
    expect(standingFor(state, 'dewi').roundsPlayed).toBe(4); // not a vacuous match
    expect(standings(state).map((s) => s.playerId)).toContain('dewi');
  });

  it('does not touch a round that already carries a score', () => {
    const before = midTournament();
    const state = apply(before, { type: 'leave', playerId: 'dewi', beforeRound: 4 });

    // Invariant 6, stated as bluntly as it can be stated.
    expect(JSON.stringify(roundsBefore(state, 4))).toBe(JSON.stringify(roundsBefore(before, 4)));
  });

  it('reshapes the remaining rounds around the smaller roster', () => {
    const state = apply(midTournament(), { type: 'leave', playerId: 'dewi', beforeRound: 4 });

    // 7 active on 2 courts: min(2, floor(7/4)) * 4 = 4 players on one court.
    for (const round of roundsFrom(state, 4)) {
      expect(round.matches.length).toBe(1);
      expect(round.sitOuts.length).toBe(3);
    }
  });
});

describe('pause and resume', () => {
  it('skips the paused player and keeps everything they earned', () => {
    const before = playThrough(freshTournament(), 2);
    const statsAtPause = earned(standingFor(before, 'gita'));

    let state = apply(before, { type: 'pause', playerId: 'gita', beforeRound: 3 });
    expect(state.players.find((p) => p.id === 'gita')?.status).toBe('paused');

    // Rounds 3 and 4 happen without her.
    state = playThrough(state, 4);
    for (const round of [roundAt(state, 3), roundAt(state, 4)]) {
      expect(inDraw(round, 'gita')).toBe(false);
    }
    expect(earned(standingFor(state, 'gita'))).toEqual(statsAtPause);
    expect(standings(state).map((s) => s.playerId)).toContain('gita');
  });

  it('brings them back with no seed and no reset', () => {
    let state = apply(playThrough(freshTournament(), 2), {
      type: 'pause',
      playerId: 'gita',
      beforeRound: 3,
    });
    state = playThrough(state, 4);
    const statsWhilePaused = earned(standingFor(state, 'gita'));

    // `resume` carries no seed field at all: she has real history to sort on.
    state = apply(state, { type: 'resume', playerId: 'gita', beforeRound: 5 });

    const gita = state.players.find((p) => p.id === 'gita');
    expect(gita?.status).toBe('active');
    expect(gita?.seed).toBeUndefined();
    expect(earned(standingFor(state, 'gita'))).toEqual(statsWhilePaused);
    for (const round of roundsFrom(state, 5)) {
      expect(inDraw(round, 'gita')).toBe(true);
    }
    // Back to a full 8, so both courts are in use again.
    for (const round of roundsFrom(state, 5)) {
      expect(round.matches.length).toBe(2);
      expect(round.sitOuts).toEqual([]);
    }
  });
});

describe('substitute — the core case', () => {
  /** Rounds 0-3 played, then Eko hands his slot to Fajar before round 4. */
  function afterSubstitution(): { before: TournamentState; after: TournamentState } {
    const before = midTournament();
    const after = apply(register(before, { id: 'fajar', name: 'Fajar' }), {
      type: 'substitute',
      outgoingId: 'eko',
      incomingId: 'fajar',
      beforeRound: 4,
    });
    return { before, after };
  }

  it('leaves the outgoing player every match and every point he played', () => {
    const { before, after } = afterSubstitution();

    // Invariant 5, the reason this engine exists.
    expect(earned(standingFor(after, 'eko'))).toEqual(earned(standingFor(before, 'eko')));
    expect(standingFor(after, 'eko').roundsPlayed).toBe(4); // not a vacuous match
    expect(standingFor(after, 'eko').totalPoints).toBeGreaterThan(0);
  });

  it('leaves the played rounds byte-identical', () => {
    const { before, after } = afterSubstitution();

    // Nothing in rounds 0-3 may shift, not even a court ordering: Eko's name is
    // still on those matches, because he is the one who played them.
    expect(JSON.stringify(roundsBefore(after, 4))).toBe(JSON.stringify(roundsBefore(before, 4)));
    for (const round of roundsBefore(after, 4)) {
      expect(playsIn(round, 'eko')).toBe(true);
      expect(inDraw(round, 'fajar')).toBe(false);
    }
  });

  it('starts the incoming player from zero in the outgoing player’s place', () => {
    const { before, after } = afterSubstitution();

    const fajar = standingFor(after, 'fajar');
    expect(fajar.roundsPlayed).toBe(0);
    expect(fajar.totalPoints).toBe(0);
    expect(fajar.ppr).toBe(0);
    expect(fajar.pointDiff).toBe(0);

    // "Inherits the future schedule slot" means the draw is the same size and
    // shape as it was, with Fajar where Eko would have been. The engine
    // regenerates rounds 4-6 rather than copying names across, so the check is
    // on the shape of the draw, not on identical match objects.
    for (const round of roundsFrom(after, 4)) {
      expect(inDraw(round, 'fajar')).toBe(true);
      expect(inDraw(round, 'eko')).toBe(false);
    }
    for (const [offset, round] of roundsFrom(after, 4).entries()) {
      const original = roundsFrom(before, 4)[offset];
      if (!original) throw new Error('fixture error: round count changed');
      expect(round.matches.length).toBe(original.matches.length);
      expect(round.sitOuts.length).toBe(original.sitOuts.length);
    }
  });

  it('links the two records and keeps both on the leaderboard', () => {
    const { after } = afterSubstitution();

    const eko = after.players.find((p) => p.id === 'eko');
    const fajar = after.players.find((p) => p.id === 'fajar');
    expect(eko?.status).toBe('left');
    expect(eko?.replacedBy).toBe('fajar');
    expect(fajar?.status).toBe('active');
    expect(fajar?.replaces).toBe('eko');
    expect(fajar?.joinedBeforeRound).toBe(4);

    const board = standings(after).map((s) => s.playerId);
    expect(board).toContain('eko');
    expect(board).toContain('fajar');
  });

  it('does not move a single point between the two of them', () => {
    const { before, after } = afterSubstitution();

    const totalBefore = standings(before).reduce((sum, s) => sum + s.totalPoints, 0);
    const totalAfter = standings(after).reduce((sum, s) => sum + s.totalPoints, 0);
    expect(totalAfter).toBe(totalBefore);
    expect(standingFor(after, 'fajar').totalPoints).toBe(0);
  });
});

describe('addPlayer', () => {
  it('registers a name that is inert until an event activates it', () => {
    const state = register(midTournament(), { id: 'reserve', name: 'Reserve' });

    const reserve = state.players.find((p) => p.id === 'reserve');
    expect(reserve?.name).toBe('Reserve');
    expect(reserve?.status).toBe('left');
    // Number.MAX_SAFE_INTEGER stands in for "has not joined any round yet".
    expect(reserve?.joinedBeforeRound).toBe(Number.MAX_SAFE_INTEGER);
    for (const round of state.rounds) {
      expect(inDraw(round, 'reserve')).toBe(false);
    }
  });

  it('rejects an id already on the books', () => {
    expectEngineError('DUPLICATE_PLAYER', () =>
      addPlayer(midTournament(), { id: 'adi', name: 'Adi the Second' }),
    );
  });
});

describe('guards: history is immutable', () => {
  /**
   * Rounds 0-3 are scored, `reserve` is registered but inert, and Gita is
   * paused before round 4. That gives every event type a target for which the
   * only thing wrong is the beforeRound, so the assertion is unambiguous.
   */
  function guardFixture(): TournamentState {
    const withReserve = register(midTournament(), { id: 'reserve', name: 'Reserve' });
    return apply(withReserve, { type: 'pause', playerId: 'gita', beforeRound: 4 });
  }

  const atRound3: readonly RosterEvent[] = [
    { type: 'leave', playerId: 'adi', beforeRound: 3 },
    { type: 'pause', playerId: 'adi', beforeRound: 3 },
    { type: 'resume', playerId: 'gita', beforeRound: 3 },
    { type: 'join', playerId: 'reserve', beforeRound: 3 },
    { type: 'substitute', outgoingId: 'adi', incomingId: 'reserve', beforeRound: 3 },
  ];

  for (const event of atRound3) {
    it(`rejects ${event.type} at the last scored round`, () => {
      expectEngineError('HISTORY_IMMUTABLE', () => applyRosterEvent(guardFixture(), event));
    });
  }

  it('rejects an event below the last scored round', () => {
    expectEngineError('HISTORY_IMMUTABLE', () =>
      applyRosterEvent(guardFixture(), { type: 'leave', playerId: 'adi', beforeRound: 0 }),
    );
  });

  it('accepts the first unscored round', () => {
    const state = apply(guardFixture(), { type: 'leave', playerId: 'adi', beforeRound: 4 });
    expect(state.players.find((p) => p.id === 'adi')?.status).toBe('left');
  });

  it('accepts any round beyond it', () => {
    const state = apply(guardFixture(), { type: 'leave', playerId: 'adi', beforeRound: 6 });
    expect(inDraw(roundAt(state, 5), 'adi')).toBe(true);
    expect(inDraw(roundAt(state, 6), 'adi')).toBe(false);
  });
});

describe('guards: the player must make sense', () => {
  it('UNKNOWN_PLAYER when joining an id nobody registered', () => {
    expectEngineError('UNKNOWN_PLAYER', () =>
      applyRosterEvent(midTournament(), { type: 'join', playerId: 'ghost', beforeRound: 4 }),
    );
  });

  it('UNKNOWN_PLAYER when leaving an id nobody registered', () => {
    expectEngineError('UNKNOWN_PLAYER', () =>
      applyRosterEvent(midTournament(), { type: 'leave', playerId: 'ghost', beforeRound: 4 }),
    );
  });

  it('UNKNOWN_PLAYER when substituting in an unregistered id', () => {
    expectEngineError('UNKNOWN_PLAYER', () =>
      applyRosterEvent(midTournament(), {
        type: 'substitute',
        outgoingId: 'eko',
        incomingId: 'ghost',
        beforeRound: 4,
      }),
    );
  });

  it('UNKNOWN_PLAYER when substituting out an unregistered id', () => {
    const state = register(midTournament(), { id: 'reserve', name: 'Reserve' });
    expectEngineError('UNKNOWN_PLAYER', () =>
      applyRosterEvent(state, {
        type: 'substitute',
        outgoingId: 'ghost',
        incomingId: 'reserve',
        beforeRound: 4,
      }),
    );
  });

  /**
   * SPEC AMBIGUITY, flagged rather than papered over.
   *
   * SPEC.md's `join` row says "a repeat id throws DUPLICATE_PLAYER". Read
   * against the error list, PLAYER_ALREADY_ACTIVE is the equally defensible
   * code, and it leaves DUPLICATE_PLAYER to mean exactly one thing: an id
   * registered twice. Until the spec picks one, this test pins the part that is
   * not in doubt — joining someone who is already in the draw is rejected, with
   * a typed EngineError, and the state survives. Both codes are pinned exactly
   * elsewhere in this file (addPlayer for DUPLICATE_PLAYER, resume for
   * PLAYER_ALREADY_ACTIVE), so neither goes uncovered.
   */
  it('rejects joining someone already in the draw', () => {
    const state = midTournament();
    const before = JSON.stringify(state);
    let thrown: unknown;
    try {
      applyRosterEvent(state, { type: 'join', playerId: 'adi', beforeRound: 4 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EngineError);
    const code: ErrorCode = (thrown as EngineError).code;
    expect(['DUPLICATE_PLAYER', 'PLAYER_ALREADY_ACTIVE']).toContain(code);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('PLAYER_NOT_ACTIVE when leaving someone who already left', () => {
    const state = apply(midTournament(), { type: 'leave', playerId: 'adi', beforeRound: 4 });
    expectEngineError('PLAYER_NOT_ACTIVE', () =>
      applyRosterEvent(state, { type: 'leave', playerId: 'adi', beforeRound: 5 }),
    );
  });

  it('PLAYER_NOT_ACTIVE when pausing someone who already left', () => {
    const state = apply(midTournament(), { type: 'leave', playerId: 'adi', beforeRound: 4 });
    expectEngineError('PLAYER_NOT_ACTIVE', () =>
      applyRosterEvent(state, { type: 'pause', playerId: 'adi', beforeRound: 5 }),
    );
  });

  it('PLAYER_NOT_ACTIVE when substituting out someone who already left', () => {
    const left = apply(midTournament(), { type: 'leave', playerId: 'eko', beforeRound: 4 });
    const state = register(left, { id: 'fajar', name: 'Fajar' });
    expectEngineError('PLAYER_NOT_ACTIVE', () =>
      applyRosterEvent(state, {
        type: 'substitute',
        outgoingId: 'eko',
        incomingId: 'fajar',
        beforeRound: 5,
      }),
    );
  });

  it('PLAYER_ALREADY_ACTIVE when resuming someone who never paused', () => {
    expectEngineError('PLAYER_ALREADY_ACTIVE', () =>
      applyRosterEvent(midTournament(), { type: 'resume', playerId: 'adi', beforeRound: 4 }),
    );
  });

  it('PLAYER_ALREADY_ACTIVE when resuming twice', () => {
    let state = apply(midTournament(), { type: 'pause', playerId: 'gita', beforeRound: 4 });
    state = apply(state, { type: 'resume', playerId: 'gita', beforeRound: 5 });
    expectEngineError('PLAYER_ALREADY_ACTIVE', () =>
      applyRosterEvent(state, { type: 'resume', playerId: 'gita', beforeRound: 6 }),
    );
  });

  it('leaves the state alone when it rejects an event', () => {
    const state = midTournament();
    const before = JSON.stringify(state);
    expectEngineError('UNKNOWN_PLAYER', () =>
      applyRosterEvent(state, { type: 'leave', playerId: 'ghost', beforeRound: 4 }),
    );
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('purity', () => {
  /**
   * `apply` and `register` already assert this on every call above; these two
   * spell it out for a reader skimming for invariant 7, and add the stronger
   * form: a deep-frozen state must still go through, which fails loudly (in ESM
   * strict mode) if the implementation writes to the input anywhere.
   */
  it('applyRosterEvent never writes to its input, even a frozen one', () => {
    const frozen = deepFreeze(clone(midTournament()));
    const events: readonly RosterEvent[] = [
      { type: 'leave', playerId: 'adi', beforeRound: 4 },
      { type: 'pause', playerId: 'bima', beforeRound: 4 },
    ];
    for (const event of events) {
      expect(() => applyRosterEvent(frozen, event)).not.toThrow();
    }
  });

  it('addPlayer never writes to its input, even a frozen one', () => {
    const frozen = deepFreeze(clone(midTournament()));
    expect(() => addPlayer(frozen, { id: 'reserve', name: 'Reserve' })).not.toThrow();
  });

  it('keeps state plain JSON through a whole roster story', () => {
    let state = midTournament();
    state = apply(register(state, { id: 'budi', name: 'Budi' }), {
      type: 'join',
      playerId: 'budi',
      beforeRound: 4,
      seed: 'middle',
    });
    state = apply(register(state, { id: 'fajar', name: 'Fajar' }), {
      type: 'substitute',
      outgoingId: 'eko',
      incomingId: 'fajar',
      beforeRound: 4,
    });
    state = apply(state, { type: 'pause', playerId: 'hana', beforeRound: 4 });
    state = apply(state, { type: 'resume', playerId: 'hana', beforeRound: 5 });

    // Invariant 8: a round trip through JSON changes nothing at all.
    expect(JSON.stringify(clone(state))).toBe(JSON.stringify(state));
  });
});
