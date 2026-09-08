import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { history, UNENTERED } from '@tanteo/engine';
import type { Format, TournamentState } from '@tanteo/engine';

import { Screen } from '../app.js';
import { Button, Note, Rule, Sheet } from '../components/primitives.js';
import type { StoredTournament } from '../db.js';
import { t } from '../i18n/index.js';
import { useNavigate } from '../router.js';
import { useTournament } from '../state.js';

/**
 * The front door: what is already running, and the one way to start something.
 *
 * ENERGY 1. This screen is a list and a button. The optic accent appears once,
 * on the action that starts an evening, and nowhere else — the scoreboard is
 * where the colour gets spent.
 */

function formatLabel(format: Format): string {
  return format === 'americano' ? t('setup.americano') : t('setup.mexicano');
}

/**
 * Where the organizer left off.
 *
 * `currentRoundIndex` is the first round that is not complete, so it lands one
 * past the end once every round is scored. Clamped to the total, a finished
 * Americano reads "Round 7 of 7" instead of "Round 8 of 7". Mexicano carries no
 * total in config, so it just names the round standing in front of you.
 */
function roundLabel(state: TournamentState): string {
  const current = history.currentRoundIndex(state) + 1;
  const total = state.config.rounds;
  if (total === undefined) return t('home.roundOpen', { current });
  return t('home.roundProgress', { current: Math.min(current, total), total });
}

/**
 * A name registered but never dated into the draw is a name on the roster
 * sheet, not a competitor, so it stays out of the headline count.
 */
function enteredCount(state: TournamentState): number {
  return state.players.filter((player) => player.joinedBeforeRound !== UNENTERED).length;
}

function SavedCard({
  stored,
  onOpen,
  onDiscard,
}: {
  stored: StoredTournament;
  onOpen: () => void;
  onDiscard: () => void;
}): ReactNode {
  const base = useId();
  const nameId = `${base}-name`;
  const discardId = `${base}-discard`;
  const { state } = stored;
  // An untitled tournament still has to be findable in the list, so the format
  // stands in as the heading and then drops out of the meta row beneath it.
  const named = state.config.name.trim();

  return (
    <li className="rounded-court border border-line-control bg-court-800">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col gap-1.5 rounded-court px-4 py-3 text-left active:bg-court-700"
      >
        <span className="flex w-full items-baseline justify-between gap-3">
          <span id={nameId} className="min-w-0 break-words text-[17px] font-bold tracking-tight text-ink">
            {named || formatLabel(state.config.format)}
          </span>
          <span className="shrink-0 text-[13px] font-semibold text-ink-muted">
            {t('home.resumeAction')}
          </span>
        </span>
        <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-ink-muted">
          {named ? <span>{formatLabel(state.config.format)}</span> : null}
          <span>{roundLabel(state)}</span>
          <span>{t('home.playerCount', { count: enteredCount(state) })}</span>
        </span>
      </button>
      <Rule />
      <div className="flex justify-end px-2 py-2">
        <Button
          variant="quiet"
          id={discardId}
          // Reads as "Discard this tournament, <name>" without inventing a
          // second string: the button's own text plus the heading above it.
          aria-labelledby={`${discardId} ${nameId}`}
          onClick={onDiscard}
        >
          {t('home.discard')}
        </Button>
      </div>
    </li>
  );
}

export function HomeScreen(): ReactNode {
  const { status, storageBlocked, saved, lastError, open, discard, reload } = useTournament();
  const navigate = useNavigate();
  // Held as the whole record, not the id, so the confirm sheet can still name
  // what it is about to delete while the list refreshes underneath it.
  const [pending, setPending] = useState<StoredTournament | null>(null);

  // db.ts already hands these back newest-first; re-stating it here keeps the
  // ordering a property of the screen that depends on it.
  const ordered = useMemo(() => [...saved].sort((a, b) => b.updatedAt - a.updatedAt), [saved]);

  const resume = async (id: string): Promise<void> => {
    await open(id);
    navigate('/play');
  };

  const confirmDiscard = async (): Promise<void> => {
    const target = pending;
    if (!target) return;
    setPending(null);
    await discard(target.id);
  };

  let body: ReactNode;
  if (storageBlocked) {
    body = (
      <Note
        tone="alert"
        title={t('errors.storageTitle')}
        body={t('errors.storageBody')}
        action={<Button onClick={() => void reload()}>{t('common.retry')}</Button>}
      />
    );
  } else if (status === 'loading') {
    body = <Note title={t('common.loading')} />;
  } else if (status === 'error') {
    body = (
      <Note
        tone="alert"
        title={t('errors.genericTitle')}
        // exactOptionalPropertyTypes: omit `body` rather than pass undefined.
        {...(lastError ? { body: lastError.message } : {})}
        action={<Button onClick={() => void reload()}>{t('common.retry')}</Button>}
      />
    );
  } else if (ordered.length === 0) {
    body = (
      <Note
        title={t('home.emptyTitle')}
        body={t('home.emptyBody')}
        action={
          <Button variant="primary" onClick={() => navigate('/setup')}>
            {t('home.newTournament')}
          </Button>
        }
      />
    );
  } else {
    body = (
      <>
        <h2 className="text-[15px] font-bold tracking-tight text-ink">{t('home.resumeTitle')}</h2>
        <ul className="flex flex-col gap-3">
          {ordered.map((stored) => (
            <SavedCard
              key={stored.id}
              stored={stored}
              onOpen={() => void resume(stored.id)}
              onDiscard={() => setPending(stored)}
            />
          ))}
        </ul>
        <Rule />
        <Button variant="primary" full onClick={() => navigate('/setup')}>
          {t('home.newTournament')}
        </Button>
      </>
    );
  }

  return (
    <Screen title={t('app.name')}>
      <div className="flex flex-col gap-4 px-4 py-4">{body}</div>
      {pending ? (
        <Sheet
          open
          onClose={() => setPending(null)}
          title={t('home.discard')}
          footer={
            <div className="flex justify-end gap-3">
              <Button variant="quiet" onClick={() => setPending(null)}>
                {t('common.cancel')}
              </Button>
              {/* Destructive, so it stays a bordered surface: the optic accent
                  belongs to scores and the leader, not to deleting an evening. */}
              <Button onClick={() => void confirmDiscard()}>{t('common.confirm')}</Button>
            </div>
          }
        >
          <p className="text-[15px] leading-snug text-ink">
            {t('home.discardConfirm', {
              name:
                pending.state.config.name.trim() || formatLabel(pending.state.config.format),
            })}
          </p>
        </Sheet>
      ) : null}
    </Screen>
  );
}
