import { useEffect, useRef, useState } from 'react';

import type { TournamentState } from '@tanteo/engine';

import { t } from './i18n/index.js';

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
  /**
   * Epoch millis when the board last CHANGED. This is what "Updated 3 min ago"
   * means, and in padel it is normal for it to be minutes old: a game takes a
   * while to finish.
   */
  receivedAt: number | null;
  /**
   * Epoch millis when we last heard from the server at all, counting
   * heartbeats and successful polls that carried no new score.
   *
   * These are two different facts and conflating them is a real bug: judging
   * "is this connection alive" by the age of the last score makes a healthy
   * stream accuse the organizer of being offline halfway through every game.
   */
  contactAt: number | null;
  retry: () => void;
}

/** Polling cadence when SSE is unavailable. The brief asks for five seconds. */
const POLL_MS = 5_000;
/** If no frame or heartbeat arrives in this long, the stream is not alive. */
const STREAM_TIMEOUT_MS = 45_000;
/** How often to ask whether anything has arrived lately. */
const FRESHNESS_CHECK_MS = 5_000;

export function useLiveBoard(readToken: string): LiveBoard {
  const [status, setStatus] = useState<LiveStatus>('loading');
  const [state, setState] = useState<TournamentState | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [contactAt, setContactAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  // Held in a ref so the watchdog can read the latest without re-subscribing.
  const lastContact = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    // Start the clock at mount, so the freshness check gives the first fetch a
    // chance instead of declaring us stale before anything has been tried.
    lastContact.current = Date.now();
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;

    /** Anything at all from the server counts as contact, score or not. */
    const noteContact = (): void => {
      if (cancelled) return;
      lastContact.current = Date.now();
      setContactAt(lastContact.current);
    };

    const accept = (body: string): void => {
      if (cancelled) return;
      try {
        setState(JSON.parse(body) as TournamentState);
        noteContact();
        setReceivedAt(Date.now());
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
        // A heartbeat proves the connection, not a new score.
        noteContact();
        if (!cancelled) setStatus('live');
      });
      source.onopen = () => {
        if (cancelled) return;
        noteContact();
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

    };

    // The freshness check runs for the whole life of the hook, not just while a
    // stream is open, and it is what decides whether we are connected.
    //
    // Trusting EventSource.onerror to report its own death is not enough: a
    // stream killed at the far end can sit in an open-looking state and never
    // fire, which was observed with a stopped server still showing "Live" two
    // minutes later. A venue screen that has silently frozen is the single
    // worst failure this view can have, so staleness is judged by whether
    // anything actually arrived, and by nothing else.
    watchdog = setInterval(() => {
      if (cancelled) return;
      if (Date.now() - lastContact.current <= STREAM_TIMEOUT_MS) return;
      setStatus((current) => (current === 'live' ? 'polling' : current));
      startPolling();
    }, FRESHNESS_CHECK_MS);

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

  return { status, state, receivedAt, contactAt, retry: () => setNonce((n) => n + 1) };
}

/**
 * "just now", "2 min ago". Goes through the string catalog like everything
 * else, so Bahasa Indonesia can reach it.
 */
export function describeAge(at: number | null, now: number): string | null {
  if (at === null) return null;
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 10) return t('age.justNow');
  if (seconds < 60) return t('age.seconds', { count: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('age.minutes', { count: minutes });
  return t('age.hours', { count: Math.round(minutes / 60) });
}

/**
 * Whether the board should stop claiming to be current.
 *
 * Keyed on contact, never on the last score: a padel game runs minutes between
 * points, so a board that has simply not been scored recently is healthy, and
 * saying otherwise trains people to ignore the warning.
 */
export function isOutOfTouch(contactAt: number | null, now: number): boolean {
  if (contactAt === null) return true;
  return now - contactAt > STREAM_TIMEOUT_MS;
}
