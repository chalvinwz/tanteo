import Dexie from 'dexie';
import type { EntityTable } from 'dexie';

import type { TournamentState } from '@tanteo/engine';

/**
 * On-device storage.
 *
 * The organizer's phone is the source of truth, so the tournament lives here
 * first and reaches the share server second. The engine has no clock and no id
 * generator by design, so both are supplied at this boundary.
 */

export interface StoredTournament {
  id: string;
  state: TournamentState;
  /** Epoch millis of the last write. Used to order the resume list. */
  updatedAt: number;
  /** Capability token for the read-only share link, once one is minted. */
  shareToken: string | null;
}

const db = new Dexie('tanteo') as Dexie & {
  tournaments: EntityTable<StoredTournament, 'id'>;
};

db.version(1).stores({ tournaments: 'id, updatedAt' });

export function newId(): string {
  // randomUUID needs a secure context. Courtside that is https or localhost,
  // but a self-hosted box on plain http is a real deployment, so fall back.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function listTournaments(): Promise<StoredTournament[]> {
  return db.tournaments.orderBy('updatedAt').reverse().toArray();
}

export async function loadTournament(id: string): Promise<StoredTournament | undefined> {
  return db.tournaments.get(id);
}

export async function saveTournament(
  id: string,
  state: TournamentState,
  shareToken: string | null,
): Promise<void> {
  await db.tournaments.put({ id, state, updatedAt: Date.now(), shareToken });
}

export async function deleteTournament(id: string): Promise<void> {
  await db.tournaments.delete(id);
}

/**
 * Whether this browser will actually let us persist anything.
 *
 * Private windows and blocked storage settings both fail here, and an
 * organizer needs to hear that before they have typed in twelve names, not
 * after. Called once at startup.
 */
export async function storageAvailable(): Promise<boolean> {
  try {
    await db.open();
    return true;
  } catch {
    return false;
  }
}

export { db };
