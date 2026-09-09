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

import { createWriteToken, deriveReadToken } from '@tanteo/share';

import {
  deleteTournament,
  listTournaments,
  loadTournament,
  newId,
  saveTournament,
  storageAvailable,
} from './db.js';
import type { ShareTokens, StoredTournament } from './db.js';
import { createSyncer } from './sync.js';
import type { SyncState, Syncer } from './sync.js';

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

  /** Null until the organizer creates a share link for the open tournament. */
  share: ShareTokens | null;
  syncState: SyncState | null;
  startSharing: () => Promise<ShareTokens | null>;

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

  const [share, setShare] = useState<ShareTokens | null>(null);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  // Mirrors `share` for the callbacks below, which must not be rebuilt on every
  // token change or every save would re-subscribe the syncer.
  const shareRef = useRef<ShareTokens | null>(null);
  const syncerRef = useRef<Syncer | null>(null);

  /** Not a hook: just keeps the ref the save path reads in step with state. */
  const rememberShare = (tokens: ShareTokens | null): void => {
    shareRef.current = tokens;
  };

  const ensureSyncer = useCallback((tokens: ShareTokens | null): Syncer | null => {
    if (!tokens) {
      syncerRef.current?.stop();
      syncerRef.current = null;
      setSyncState(null);
      return null;
    }
    if (syncerRef.current) return syncerRef.current;
    const syncer = createSyncer(tokens.readToken, tokens.writeToken);
    syncer.subscribe(setSyncState);
    setSyncState(syncer.current());
    syncerRef.current = syncer;
    return syncer;
  }, []);

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
        setShare(mostRecent.share);
        rememberShare(mostRecent.share);
        // Push once on open, not only on the next mutation. The server keeps
        // one row per token and can lose it (a restart, a wiped volume), and
        // until something is pushed every link holder sees "no board on this
        // link". Re-sending what we already have costs one small request.
        ensureSyncer(mostRecent.share)?.push(mostRecent.state);
      }
      setStatus('ready');
    } catch (error) {
      setLastError(toActionError(error));
      setStatus('error');
    }
  }, [ensureSyncer]);

  useEffect(() => {
    void boot();
  }, [boot]);

  // A syncer holds a retry timer and an 'online' listener; neither should
  // outlive the provider.
  useEffect(() => () => syncerRef.current?.stop(), []);

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
        void saveTournament(id, next, shareRef.current)
          .then(refreshList)
          .catch((error: unknown) => setLastError(toActionError(error)));
        // Sharing is best effort and never blocks the local write: if the radio
        // is off the syncer keeps the newest snapshot and sends it later.
        syncerRef.current?.push(next);
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
        // A new tournament is private until the organizer asks to share it.
        rememberShare(null);
        ensureSyncer(null);
        setShare(null);
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
    setShare(stored.share);
    rememberShare(stored.share);
    // Reopening a shared tournament resumes pushing, and re-sends immediately
    // so a viewer is not left on a dead link until the next score.
    ensureSyncer(null);
    ensureSyncer(stored.share)?.push(stored.state);
  }, [ensureSyncer]);

  const discard = useCallback(
    async (id: string) => {
      await deleteTournament(id);
      if (id === activeId) {
        setActiveId(null);
        setState(null);
        setShare(null);
        rememberShare(null);
        ensureSyncer(null);
      }
      await refreshList();
    },
    [activeId, refreshList, ensureSyncer],
  );

  /**
   * Mint a share link for the open tournament and push it once immediately, so
   * the link works the moment it is handed over rather than after the next tap.
   */
  const startSharing = useCallback<TournamentContextValue['startSharing']>(async () => {
    if (!activeId || !state) return null;
    if (shareRef.current) return shareRef.current;
    try {
      const writeToken = createWriteToken();
      const readToken = await deriveReadToken(writeToken);
      const tokens: ShareTokens = { readToken, writeToken };
      rememberShare(tokens);
      setShare(tokens);
      await saveTournament(activeId, state, tokens);
      await refreshList();
      ensureSyncer(tokens)?.push(state);
      return tokens;
    } catch (error) {
      setLastError(toActionError(error));
      return null;
    }
  }, [activeId, state, refreshList, ensureSyncer]);

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
      share,
      syncState,
      startSharing,
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
      share,
      syncState,
      startSharing,
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
