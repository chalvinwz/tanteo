import { useId, useState } from 'react';
import type { ReactNode } from 'react';

import { history } from '@tanteo/engine';
import type { Format, Player, RankingMetric, TournamentConfigInput } from '@tanteo/engine';

import { Screen } from '../app.js';
import { Button, ChoiceRow, Field, Note, Rule, Stepper, TextInput } from '../components/primitives.js';
import type { Choice } from '../components/primitives.js';
import { newId } from '../db.js';
import { t } from '../i18n/index.js';
import { useNavigate } from '../router.js';
import { useTournament } from '../state.js';

/**
 * Setting up an evening.
 *
 * ENERGY 1. Hairline rules divide the three regions (how the tournament is
 * played, who is playing, and the one button that starts it), and nothing on
 * the way through carries the optic accent except that final button.
 *
 * Blocked storage and the boot states are the shell's to answer; by the time
 * this screen mounts they are settled, so the only failure left to show is a
 * create() that the engine refused.
 */

/** The engine's own floor, repeated here so the form can explain it. */
const MIN_PLAYERS = 4;

/** Points move in twos: an even fixed total is what makes a level match reachable. */
const POINTS_STEP = 2;

function formatHint(format: Format): string {
  return format === 'americano' ? t('setup.americanoHint') : t('setup.mexicanoHint');
}

function metricHint(metric: RankingMetric): string {
  switch (metric) {
    case 'ppr':
      return t('setup.metricPprHint');
    case 'total':
      return t('setup.metricTotalHint');
    case 'wins':
      return t('setup.metricWinsHint');
  }
}

function PlayerRow({
  idBase,
  index,
  player,
  onRemove,
}: {
  idBase: string;
  index: number;
  player: Player;
  onRemove: () => void;
}): ReactNode {
  const nameId = `${idBase}-name-${player.id}`;
  const removeId = `${idBase}-remove-${player.id}`;
  return (
    <li className="flex items-center gap-3 border-b border-line-quiet py-1.5 pl-3 last:border-b-0">
      {/* Tabular figures so the roster reads as a column, not a ragged list. */}
      <span className="numeral w-6 shrink-0 text-right text-[13px] text-ink-muted">{index + 1}</span>
      <span id={nameId} className="min-w-0 flex-1 break-words text-[15px] text-ink">
        {player.name}
      </span>
      <Button
        variant="quiet"
        id={removeId}
        // "Remove, <name>", composed from two nodes already on screen, so a
        // keyboard user hears which row they are on without a second string.
        aria-labelledby={`${removeId} ${nameId}`}
        onClick={onRemove}
      >
        {t('common.remove')}
      </Button>
    </li>
  );
}

