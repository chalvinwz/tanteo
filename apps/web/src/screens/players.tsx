import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { history, standings, UNENTERED } from '@tanteo/engine';
import type { PlayerRecord, PlayerStatus, Seed, Standing, TournamentState } from '@tanteo/engine';

import { Screen } from '../app.js';
import { Button, ChoiceRow, Field, Note, Rule, Sheet, TextInput, cx } from '../components/primitives.js';
import type { Choice } from '../components/primitives.js';
import { newId } from '../db.js';
import { t } from '../i18n/index.js';
import type { StringKey } from '../i18n/index.js';
import { useTournament } from '../state.js';

/**
 * The roster.
 *
 * Design read: a courtside utility screen for one organizer holding one phone,
 * in the floodlit-court language of DESIGN.md, dialled ENERGY 1 / RHYTHM 2 /
 * MOTION 0. Nothing on this screen moves. The two animations this app owns
 * belong to a score and to a round change, and neither happens here.
 *
 * The screen exists because the roster is mutable at any point and every point
 * stays with whoever played it. So a player who has left keeps their row and
 * their numbers, a substitution is spelled out from both ends, and the round a
 * change will land on is stated before anyone commits to it.
 *
 * The accent is not spent here. Optic yellow is for scores in motion and the
 * current leader, both of which live on the other two screens; the only optic
 * on this one is the confirm button inside a sheet and the focus ring.
 */

type RowAction = 'pause' | 'leave' | 'substitute' | 'resume';

type Draft =
  | { kind: 'add'; name: string; seed: Seed }
  | { kind: 'substitute'; outgoingId: string; name: string };

/** Who is on court first, then who might come back, then the record. */
const GROUPS: ReadonlyArray<{ status: PlayerStatus; heading: StringKey }> = [
  { status: 'active', heading: 'players.active' },
  { status: 'paused', heading: 'players.paused' },
  { status: 'left', heading: 'players.left' },
];

/** The engine codes an organizer can actually cause from this screen. */
function errorTitle(code: string): string {
  switch (code) {
    case 'HISTORY_IMMUTABLE':
      return t('errors.historyLocked');
    case 'UNKNOWN_PLAYER':
      return t('errors.unknownPlayer');
    case 'DUPLICATE_PLAYER':
      return t('errors.duplicatePlayer');
    default:
      return t('errors.genericTitle');
  }
}

/**
 * The last round this player has a recorded score in, or null if they never
 * played one. "Stats frozen at round N" is only true of a round they actually
 * scored in, so someone who left before playing says nothing rather than
 * claiming a frozen round zero.
 */
function lastPlayedRound(state: TournamentState, playerId: string): number | null {
  let last: number | null = null;
  for (const round of state.rounds) {
    const appeared = round.matches.some(
      (match) =>
        match.scoreA !== undefined &&
        match.scoreB !== undefined &&
        (match.teamA.includes(playerId) || match.teamB.includes(playerId)),
    );
    if (appeared) last = round.index;
  }
  return last;
}

/* -------------------------------------------------------------------------- */

