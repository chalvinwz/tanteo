import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { history } from '@tanteo/engine';
import type { Match } from '@tanteo/engine';

import { Screen } from '../app.js';
import { Button, Note, Numeral } from '../components/primitives.js';
import { ScoreSheet } from '../components/score-sheet.js';
import { t } from '../i18n/index.js';
import { useNavigate } from '../router.js';
import { useTournament } from '../state.js';
import type { ActionError } from '../state.js';

/**
 * The screen the organizer stands in front of.
 *
 * One round at a time, one card per court, the score as the biggest thing on
 * the card. The round number rides in the sticky header rather than the body,
 * because a thumb scrolling a long court list still has to know which round it
 * is scoring. The accent is spent on the one action that moves the evening
 * forward, and the only movement is the round transition.
 */

/* -------------------------------------------------------------------------- */

/**
 * The engine speaks in codes, the catalog speaks to the organizer.
 *
 * An unmapped code falls back to the engine's own sentence rather than a
 * reassuring generic line: a wrong explanation is worse than a blunt one.
 */
function ErrorNote({
  error,
  pointsPerMatch,
  onDismiss,
}: {
  error: ActionError;
  pointsPerMatch: number;
  onDismiss: () => void;
}): ReactNode {
  let title: string;
  let body: string | undefined;
  switch (error.code) {
    case 'INVALID_SCORE':
      title = t('errors.scoreInvalid', { total: pointsPerMatch });
      break;
    case 'HISTORY_IMMUTABLE':
      title = t('errors.historyLocked');
      break;
    case 'UNKNOWN_PLAYER':
      title = t('errors.unknownPlayer');
      break;
    case 'DUPLICATE_PLAYER':
      title = t('errors.duplicatePlayer');
      break;
    default:
      title = t('errors.genericTitle');
      body = t('errors.genericBody');
      break;
  }
  return (
    <Note
      tone="alert"
      title={title}
      // exactOptionalPropertyTypes: omit the key, never pass undefined.
      {...(body === undefined ? {} : { body })}
      action={
        <Button variant="quiet" onClick={onDismiss}>
          {t('common.retry')}
        </Button>
      }
    />
  );
}

/* -------------------------------------------------------------------------- */

function TeamNames({
  ids,
  playerName,
}: {
  ids: readonly string[];
  playerName: (id: string) => string;
}): ReactNode {
  return (
    <>
      {ids.map((id) => (
        // One name per line: wrapping keeps a long name whole at 380px, where
        // truncating would hide the half that tells two players apart.
        <span key={id} className="block break-words text-[15px] font-semibold tracking-tight">
          {playerName(id)}
        </span>
      ))}
    </>
  );
}

/**
 * A court, drawn as a court: a header line, a team, the net, the other team.
 *
 * The whole card is the tap target, and it is a real button, so a keyboard gets
 * the same single stop a thumb gets.
 */
function CourtCard({
  match,
  playerName,
  onOpen,
  delayMs,
}: {
  match: Match;
  playerName: (id: string) => string;
  onOpen: () => void;
  delayMs: number;
}): ReactNode {
  const score =
    match.scoreA !== undefined && match.scoreB !== undefined
      ? { a: match.scoreA, b: match.scoreB }
      : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      // Animation two of the two this app has. The delay staggers the cards in;
      // the class carries fill-mode both, so nothing flickers before its turn.
      style={{ animationDelay: `${delayMs}ms` }}
      className={[
        'animate-court-resort grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3',
        'rounded-court border border-line-control bg-court-800 px-4 py-3 text-left',
        'active:bg-court-700',
      ].join(' ')}
    >
      <span className="col-span-2 row-start-1 flex items-baseline justify-between gap-3 border-b border-line-quiet pb-2 text-[13px] font-semibold text-ink-muted">
        {t('score.heading', { court: match.court })}
        {score === null ? (
          // A real 0 and "nobody entered this" are different facts, so an
          // unscored court never shows a digit. It sits on the header line so
          // the net still crosses the whole card underneath it.
          <span className="font-normal">{t('play.notScored')}</span>
        ) : null}
      </span>

      <span className="col-start-1 row-start-2 min-w-0 py-2.5 text-ink">
        <TeamNames ids={match.teamA} playerName={playerName} />
      </span>
      {score !== null ? (
        <span className="numeral col-start-2 row-start-2 self-center text-[38px] leading-none text-ink">
          <Numeral value={score.a} />
        </span>
      ) : null}

      {/* The net. */}
      <span className="col-span-2 row-start-3 block h-px bg-line-quiet" role="presentation" />

      <span className="col-start-1 row-start-4 min-w-0 py-2.5 text-ink">
        <TeamNames ids={match.teamB} playerName={playerName} />
      </span>
      {score !== null ? (
        <span className="numeral col-start-2 row-start-4 self-center text-[38px] leading-none text-ink">
          <Numeral value={score.b} />
        </span>
      ) : null}
    </button>
  );
}

/**
 * Who is off this round.
 *
 * Under points per round, sitting out costs a player nothing, so this is a
 * roster fact stated plainly, not a warning.
 */
