import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import type { Match } from '@tanteo/engine';

import { t } from '../i18n/index.js';
import { useTournament } from '../state.js';
import { Button, Numeral, Sheet, cx } from './primitives.js';

/**
 * The giant two-team counter.
 *
 * One court, two zones, one number each. Everything here is sized for a thumb
 * that is wet, in a hand that is also holding a phone, belonging to someone who
 * is refereeing at the same time. That is why the zones are enormous and the
 * chrome is two lines of grey text.
 */

/** How long a press has to last before it reads as "take one back" instead of "add". */
const HOLD_MS = 450;

export interface ScoreSheetProps {
  open: boolean;
  onClose: () => void;
  /** Engine-side, zero-based. The 1-based round number lives in the header on play.tsx. */
  roundIndex: number;
  match: Match;
  playerName: (id: string) => string;
  pointsPerMatch: number;
}

export function ScoreSheet({
  open,
  onClose,
  roundIndex,
  match,
  playerName,
  pointsPerMatch,
}: ScoreSheetProps): ReactNode {
  const { score, unscore } = useTournament();

  // What is already on the record, or null for a court nobody has scored yet.
  // "Nobody entered it" and "somebody entered a zero" are different facts, and
  // this is the variable that keeps them apart.
  const recordedA =
    match.scoreA !== undefined && match.scoreB !== undefined ? match.scoreA : null;

  // A draft, not a live write. Under fixed-total scoring every intermediate
  // value is a *valid* score, so writing on each tap would leave a half-entered
  // 5 to 19 sitting on the board looking exactly like a finished match.
  //
  // The ref is the draft; the state exists only to re-render it. A thumb can
  // land a tap and Save inside one React batch, and a commit that read the
  // render closure would then write the value from before the tap.
  const draft = useRef<number | null>(recordedA);
  const [draftA, setDraftA] = useState<number | null>(recordedA);

  const a = draftA ?? 0;
  const b = pointsPerMatch - a;

  /** Move team A's score by delta and clamp; team B is always the remainder. */
  const bump = useCallback(
    (delta: number): void => {
      const next = Math.min(pointsPerMatch, Math.max(0, (draft.current ?? 0) + delta));
      draft.current = next;
      setDraftA(next);
    },
    [pointsPerMatch],
  );

  // Closing is committing. Escape, the header's Done, the backdrop and Save all
  // land here, because losing twenty taps to a stray tap outside the sheet is a
  // far worse courtside outcome than a save the organizer can undo with Clear.
  const commitAndClose = useCallback((): void => {
    const entered = draft.current;
    if (entered !== null && entered !== recordedA) {
      void score(roundIndex, match.court, entered, pointsPerMatch - entered);
    }
    onClose();
  }, [recordedA, score, roundIndex, match.court, pointsPerMatch, onClose]);

  // Deliberately calls onClose directly rather than commitAndClose: the draft
  // still holds the old value and would write it straight back.
  const clearAndClose = useCallback((): void => {
    void unscore(roundIndex, match.court);
    onClose();
  }, [unscore, roundIndex, match.court, onClose]);

  const namesA: [string, string] = [playerName(match.teamA[0]), playerName(match.teamA[1])];
  const namesB: [string, string] = [playerName(match.teamB[0]), playerName(match.teamB[1])];

  return (
    <Sheet
      open={open}
      onClose={commitAndClose}
      title={t('score.heading', { court: match.court })}
      // Every exit commits, so the footer holds the only way out and the
      // header's duplicate is dropped.
      headerClose={false}
      footer={
        <div className="flex items-center gap-3">
          {recordedA !== null ? (
            // Only offered when there is something to clear. Organizers mistype,
            // and this is the way back.
            <Button variant="quiet" onClick={clearAndClose}>
              {t('score.clear')}
            </Button>
          ) : null}
          <Button variant="primary" onClick={commitAndClose} className="flex-1">
            {t('common.done')}
          </Button>
        </div>
      }
    >
      <p className="text-[13px] leading-snug text-ink-muted">
        {t('score.total', { total: pointsPerMatch })}
      </p>

      {/*
        One court box, two halves, split by the net. The box takes the sheet's
        height (92vh) less its chrome, and the halves split what is left, so the
        zones swallow every spare pixel on a big phone and both stay on screen
        together on a small one. 18rem is that chrome measured (sheet header,
        this block's padding, the total line, the two hint lines, the footer)
        plus a little slack for a longer translation, and the home indicator is
        subtracted on top because the sheet pads for it.
      */}
      <div className="mt-3 flex h-[calc(92vh-18rem-env(safe-area-inset-bottom))] min-h-80 flex-col overflow-hidden rounded-court border border-line-control">
        <TeamZone
          className="flex-1"
          names={namesA}
          score={a}
          atMax={a >= pointsPerMatch}
          atMin={a <= 0}
          onAdd={() => bump(1)}
          onRemove={() => bump(-1)}
        />
        <div className="h-px w-full shrink-0 bg-line-control" role="presentation" />
        <TeamZone
          className="flex-1"
          names={namesB}
          score={b}
          atMax={b >= pointsPerMatch}
          atMin={b <= 0}
          // Team B's points are team A's points in reverse: the total is fixed.
          onAdd={() => bump(-1)}
          onRemove={() => bump(1)}
        />
      </div>

      {/* Said once, quietly, so the gesture is findable without being shouted. */}
      <p className="mt-3 text-[13px] leading-snug text-ink-muted">{t('score.tapToAdd')}</p>
      <p className="text-[13px] leading-snug text-ink-muted">{t('score.holdToRemove')}</p>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Half the court: a name pair, one enormous numeral, and two explicit buttons.
 *
 * The zone itself is a plain element with pointer handlers rather than a
 * button, for two reasons. A button cannot legally contain the plus and minus
 * buttons, and a long press is unusable from a keyboard and awkward with a
 * screen reader. So the gesture is a shortcut layered on top, and the two
 * labelled buttons are the real, always-available control.
 */
function TeamZone({
  names,
  score,
  atMax,
  atMin,
  onAdd,
  onRemove,
  className,
}: {
  names: readonly [string, string];
  score: number;
  atMax: boolean;
  atMin: boolean;
  onAdd: () => void;
  onRemove: () => void;
  className?: string;
}): ReactNode {
  const labelId = useId();
  const holdTimer = useRef<number | null>(null);
  const consumed = useRef(false);

  const cancelHold = (): void => {
    if (holdTimer.current === null) return;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  useEffect(() => cancelHold, []);

  /** A press that landed on plus or minus belongs to that button, not the zone. */
  const fromButton = (event: ReactPointerEvent<HTMLElement>): boolean =>
    (event.target as HTMLElement).closest('button') !== null;

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (fromButton(event)) return;
    consumed.current = false;
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      consumed.current = true;
      onRemove();
    }, HOLD_MS);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    if (fromButton(event)) return;
    cancelHold();
    if (consumed.current) {
      consumed.current = false;
      return;
    }
    onAdd();
  };

  // Finger slid off, or the browser took the gesture for a scroll: no point
  // either way.
  const abandon = (): void => {
    cancelHold();
    consumed.current = false;
  };

  const team = names.join(' ');

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={abandon}
      onPointerCancel={abandon}
      // A long press on touch otherwise raises the selection callout on top of
      // the number the organizer is trying to read.
      onContextMenu={(event) => event.preventDefault()}
      className={cx(
        'flex min-h-40 touch-manipulation flex-col justify-between gap-3 bg-court-950 px-4 py-4',
        className,
      )}
    >
      <p id={labelId} className="text-[15px] font-semibold tracking-tight text-ink">
        {names.map((name, index) => (
          // Two lines rather than a joined string: a long name wraps instead of
          // being cut, and there is no separator glyph to translate.
          <span key={`${index}:${name}`} className="block break-words">
            {name}
          </span>
        ))}
      </p>

      {/* <output> is a live region, so pressing plus or minus is announced. */}
      <output
        aria-labelledby={labelId}
        className="numeral block text-center text-[clamp(4rem,24vw,7rem)] leading-none text-optic"
      >
        <Numeral value={score} />
      </output>

      {/* Far corners: two 44px targets that a thumb cannot confuse. */}
      <div className="flex items-center justify-between gap-4">
        <Button
          aria-label={t('score.decrement', { team })}
          disabled={atMin}
          onClick={onRemove}
          className="w-16 text-2xl"
        >
          &minus;
        </Button>
        <Button
          aria-label={t('score.increment', { team })}
          disabled={atMax}
          onClick={onAdd}
          className="w-16 text-2xl"
        >
          +
        </Button>
      </div>
    </div>
  );
}
