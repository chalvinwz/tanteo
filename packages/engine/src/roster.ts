/**
 * tanteo engine — roster mutation.
 *
 * The product's whole reason to exist: people arrive late, leave at half time,
 * and hand their racket to a friend, and the scoreboard has to stay honest
 * through all of it. Two rules make that work:
 *
 *  1. History is immutable. An event may only be dated at a round that has no
 *     score yet, so no already-played match can be re-dealt beneath a result.
 *  2. Results belong to the human who earned them. A substitution moves a
 *     *schedule position*, never a point — the outgoing player keeps every
 *     match they played, and the incoming one starts at zero. Nothing in this
 *     file reads or writes match scores, which is what guarantees it.
 */

import { generateAmericanoRounds } from './americano.js';
import { lastScoredRoundIndex } from './history.js';
import { EngineError, UNENTERED } from './types.js';
import type { Player, PlayerRecord, RosterEvent, TournamentState } from './types.js';

/**
 * Register a name against an id without putting them in the draw.
 *
 * `applyRosterEvent` takes only an event, which carries ids and no names, so a
 * newcomer has to be registered first. They land inert: `left`, and joining
 * "before" a round beyond any real schedule, so every history helper treats
 * them as absent until a join/substitute event dates their actual entry.
 */
export function addPlayer(state: TournamentState, player: Player): TournamentState {
  if (state.players.some((p) => p.id === player.id)) {
    throw new EngineError('DUPLICATE_PLAYER', `player id "${player.id}" is already registered`);
  }

  const record: PlayerRecord = {
    id: player.id,
    name: player.name,
    status: 'left',
    joinedBeforeRound: UNENTERED,
  };

  return {
    ...state,
    players: [...state.players, record],
    revision: state.revision + 1,
  };
}

function requireRecord(state: TournamentState, playerId: string): PlayerRecord {
  const record = state.players.find((p) => p.id === playerId);
  if (!record) {
    throw new EngineError(
      'UNKNOWN_PLAYER',
      `player "${playerId}" is not registered — call addPlayer first`,
    );
  }
  return record;
}

function requireActive(record: PlayerRecord): void {
  if (record.status !== 'active') {
    throw new EngineError(
      'PLAYER_NOT_ACTIVE',
      `player "${record.id}" is ${record.status}, not active`,
    );
  }
}

function requireNotActive(record: PlayerRecord): void {
  if (record.status === 'active') {
    throw new EngineError('PLAYER_ALREADY_ACTIVE', `player "${record.id}" is already active`);
  }
}

/** Swap in replacement records by id, preserving roster order. */
function replaceRecords(
  players: readonly PlayerRecord[],
  updates: readonly PlayerRecord[],
): PlayerRecord[] {
  return players.map((player) => updates.find((u) => u.id === player.id) ?? player);
}

/**
 * Validate the event against the current roster and return the updated records.
 * Throws before anything is built, so a rejected event leaves no trace.
 */
function applyEffects(state: TournamentState, event: RosterEvent): PlayerRecord[] {
  switch (event.type) {
    case 'join': {
      const record = requireRecord(state, event.playerId);
      requireNotActive(record);
      const joined: PlayerRecord = {
        ...record,
        status: 'active',
        joinedBeforeRound: event.beforeRound,
        // exactOptionalPropertyTypes: omit the key rather than assign undefined.
        ...(event.seed === undefined ? {} : { seed: event.seed }),
      };
      return replaceRecords(state.players, [joined]);
    }

    case 'leave': {
      const record = requireRecord(state, event.playerId);
      requireActive(record);
      return replaceRecords(state.players, [{ ...record, status: 'left' }]);
    }

    case 'pause': {
      const record = requireRecord(state, event.playerId);
      requireActive(record);
      // Identical to 'leave' for pairing; kept distinct so the UI can say
      // "back in a bit" instead of writing someone off.
      return replaceRecords(state.players, [{ ...record, status: 'paused' }]);
    }

    case 'resume': {
      const record = requireRecord(state, event.playerId);
      requireNotActive(record);
      // joinedBeforeRound stays put: they were here all along, and their
      // played rounds are already on the board. No seed either — a returning
      // player is ranked on results, not on a guess.
      return replaceRecords(state.players, [{ ...record, status: 'active' }]);
    }

    case 'substitute': {
      const outgoing = requireRecord(state, event.outgoingId);
      const incoming = requireRecord(state, event.incomingId);
      requireActive(outgoing);
      requireNotActive(incoming);

      // Only status and the two cross-references change on the outgoing side.
      // Their matches, and therefore their points, are untouched by design.
      const left: PlayerRecord = {
        ...outgoing,
        status: 'left',
        replacedBy: incoming.id,
      };
      const arrived: PlayerRecord = {
        ...incoming,
        status: 'active',
        replaces: outgoing.id,
        joinedBeforeRound: event.beforeRound,
        ...(event.seed === undefined ? {} : { seed: event.seed }),
      };
      return replaceRecords(state.players, [left, arrived]);
    }
  }
}

/**
 * Re-deal every round from `beforeRound` forward.
 *
 * The guard in `applyRosterEvent` has already established that none of those
 * rounds carry a score, so dropping them destroys nothing.
 */
function regenerate(interim: TournamentState, beforeRound: number): TournamentState {
  // slice() clamps, so an event dated past the end of the schedule keeps every
  // round and simply appends from the end — no index gap.
  const kept = interim.rounds.slice(0, beforeRound);

  if (interim.config.format !== 'americano') {
    // Mexicano pairs off live standings one round at a time; generateNextRound
    // will rebuild the tail when the organizer asks for it.
    return { ...interim, rounds: kept, revision: interim.revision + 1 };
  }

  const totalRounds = interim.config.rounds ?? interim.rounds.length;
  const from = kept.length;
  const base: TournamentState = { ...interim, rounds: kept };
  const { rounds: regenerated, rng } = generateAmericanoRounds(base, from, totalRounds);

  return {
    ...base,
    rounds: [...kept, ...regenerated],
    rng,
    revision: interim.revision + 1,
  };
}

/**
 * Apply a roster change and re-deal the future.
 *
 * Order matters here: the event is appended to the log *before* regeneration,
 * because the pairing engines read the roster through `history.activeAtRound`,
 * which replays the log. A round re-dealt against a stale log would seat the
 * player who just walked off.
 */
export function applyRosterEvent(state: TournamentState, event: RosterEvent): TournamentState {
  if (event.beforeRound < 0) {
    throw new EngineError(
      'HISTORY_IMMUTABLE',
      `beforeRound must be >= 0, got ${event.beforeRound}`,
    );
  }
  const lastScored = lastScoredRoundIndex(state);
  // Equality is forbidden too: a round holding even one score is played, and a
  // roster change cannot reach back into it.
  if (event.beforeRound <= lastScored) {
    throw new EngineError(
      'HISTORY_IMMUTABLE',
      `round ${event.beforeRound} is already played (last scored round is ${lastScored})`,
    );
  }

  const players = applyEffects(state, event);
  const interim: TournamentState = {
    ...state,
    players,
    events: [...state.events, event],
  };

  return regenerate(interim, event.beforeRound);
}