function SitOuts({
  ids,
  playerName,
}: {
  ids: readonly string[];
  playerName: (id: string) => string;
}): ReactNode {
  if (ids.length === 0) {
    return <p className="text-[14px] text-ink-muted">{t('play.nobodySittingOut')}</p>;
  }
  return (
    <div>
      <p className="text-[13px] font-semibold text-ink-muted">{t('play.sittingOut')}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {ids.map((id) => (
          <li
            key={id}
            // court-900 is the token for a court that is out of play, which is
            // exactly what these players are this round.
            className="rounded-court border border-line-quiet bg-court-900 px-2.5 py-1.5 text-[14px] text-ink-muted"
          >
            {playerName(id)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function PlayScreen(): ReactNode {
  const { status, storageBlocked, state, lastError, clearError, drawNextRound, reload } =
    useTournament();
  const navigate = useNavigate();
  const [openCourt, setOpenCourt] = useState<number | null>(null);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const player of state?.players ?? []) map.set(player.id, player.name);
    return map;
  }, [state]);
  // Falls back to the id, which is ugly on purpose: a court holding somebody
  // who is not on the roster is a bug worth seeing, not one worth hiding.
  const playerName = useCallback((id: string): string => nameById.get(id) ?? id, [nameById]);

  // The shell resolves these three before it routes here. They are repeated
  // because this component must not depend on a caller getting that right.
  if (status === 'loading') {
    return (
      <Screen title={t('play.title')}>
        <Note title={t('common.loading')} />
      </Screen>
    );
  }

  if (storageBlocked || status === 'error') {
    return (
      <Screen title={t('play.title')}>
        <Note
          tone="alert"
          title={storageBlocked ? t('errors.storageTitle') : t('errors.genericTitle')}
          {...(storageBlocked
            ? { body: t('errors.storageBody') }
            : lastError
              ? { body: t('errors.genericBody') }
              : {})}
          action={<Button onClick={() => void reload()}>{t('common.retry')}</Button>}
        />
      </Screen>
    );
  }

  if (!state) {
    return (
      <Screen title={t('play.title')}>
        <Note
          title={t('home.emptyTitle')}
          body={t('home.emptyBody')}
          action={
            <Button variant="primary" onClick={() => navigate('/setup')}>
              {t('home.newTournament')}
            </Button>
          }
        />
      </Screen>
    );
  }

  const { config, rounds } = state;
  const errorNote = lastError ? (
    <ErrorNote error={lastError} pointsPerMatch={config.pointsPerMatch} onDismiss={clearError} />
  ) : null;

  // The engine counts rounds from zero. Every 1-based number below is produced
  // right here, at the boundary, and nowhere deeper.
  const cursor = history.currentRoundIndex(state);
  const everyRoundComplete = cursor >= rounds.length;
  const shownIndex = everyRoundComplete ? rounds.length - 1 : cursor;
  const shownRound = rounds[shownIndex];

  if (!shownRound) {
    const activePlayers = history.activeAtRound(state, rounds.length).length;
    const canDraw = activePlayers >= 4;
    return (
      <Screen title={t('play.title')}>
        <div className="flex flex-col gap-5">
          {errorNote}
          <Note
            title={t('play.emptyTitle')}
            body={canDraw ? t('play.emptyBody') : t('play.notEnoughPlayers')}
            action={
              canDraw ? (
                <Button variant="primary" onClick={() => void drawNextRound()}>
                  {t('play.drawFirstRound')}
                </Button>
              ) : null
            }
          />
        </div>
      </Screen>
    );
  }

  // Mexicano deals one round at a time from the standings, so there is
  // something to press. Americano dealt its whole schedule at creation and
  // rolls forward on its own as courts are scored, so it gets a status line
  // rather than a button that could never do anything.
  const isMexicano = config.format === 'mexicano';
  const nextRoundNumber = shownIndex + 2;
  const totalRounds = config.rounds;
  const activeMatch =
    openCourt === null ? undefined : shownRound.matches.find((m) => m.court === openCourt);

  return (
    <Screen
      title={t('play.roundHeading', { current: shownIndex + 1 })}
      action={
        totalRounds === undefined ? null : (
          <p className="text-[15px] text-ink-muted">{t('play.roundOf', { total: totalRounds })}</p>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-[13px] text-ink-muted">{t('play.tapToScore')}</p>

        {errorNote}

        <ul className="flex flex-col gap-3">
          {shownRound.matches.map((match, index) => (
            // The round index is in the key so the cards remount, and replay
            // the round transition, only when the round itself changes.
            <li key={`${shownIndex}:${match.court}`}>
              <CourtCard
                match={match}
                playerName={playerName}
                onOpen={() => setOpenCourt(match.court)}
                delayMs={index * 40}
              />
            </li>
          ))}
        </ul>

        <div className="border-t border-line-quiet pt-4">
          <SitOuts ids={shownRound.sitOuts} playerName={playerName} />
        </div>

        <div className="flex flex-col gap-2 border-t border-line-quiet pt-4">
          {everyRoundComplete && !isMexicano ? (
            <Note title={t('play.scheduleDone')} />
          ) : isMexicano ? (
            <>
              <Button
                variant="primary"
                full
                disabled={!everyRoundComplete}
                onClick={() => void drawNextRound()}
              >
                {t('play.nextRound', { next: nextRoundNumber })}
              </Button>
              {everyRoundComplete ? null : (
                <p className="text-[13px] text-ink-muted">{t('play.finishRoundFirst')}</p>
              )}
            </>
          ) : (
            <p className="text-[13px] text-ink-muted">{t('play.finishRoundFirst')}</p>
          )}
        </div>
      </div>

      {activeMatch ? (
        <ScoreSheet
          key={`${shownIndex}:${activeMatch.court}`}
          open
          onClose={() => setOpenCourt(null)}
          roundIndex={shownIndex}
          match={activeMatch}
          playerName={playerName}
          pointsPerMatch={config.pointsPerMatch}
        />
      ) : null}
    </Screen>
  );
}
