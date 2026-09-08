import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
  addPlayer as engineAddPlayer,
  applyRosterEvent,
  clearScore as engineClearScore,
  createTournament,
  EngineError,
  generateNextRound,
  recordScore,
} from '@tanteo/engine';
import type { Player, RosterEvent, TournamentConfigInput, TournamentState } from '@tanteo/engine';

import {
  deleteTournament,
  listTournaments,
  loadTournament,
  newId,
  saveTournament,
  storageAvailable,
} from './db.js';
import type { StoredTournament } from './db.js';

/**
 * The one place the app talks to the engine.
 *
 * Every action is the same shape: call the pure engine, keep the new state,
 * write it to IndexedDB. Nothing here re-implements a rule; if a rule seems
 * missing, it belongs in packages/engine, not in a component.
 */

export type Status = 'loading' | 'ready' | 'error';

/** A failed action, held so a screen can show what went wrong and why. */
export interface ActionError {
  code: string;
  message: string;
}

interface TournamentContextValue {
  status: Status;
  /** Set when storage itself is unavailable, which is fatal for the app. */
  storageBlocked: boolean;
  saved: StoredTournament[];
  activeId: string | null;
  state: TournamentState | null;
  lastError: ActionError | null;
  clearError: () => void;

  create: (config: TournamentConfigInput, players: Player[]) => Promise<string | null>;
  open: (id: string) => Promise<void>;
  discard: (id: string) => Promise<void>;
  score: (roundIndex: number, court: number, scoreA: number, scoreB: number) => Promise<void>;
  unscore: (roundIndex: number, court: number) => Promise<void>;
  drawNextRound: () => Promise<void>;
  registerPlayer: (player: Player) => Promise<void>;
  applyEvent: (event: RosterEvent) => Promise<void>;
  reload: () => Promise<void>;
}

const TournamentContext = createContext<TournamentContextValue | null>(null);

function toActionError(error: unknown): ActionError {
  if (error instanceof EngineError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: 'UNKNOWN', message: error.message };
  return { code: 'UNKNOWN', message: String(error) };
}

export function TournamentProvider({ children }: { children: ReactNode }): ReactNode {
  const [status, setStatus] = useState<Status>('loading');
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [saved, setSaved] = useState<StoredTournament[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [state, setState] = useState<TournamentState | null>(null);
  const [lastError, setLastError] = useState<ActionError | null>(null);

  // The share token is minted in M3; carried here so a save never drops it.
  const shareTokenRef = useRef<string | null>(null);

  const refreshList = useCallback(async () => {
    setSaved(await listTournaments());
  }, []);

  const boot = useCallback(async () => {
    setStatus('loading');
    if (!(await storageAvailable())) {
      setStorageBlocked(true);
      setStatus('error');
      return;
    }
    try {
      const all = await listTournaments();
      setSaved(all);
      // Reopening the app drops you back into the most recent tournament,
      // because that is almost always the one still being played.
      const mostRecent = all[0];
      if (mostRecent) {
        setActiveId(mostRecent.id);
        setState(mostRecent.state);
        shareTokenRef.current = mostRecent.shareToken;
      }
      setStatus('ready');
    } catch (error) {
      setLastError(toActionError(error));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  /** Run an engine call, persist the result, and surface a failure as state. */
  const mutate = useCallback(
    async (id: string, apply: (current: TournamentState) => TournamentState) => {
      setLastError(null);
      setState((current) => {
        if (!current) return current;
        let next: TournamentState;
        try {
          next = apply(current);
        } catch (error) {
          setLastError(toActionError(error));
          return current;
        }
        // Persist outside the reducer's return path but inside this closure, so
        // the write always carries the value the UI just committed to.
        void saveTournament(id, next, shareTokenRef.current)
          .then(refreshList)
          .catch((error: unknown) => setLastError(toActionError(error)));
        return next;
      });
    },
    [refreshList],
  );

  const create = useCallback<TournamentContextValue['create']>(
    async (config, players) => {
      setLastError(null);
      try {
        const created = createTournament(config, players);
        const id = newId();
        shareTokenRef.current = null;
        await saveTournament(id, created, null);
        setActiveId(id);
        setState(created);
        await refreshList();
        return id;
      } catch (error) {
        setLastError(toActionError(error));
        return null;
      }
    },
    [refreshList],
  );

  const open = useCallback(async (id: string) => {
    const stored = await loadTournament(id);
    if (!stored) return;
    setActiveId(stored.id);
    setState(stored.state);
    shareTokenRef.current = stored.shareToken;
  }, []);

  const discard = useCallback(
    async (id: string) => {
      await deleteTournament(id);
      if (id === activeId) {
        setActiveId(null);
        setState(null);
        shareTokenRef.current = null;
      }
      await refreshList();
    },
    [activeId, refreshList],
  );

  const score = useCallback<TournamentContextValue['score']>(
    async (roundIndex, court, scoreA, scoreB) => {
      if (!activeId) return;
      await mutate(activeId, (current) => recordScore(current, roundIndex, court, scoreA, scoreB));
    },
    [activeId, mutate],
  );

  const unscore = useCallback<TournamentContextValue['unscore']>(
    async (roundIndex, court) => {
      if (!activeId) return;
      await mutate(activeId, (current) => engineClearScore(current, roundIndex, court));
    },
    [activeId, mutate],
  );

  const drawNextRound = useCallback(async () => {
    if (!activeId) return;
    await mutate(activeId, (current) => generateNextRound(current));
  }, [activeId, mutate]);

  const registerPlayer = useCallback<TournamentContextValue['registerPlayer']>(
    async (player) => {
      if (!activeId) return;
      await mutate(activeId, (current) => engineAddPlayer(current, player));
    },
    [activeId, mutate],
  );

  const applyEvent = useCallback<TournamentContextValue['applyEvent']>(
    async (event) => {
      if (!activeId) return;
      await mutate(activeId, (current) => applyRosterEvent(current, event));
    },
    [activeId, mutate],
  );

  const value = useMemo<TournamentContextValue>(
    () => ({
      status,
      storageBlocked,
      saved,
      activeId,
      state,
      lastError,
      clearError: () => setLastError(null),
      create,
      open,
      discard,
      score,
      unscore,
      drawNextRound,
      registerPlayer,
      applyEvent,
      reload: boot,
    }),
    [
      status,
      storageBlocked,
      saved,
      activeId,
      state,
      lastError,
      create,
      open,
      discard,
      score,
      unscore,
      drawNextRound,
      registerPlayer,
      applyEvent,
      boot,
    ],
  );

  return <TournamentContext.Provider value={value}>{children}</TournamentContext.Provider>;
}

export function useTournament(): TournamentContextValue {
  const value = useContext(TournamentContext);
  if (!value) throw new Error('useTournament must be used inside <TournamentProvider>');
  return value;
}
