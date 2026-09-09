import type { TournamentState } from '@tanteo/engine';

/**
 * Pushing the board to the share server.
 *
 * The organizer's phone is the source of truth and the network is the
 * unreliable part, so this is deliberately one-way and forgetful: after every
 * mutation we try to push the whole snapshot, and if that fails we keep only
 * the newest one to send later. There is no queue of intermediate states to
 * replay, because an older snapshot has nothing to add once a newer one exists.
 *
 * Nothing here can block or fail a local write. Scoring works with the radio
 * off; sharing is the part that waits.
 */

export type SyncStatus = 'idle' | 'pushing' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  /** Epoch millis of the last push the server accepted. */
  lastPushedAt: number | null;
  /** Revision the server has confirmed, so the UI can say "not sent yet". */
  lastPushedRevision: number | null;
}

export interface Syncer {
  /** Record the newest snapshot and try to send it. Never throws. */
  push(state: TournamentState): void;
  subscribe(listener: (state: SyncState) => void): () => void;
  current(): SyncState;
  stop(): void;
}

/** Backoff between retries. Courtside signal comes and goes in seconds. */
const RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export function createSyncer(
  readToken: string,
  writeToken: string,
  options: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Syncer {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => Date.now());

  let pending: TournamentState | null = null;
  let inFlight = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  let state: SyncState = { status: 'idle', lastPushedAt: null, lastPushedRevision: null };
  const listeners = new Set<(s: SyncState) => void>();

  const emit = (next: Partial<SyncState>): void => {
    state = { ...state, ...next };
    for (const listener of listeners) listener(state);
  };

  const scheduleRetry = (): void => {
    if (stopped || timer) return;
    const delay = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] ?? 30_000;
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delay);
  };

  async function run(): Promise<void> {
    if (stopped || inFlight) return;
    const snapshot = pending;
    if (!snapshot) return;

    inFlight = true;
    emit({ status: 'pushing' });
    try {
      const response = await doFetch(`/api/t/${readToken}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tanteo-write-token': writeToken,
          'x-tanteo-revision': String(snapshot.revision),
        },
        body: JSON.stringify(snapshot),
      });

      if (!response.ok) {
        // A 4xx is our fault and retrying will not fix it, so stop hammering a
        // server that has already told us no.
        const permanent = response.status >= 400 && response.status < 500;
        emit({ status: 'error' });
        if (!permanent) {
          attempt += 1;
          scheduleRetry();
        }
        return;
      }

      // Only clear the pending snapshot if it is still the one we just sent.
      // A mutation during the request leaves a newer one to go out next.
      if (pending === snapshot) pending = null;
      attempt = 0;
      emit({
        status: 'idle',
        lastPushedAt: now(),
        lastPushedRevision: snapshot.revision,
      });
      if (pending) void run();
    } catch {
      // A thrown fetch is the radio, not the server.
      emit({ status: 'offline' });
      attempt += 1;
      scheduleRetry();
    } finally {
      inFlight = false;
    }
  }

  const onBackOnline = (): void => {
    attempt = 0;
    void run();
  };
  if (typeof window !== 'undefined') window.addEventListener('online', onBackOnline);

  return {
    push(snapshot) {
      pending = snapshot;
      void run();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    current: () => state,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      listeners.clear();
      if (typeof window !== 'undefined') window.removeEventListener('online', onBackOnline);
    },
  };
}