function PlayerRow({
  player,
  standing,
  frozenRound,
  replacedByName,
  replacesName,
  first,
  onAct,
}: {
  player: PlayerRecord;
  standing: Standing | undefined;
  frozenRound: number | null;
  replacedByName: string | undefined;
  replacesName: string | undefined;
  first: boolean;
  onAct: (kind: RowAction) => void;
}): ReactNode {
  const nameId = useId();
  const outOfPlay = player.status !== 'active';

  return (
    <li
      className={cx(
        'flex flex-col gap-2 px-4 py-3',
        // court-900 is the token for a court that is out of play, so a paused
        // or departed player sits on the out-of-play surface. It is a second
        // signal and never the only one: the section heading above the row and
        // the button inside it both say the same thing in words.
        outOfPlay && 'bg-court-900',
        !first && 'border-t border-line-quiet',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p
          id={nameId}
          className="min-w-0 break-words text-[17px] font-semibold tracking-tight text-ink"
        >
          {player.name}
        </p>
        {/* The frozen stats a departed player keeps. Shown for everyone, so a
            row that has stopped moving looks like every other row rather than
            like a special case. */}
        {standing ? (
          <p className="flex shrink-0 items-baseline gap-3 text-[13px] text-ink-muted">
            <span>
              <span className="numeral text-[15px] text-ink">{standing.roundsPlayed}</span>{' '}
              {t('board.columnPlayed')}
            </span>
            <span>
              <span className="numeral text-[15px] text-ink">{standing.totalPoints}</span>{' '}
              {t('board.columnPoints')}
            </span>
          </p>
        ) : null}
      </div>

      {/* Both ends of a substitution say so, so neither row is a mystery. */}
      {replacesName !== undefined ? (
        <p className="text-[13px] leading-snug text-ink-muted">
          {t('players.replaces', { name: replacesName })}
        </p>
      ) : null}
      {replacedByName !== undefined ? (
        <p className="text-[13px] leading-snug text-ink-muted">
          {t('players.replacedBy', { name: replacedByName })}
        </p>
      ) : null}
      {player.status === 'left' && frozenRound !== null ? (
        <p className="text-[13px] leading-snug text-ink-muted">
          {t('players.statsFrozen', { round: frozenRound + 1 })}
        </p>
      ) : null}

      {/* Wrapping, not a fixed grid: three labels of very different widths must
          never squeeze a tap target below 44px at 380px, and gap-2 keeps a
          thumb from hitting two of them at once. */}
      <div role="group" aria-labelledby={nameId} className="flex flex-wrap gap-2 pt-0.5">
        {player.status === 'active' ? (
          <>
            <Button onClick={() => onAct('pause')}>{t('players.pause')}</Button>
            <Button onClick={() => onAct('leave')}>{t('players.leave')}</Button>
            <Button onClick={() => onAct('substitute')}>{t('players.substitute')}</Button>
          </>
        ) : (
          <Button onClick={() => onAct('resume')}>{t('players.resume')}</Button>
        )}
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */

export function PlayersScreen(): ReactNode {
  const { state, lastError, clearError, registerPlayer, applyEvent } = useTournament();

  const [draft, setDraft] = useState<Draft | null>(null);
  const groupIdBase = useId();
  const addFormId = useId();
  const substituteFormId = useId();

  // A name registered by addPlayer but never dated by a join or a substitute is
  // a mid-flow artifact, not a competitor. The engine keeps them off the board;
  // this screen keeps them off the roster for the same reason.
  const roster = useMemo(
    () => (state ? state.players.filter((p) => p.joinedBeforeRound !== UNENTERED) : []),
    [state],
  );

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const player of state?.players ?? []) map.set(player.id, player.name);
    return map;
  }, [state]);

  const statsById = useMemo(() => {
    const map = new Map<string, Standing>();
    if (state) for (const row of standings(state)) map.set(row.playerId, row);
    return map;
  }, [state]);

  // Where a roster change can legally land. An event at or below a round that
  // already holds a score throws HISTORY_IMMUTABLE, so the target is the round
  // in front of the organizer while it is still clean, and the one after it
  // once it is not. The max() is the belt to that braces.
  const currentIndex = state ? history.currentRoundIndex(state) : 0;
  const currentRound = state ? state.rounds[currentIndex] : undefined;
  const currentLocked = currentRound !== undefined && history.hasAnyScore(currentRound);
  const lastScored = state ? history.lastScoredRoundIndex(state) : -1;
  const targetRound = Math.max(currentLocked ? currentIndex + 1 : currentIndex, lastScored + 1);

  // Americano fixes its round count at creation. Past the end there is nothing
  // left to re-deal, so say so rather than promise a round that never comes.
  const totalRounds = state?.config.rounds;
  const scheduleDone = totalRounds !== undefined && targetRound >= totalRounds;

  const closeDraft = (): void => setDraft(null);

  const act = (playerId: string, kind: RowAction): void => {
    clearError();
    // Written out one literal at a time: RosterEvent is a discriminated union,
    // and a variable discriminant would not narrow to a single member.
    if (kind === 'pause') {
      void applyEvent({ type: 'pause', playerId, beforeRound: targetRound });
      return;
    }
    if (kind === 'leave') {
      void applyEvent({ type: 'leave', playerId, beforeRound: targetRound });
      return;
    }
    if (kind === 'resume') {
      void applyEvent({ type: 'resume', playerId, beforeRound: targetRound });
      return;
    }
    setDraft({ kind: 'substitute', outgoingId: playerId, name: '' });
  };

  /**
   * A newcomer has to exist before an event can name them: applyRosterEvent
   * carries ids and never names. Both calls queue their state updater in order,
   * so the join reads the registration that ran a line earlier.
   *
   * The sheet closes first. If the engine rejects the event anyway, the alert
   * Note at the top of the screen is what reports it, and a sheet left open
   * would be covering it.
   */
  const commitJoin = async (name: string, seed: Seed): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    const id = newId();
    setDraft(null);
    await registerPlayer({ id, name: trimmed });
    await applyEvent({ type: 'join', playerId: id, beforeRound: targetRound, seed });
  };

  const commitSubstitute = async (outgoingId: string, name: string): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    const id = newId();
    setDraft(null);
    await registerPlayer({ id, name: trimmed });
    // No seed on a substitute: they inherit a schedule slot that is already
    // placed, so there is nothing for a pairing hint to guess at.
    await applyEvent({ type: 'substitute', outgoingId, incomingId: id, beforeRound: targetRound });
  };

  if (!state) {
    // Boot, a failed boot, and a tournament discarded elsewhere are all settled
    // by the shell, which sends this route home. This is the frame in between,
    // and it is what makes the null check above honest rather than an assertion.
    return (
      <Screen title={t('players.title')}>
        <Note title={t('common.loading')} />
      </Screen>
    );
  }

  const seedChoices: ReadonlyArray<Choice<Seed>> = [
    { value: 'top', label: t('players.seedTop') },
    { value: 'middle', label: t('players.seedMiddle') },
    { value: 'bottom', label: t('players.seedBottom') },
  ];

  const outgoingName = draft?.kind === 'substitute' ? (nameById.get(draft.outgoingId) ?? '') : '';

  return (
    <Screen
      title={t('players.title')}
      action={
        // In the sticky header, so adding a late arrival is one tap from
        // anywhere in a long roster instead of a scroll back to the top.
        <Button
          onClick={() => {
            clearError();
            setDraft({ kind: 'add', name: '', seed: 'middle' });
          }}
        >
          {t('players.addAction')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {lastError ? (
          <Note
            tone="alert"
            title={errorTitle(lastError.code)}
            action={<Button onClick={clearError}>{t('common.done')}</Button>}
          />
        ) : null}

        {/* The constraint is explained before anybody can walk into it. */}
        {scheduleDone ? (
          <Note title={t('play.scheduleDone')} />
        ) : currentLocked ? (
          <Note
            title={t('players.lockedTitle', { round: currentIndex + 1 })}
            body={t('players.lockedBody')}
          />
        ) : null}

        {roster.length === 0 ? (
          <Note title={t('players.emptyTitle')} body={t('players.emptyBody')} />
        ) : (
          // Full bleed past the page gutter, so the rules between rows run to
          // the edge the way court lines run to the fence. Notes and the header
          // stay on the gutter, which is what separates the two regions.
          <div className="-mx-4 flex flex-col gap-5">
            {GROUPS.map(({ status: groupStatus, heading }) => {
              const members = roster.filter((player) => player.status === groupStatus);
              if (members.length === 0) return null;
              const headingId = `${groupIdBase}-${groupStatus}`;
              return (
                <section key={groupStatus} aria-labelledby={headingId}>
                  <h2
                    id={headingId}
                    className="px-4 pb-1.5 text-[13px] font-semibold text-ink-muted"
                  >
                    {t(heading)}
                  </h2>
                  <Rule />
                  <ul className="flex flex-col">
                    {members.map((player, index) => (
                      <PlayerRow
                        key={player.id}
                        player={player}
                        standing={statsById.get(player.id)}
                        frozenRound={lastPlayedRound(state, player.id)}
                        replacedByName={
                          player.replacedBy === undefined
                            ? undefined
                            : nameById.get(player.replacedBy)
                        }
                        replacesName={
                          player.replaces === undefined ? undefined : nameById.get(player.replaces)
                        }
                        first={index === 0}
                        onAct={(kind) => act(player.id, kind)}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {draft?.kind === 'add' ? (
        <Sheet
          open
          onClose={closeDraft}
          title={t('players.addTitle')}
          footer={
            <Button
              variant="primary"
              full
              type="submit"
              form={addFormId}
              disabled={draft.name.trim() === ''}
            >
              {t('players.addAction')}
            </Button>
          }
        >
          {/* A real form, so the phone keyboard's own confirm key finishes the
              job: open, type, done, with the seed already answered. */}
          <form
            id={addFormId}
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void commitJoin(draft.name, draft.seed);
            }}
          >
            <Field label={t('players.nameLabel')}>
              {({ id }) => (
                <TextInput
                  id={id}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
                  placeholder={t('setup.playerNamePlaceholder')}
                  autoComplete="off"
                  autoCapitalize="words"
                  enterKeyHint="done"
                />
              )}
            </Field>

            <div className="flex flex-col gap-1.5">
              {/* Preselected to middle, so the seed costs no taps unless the
                  organizer disagrees with it. */}
              <ChoiceRow
                legend={t('players.seedLabel')}
                choices={seedChoices}
                value={draft.seed}
                onChange={(seed) => setDraft({ ...draft, seed })}
                columns="stack"
              />
              <p className="text-[13px] leading-snug text-ink-muted">{t('players.seedHint')}</p>
            </div>

            <Rule />
            {/* The one fact that stops a surprise, so it is stated in ink at
                body weight rather than whispered in the footnote size. */}
            <p className="text-[15px] font-semibold leading-snug text-ink">
              {t('players.joinsNextRound', { round: targetRound + 1 })}
            </p>
          </form>
        </Sheet>
      ) : null}

      {draft?.kind === 'substitute' ? (
        <Sheet
          open
          onClose={closeDraft}
          title={t('players.substituteTitle', { name: outgoingName })}
          footer={
            <Button
              variant="primary"
              full
              type="submit"
              form={substituteFormId}
              disabled={draft.name.trim() === ''}
            >
              {t('players.substituteAction')}
            </Button>
          }
        >
          <form
            id={substituteFormId}
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void commitSubstitute(draft.outgoingId, draft.name);
            }}
          >
            {/* States plainly, before anything is typed, that the outgoing
                player keeps their points. This is the sentence the whole
                product is built around. */}
            <p className="text-[15px] leading-snug text-ink">
              {t('players.substituteHint', { name: outgoingName })}
            </p>

            <Field label={t('players.nameLabel')}>
              {({ id }) => (
                <TextInput
                  id={id}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
                  placeholder={t('setup.playerNamePlaceholder')}
                  autoComplete="off"
                  autoCapitalize="words"
                  enterKeyHint="done"
                />
              )}
            </Field>

            <Rule />
            {/* The one fact that stops a surprise, so it is stated in ink at
                body weight rather than whispered in the footnote size. */}
            <p className="text-[15px] font-semibold leading-snug text-ink">
              {t('players.joinsNextRound', { round: targetRound + 1 })}
            </p>
          </form>
        </Sheet>
      ) : null}
    </Screen>
  );
}