export function SetupScreen(): ReactNode {
  const { lastError, create } = useTournament();
  const navigate = useNavigate();
  const listBase = useId();

  const [name, setName] = useState('');
  const [format, setFormat] = useState<Format>('americano');
  const [courts, setCourts] = useState(1);
  const [pointsPerMatch, setPointsPerMatch] = useState(24);
  const [metric, setMetric] = useState<RankingMetric>('ppr');
  const [players, setPlayers] = useState<Player[]>([]);
  const [draft, setDraft] = useState('');
  const [duplicate, setDuplicate] = useState<string | null>(null);
  // Only a failure from *this* form should show here; lastError outlives the
  // screen that set it, and a stale scoring error under the start button would
  // be read as a reason the tournament cannot start.
  const [attempted, setAttempted] = useState(false);
  const [starting, setStarting] = useState(false);

  const formats: ReadonlyArray<Choice<Format>> = [
    { value: 'americano', label: t('setup.americano') },
    { value: 'mexicano', label: t('setup.mexicano') },
  ];
  const metrics: ReadonlyArray<Choice<RankingMetric>> = [
    { value: 'ppr', label: t('setup.metricPpr') },
    { value: 'total', label: t('setup.metricTotal') },
    { value: 'wins', label: t('setup.metricWins') },
  ];

  const addDraft = (): void => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    // Case-insensitive: "sara" and "Sara" are one person to everyone reading
    // the board, and a silently dropped name is worse than a rejected one.
    const clash = players.some((player) => player.name.toLowerCase() === trimmed.toLowerCase());
    if (clash) {
      setDuplicate(trimmed);
      return;
    }
    setDuplicate(null);
    setPlayers((current) => [...current, { id: newId(), name: trimmed }]);
    setDraft('');
  };

  const removePlayer = (id: string): void => {
    setPlayers((current) => current.filter((player) => player.id !== id));
  };

  const canStart = players.length >= MIN_PLAYERS;
  const playing = history.playingCount(players.length, courts);
  const sittingOut = players.length - playing;

  const start = async (): Promise<void> => {
    if (!canStart || starting) return;
    setAttempted(true);
    setStarting(true);
    const config: TournamentConfigInput = {
      name: name.trim(),
      format,
      courts,
      pointsPerMatch,
      rankingMetric: metric,
      // The engine has no clock and no Math.random, so the caller owns the
      // seed. A fresh one per tournament stops the same roster drawing the
      // same round 1 every week; it is stored, so a replay still matches.
      seed: newId(),
    };
    const id = await create(config, players);
    setStarting(false);
    if (id !== null) navigate('/play');
  };

  return (
    <Screen title={t('setup.title')}>
      <div className="flex flex-col gap-5">
        <Field label={t('setup.nameLabel')}>
          {({ id }) => (
            <TextInput
              id={id}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('setup.namePlaceholder')}
              autoComplete="off"
            />
          )}
        </Field>

        <div className="flex flex-col gap-1.5">
          <ChoiceRow
            legend={t('setup.formatLabel')}
            choices={formats}
            value={format}
            onChange={setFormat}
          />
          {/* Announced on change: the hint is the whole reason to pick one. */}
          <p aria-live="polite" className="text-[13px] leading-snug text-ink-muted">
            {formatHint(format)}
          </p>
        </div>

        <Stepper
          label={t('setup.courtsLabel')}
          value={courts}
          min={1}
          max={8}
          onChange={setCourts}
        />

        <div className="flex flex-col gap-1.5">
          <Stepper
            label={t('setup.pointsLabel')}
            value={pointsPerMatch}
            min={8}
            max={48}
            step={POINTS_STEP}
            onChange={setPointsPerMatch}
          />
          <p className="text-[13px] leading-snug text-ink-muted">{t('setup.pointsHint')}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <ChoiceRow
            legend={t('setup.metricLabel')}
            choices={metrics}
            value={metric}
            onChange={setMetric}
            columns="stack"
          />
          <p aria-live="polite" className="text-[13px] leading-snug text-ink-muted">
            {metricHint(metric)}
          </p>
        </div>

        <Rule />

        <div className="flex flex-col gap-3">
          <Field label={t('setup.playersLabel')}>
            {({ id }) => (
              <div className="flex items-start gap-2">
                <TextInput
                  id={id}
                  className="min-w-0 flex-1"
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setDuplicate(null);
                  }}
                  onKeyDown={(event) => {
                    // A dozen names go in one after another. Reaching for Add
                    // between every one of them is the slow way to do it.
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    addDraft();
                  }}
                  placeholder={t('setup.playerNamePlaceholder')}
                  autoComplete="off"
                  autoCapitalize="words"
                  enterKeyHint="done"
                />
                <Button className="shrink-0" disabled={draft.trim().length === 0} onClick={addDraft}>
                  {t('setup.addPlayer')}
                </Button>
              </div>
            )}
          </Field>

          {duplicate === null ? null : (
            <Note tone="alert" title={t('setup.duplicateName', { name: duplicate })} />
          )}

          {players.length === 0 ? null : (
            <ul className="rounded-court border border-line-quiet bg-court-800">
              {players.map((player, index) => (
                <PlayerRow
                  key={player.id}
                  idBase={listBase}
                  index={index}
                  player={player}
                  onRemove={() => removePlayer(player.id)}
                />
              ))}
            </ul>
          )}

          {/* The shape of the draw, so nobody discovers they are short a court
              only once the first round is on the wall. */}
          {canStart ? (
            <p aria-live="polite" className="text-[13px] leading-snug text-ink-muted">
              {sittingOut === 0
                ? t('setup.playersEvenFit')
                : t('setup.playersOnCourt', { playing, sitting: sittingOut })}
            </p>
          ) : null}
        </div>

        <Rule />

        <div className="flex flex-col gap-3">
          {attempted && lastError ? (
            <Note tone="alert" title={t('errors.genericTitle')} body={lastError.message} />
          ) : null}
          {/* The blocked button says nothing on its own, so the reason sits
              above it in plain text rather than in a tooltip nobody opens. */}
          {canStart ? null : (
            <p className="text-[13px] leading-snug text-ink-muted">
              {t('setup.needFourPlayers', { count: MIN_PLAYERS - players.length })}
            </p>
          )}
          <Button
            variant="primary"
            full
            disabled={!canStart || starting}
            onClick={() => void start()}
          >
            {t('setup.start')}
          </Button>
        </div>
      </div>
    </Screen>
  );
}
