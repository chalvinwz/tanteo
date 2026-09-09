import { useEffect, useRef, useState } from 'react';

import type { TournamentState } from '@tanteo/engine';

/**
 * The read side of a share link.
 *
 * A viewer holds a read token and nothing else. This fetches the board once,
 * then keeps it current over SSE, falling back to polling when the stream will
 * not hold. Either way the caller gets the same three things: the board, how
 * old it is, and whether we are actually connected, because a board on a
 * screen at the venue is dangerous if it is quietly frozen.
 */

export type LiveStatus = 'loading' | 'live' | 'polling' | 'offline' | 'missing' | 'error';

export interface LiveBoard {
  status: LiveStatus;
  state: TournamentState | null;
  /** Epoch millis when we last received a board, live or polled. */
  receivedAt: number | null;
  retry: () => void;
}

/** Polling cadence when SSE is unavailable. The brief asks for five seconds. */
const POLL_MS = 5_000;
/** If no frame or heartbeat arrives in this long, the stream is not alive. */
const STREAM_TIMEOUT_MS = 45_000;

export function useLiveBoard(readToken: string): LiveBoard {
  const [status, setStatus] = useState<LiveStatus>('loading');
  const [state, setState] = useState<TournamentState | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  // Held in a ref so the polling loop can read the latest without re-subscribing.
  const lastSeen = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;

    const accept = (body: string): void => {
      if (cancelled) return;
      try {
        setState(JSON.parse(body) as TournamentState);
        lastSeen.current = Date.now();
        setReceivedAt(lastSeen.current);
      } catch {
        // A malformed frame is the server's problem, not a reason to blank a
        // board that is already on a screen at the venue. Keep what we have.
        setStatus('error');
      }
    };

    const fetchOnce = async (): Promise<boolean> => {
      try {
        const response = await fetch(`/api/t/${readToken}`, { cache: 'no-store' });
        if (response.status === 404) {
          if (!cancelled) setStatus('missing');
          return false;
        }
        if (!response.ok) {
          if (!cancelled) setStatus('error');
          return false;
        }
        accept(await response.text());
        return true;
      } catch {
        if (!cancelled) setStatus('offline');
        return false;
      }
    };

    const startPolling = (): void => {
      if (pollTimer || cancelled) return;
      setStatus('polling');
      pollTimer = setInterval(() => void fetchOnce(), POLL_MS);
    };

    const startStream = (): void => {
      if (cancelled || typeof EventSource === 'undefined') {
        startPolling();
        return;
      }
      source = new EventSource(`/api/t/${readToken}/stream`);

      source.addEventListener('snapshot', (event) => {
        accept((event as MessageEvent<string>).data);
        if (!cancelled) setStatus('live');
      });
      source.addEventListener('ping', () => {
        lastSeen.current = Date.now();
        if (!cancelled) setStatus('live');
      });
      source.onopen = () => {
        if (cancelled) return;
        lastSeen.current = Date.now();
        setStatus('live');
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      };
      source.onerror = () => {
        // EventSource reconnects on its own, but a proxy that kills the stream
        // outright leaves it retrying forever, so polling takes over and the
        // stream is allowed to win again if it comes back.
        if (!cancelled) startPolling();
      };

      // A stream that is open but silent looks identical to a live one, which
      // is exactly the failure a venue screen must not hide.
      watchdog = setInterval(() => {
        if (cancelled) return;
        if (Date.now() - lastSeen.current > STREAM_TIMEOUT_MS) startPolling();
      }, STREAM_TIMEOUT_MS / 3);
    };

    void fetchOnce().then((ok) => {
      if (cancelled) return;
      // No board under this token yet: there is nothing to stream, so say so
      // and poll in case the organizer pushes one in a minute.
      if (!ok) startPolling();
      else startStream();
    });

    return () => {
      cancelled = true;
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
      if (watchdog) clearInterval(watchdog);
    };
  }, [readToken, nonce]);

  return { status, state, receivedAt, retry: () => setNonce((n) => n + 1) };
}

/** "just now", "2 min ago". Used for the staleness line on the live view. */
export function describeAge(receivedAt: number | null, now: number): string | null {
  if (receivedAt === null) return null;
  const seconds = Math.max(0, Math.round((now - receivedAt) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} h ago`;
}
