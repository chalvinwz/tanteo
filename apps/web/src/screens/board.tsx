import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { podium, standings } from '@tanteo/engine';
import type { PlayerRecord, PlayerStatus, RankingMetric, Standing } from '@tanteo/engine';

import { Screen } from '../app.js';
import { ShareSheet } from '../components/share-sheet.js';
import { Button, Note, cx } from '../components/primitives.js';
import { formatRate, t } from '../i18n/index.js';
import type { StringKey } from '../i18n/index.js';
import { Link } from '../router.js';
import { useTournament } from '../state.js';

/**
 * The leaderboard.
 *
 * ENERGY 3 in DESIGN.md terms: the screen a group crowds around between
 * rounds. So the numerals are large, every column is tabular so the digits
 * line up down the page, and the one optic accent this screen is allowed goes
 * to whoever is leading.
 *
 * Nothing here knows how to rank anyone. `standings()` produces the order and
 * every number in it; this file only decides what a phone can show at 380px.
 */

/** Which of the four numeric columns the engine actually sorted on, if any. */
type MetricColumn = 'points' | 'ppr' | null;

const METRIC_LABEL: Record<RankingMetric, StringKey> = {
  ppr: 'setup.metricPpr',
  total: 'setup.metricTotal',
  wins: 'setup.metricWins',
};

const METRIC_COLUMN: Record<RankingMetric, MetricColumn> = {
  ppr: 'ppr',
  total: 'points',
  // Wins has no column in this table, so nothing takes the emphasis; the
  // caption still says out loud what the board was ranked by.
  wins: null,
};

/**
 * Point diff is the least load-bearing of the four numbers: it is a tiebreak,
 * not what anyone came to read, so it is the column that goes when the phone
 * is narrow. The board never scrolls sideways; a leaderboard is for glancing at.
 */
const DIFF_AT_WIDTH = 'hidden min-[420px]:table-cell';

const NUMERIC_CELL = 'numeral whitespace-nowrap px-1 py-2.5 text-right align-middle';

/** PPR is a rate: "22" beside "22.75" reads as a tie it is not. */
function rate(value: number): string {
  return formatRate(value);
}

/** A diff without a sign is ambiguous, so positives carry theirs. */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** An engine code said in the organizer's language, never raw engine English. */
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

/* -------------------------------------------------------------------------- */

/**
 * A short marker beside a name. State is never signalled by colour here: the
 * accent tone always arrives carrying the word that explains it.
 */
function Badge({ tone, children }: { tone: 'accent' | 'quiet'; children: ReactNode }): ReactNode {
  return (
    <span
      className={cx(
        'rounded-court border px-1.5 py-0.5 text-[12px] font-semibold',
        tone === 'accent' ? 'border-optic text-optic' : 'border-line text-ink-muted',
      )}
    >
      {children}
    </span>
  );
}

function NumericHead({
  label,
  width,
  sorted,
  extra,
}: {
  label: string;
  width: string;
  sorted: boolean;
  extra: string;
}): ReactNode {
  return (
    <th
      scope="col"
      // The board arrives sorted, so it says which column did it rather than
      // leaving a screen reader to infer the order from the numbers.
      aria-sort={sorted ? 'descending' : undefined}
      className={cx(
        'px-1 pb-2 text-right text-[12px] font-semibold',
        width,
        extra,
        sorted ? 'text-ink' : 'text-ink-muted',
      )}
    >
      {label}
    </th>
  );
}

/* -------------------------------------------------------------------------- */

interface BoardRowProps {
  rank: number;
  name: string;
  status: PlayerStatus;
  standing: Standing;
  leader: boolean;
  metricColumn: MetricColumn;
  neededForPodium: number;
}

function BoardRow({
  rank,
  name,
  status,
  standing,
  leader,
  metricColumn,
  neededForPodium,
}: BoardRowProps): ReactNode {
  const short = !standing.podiumEligible;

  // Someone short of rounds gets a second row carrying the explanation, and
  // that row takes the hairline so the pair reads as one entry. The colour is
  // bound to the bottom side on purpose: a bare `border-line-quiet` sets all
  // four, and the leader marker on the left of the same cell would then
  // repaint this hairline optic yellow.
  const edge = short ? '' : 'border-b border-b-line-quiet';

  // The leader's row is tinted with the accent, which raises the floor under
  // muted text, so every number in that row goes to full ink instead.
  const plain = cx('text-[15px]', leader ? 'text-ink' : 'text-ink-muted');
  const strong = 'text-[18px] text-ink';
  const marked = leader || short || status !== 'active';

  return (
    <>
      <tr className={leader ? 'bg-optic/10' : ''}>
        <th
          scope="row"
          className={cx(
            'py-2.5 pl-2 pr-1 text-left align-middle font-normal',
            edge,
            // Every row reserves the marker, so crowning a leader never shifts
            // the column sideways by two pixels.
            leader ? 'border-l-2 border-l-optic' : 'border-l-2 border-l-transparent',
          )}
        >
          <span className="flex items-baseline gap-2">
            <span
              className={cx(
                'numeral w-7 shrink-0 text-right text-[15px]',
                leader ? 'text-optic' : 'text-ink',
              )}
            >
              {rank}
            </span>
            <span className="flex min-w-0 flex-col items-start gap-1">
              <span
                className={cx(
                  'break-words text-[15px] leading-tight',
                  leader ? 'font-bold' : 'font-semibold',
                  // Someone who left keeps a legible row. ink-muted is 8.18:1
                  // on this ground, and that is the floor, not a starting point.
                  status === 'left' && !leader ? 'text-ink-muted' : 'text-ink',
                )}
              >
                {name}
              </span>
              {marked ? (
                <span className="flex flex-wrap gap-1">
                  {leader ? <Badge tone="accent">{t('board.leader')}</Badge> : null}
                  {short ? <Badge tone="quiet">{t('board.notEnoughRounds')}</Badge> : null}
                  {status === 'left' ? <Badge tone="quiet">{t('players.left')}</Badge> : null}
                  {status === 'paused' ? <Badge tone="quiet">{t('players.paused')}</Badge> : null}
                </span>
              ) : null}
            </span>
          </span>
        </th>
        <td className={cx(NUMERIC_CELL, edge, plain)}>{standing.roundsPlayed}</td>
        <td className={cx(NUMERIC_CELL, edge, metricColumn === 'points' ? strong : plain)}>
          {standing.totalPoints}
        </td>
        <td className={cx(NUMERIC_CELL, edge, metricColumn === 'ppr' ? strong : plain)}>
          {rate(standing.ppr)}
        </td>
        <td className={cx(NUMERIC_CELL, edge, plain, DIFF_AT_WIDTH)}>
          {signed(standing.pointDiff)}
        </td>
      </tr>
      {short ? (
        <tr>
          {/* Four, not five: a colspan is counted from the DOM, so spanning a
              column that is display:none at this width would keep it alive as
              an empty 96px strip and squeeze the names. The diff column gets
              its own cell instead, which appears exactly when the column does. */}
          <td
            colSpan={4}
            className="border-b border-b-line-quiet pb-3 pl-11 pr-1 text-[13px] leading-snug text-ink-muted"
          >
            {t('board.notEnoughRoundsHint', {
              needed: neededForPodium,
              played: standing.roundsPlayed,
            })}
          </td>
          <td className={cx('border-b border-b-line-quiet', DIFF_AT_WIDTH)} />
        </tr>
      ) : null}
    </>
  );
}


export function BoardScreen(): ReactNode {
  const { status, storageBlocked, state, lastError, clearError, reload } = useTournament();
  const [sharing, setSharing] = useState(false);

  const rows = useMemo<Standing[]>(() => (state ? standings(state) : []), [state]);

  // podium() is the engine's own answer to "is there a leader yet": empty until
  // something is scored, and it steps over anyone short of rounds, so the
  // accent never lands on a player who cannot take a podium place.
  const crowned = useMemo<Standing[]>(() => (state ? podium(state) : []), [state]);

  const byId = useMemo(() => {
    const map = new Map<string, PlayerRecord>();
    for (const player of state?.players ?? []) map.set(player.id, player);
    return map;
  }, [state]);

  const neededForPodium = useMemo(() => {
    if (!state) return 0;
    // The engine decides eligibility; this repeats the arithmetic only to name
    // the number in the hint, never to re-rank or re-qualify anyone.
    const most = rows.reduce((max, row) => (row.roundsPlayed > max ? row.roundsPlayed : max), 0);
    return Math.ceil(state.config.podiumMinRoundsPct * most);
  }, [rows, state]);

  if (storageBlocked) {
    return (
      <Screen title={t('board.title')}>
        <Note tone="alert" title={t('errors.storageTitle')} body={t('errors.storageBody')} />
      </Screen>
    );
  }

  if (status === 'loading') {
    return (
      <Screen title={t('board.title')}>
        <Note title={t('common.loading')} />
      </Screen>
    );
  }

  if (status === 'error') {
    return (
      <Screen title={t('board.title')}>
        <Note
          tone="alert"
          title={lastError ? errorTitle(lastError.code) : t('errors.genericTitle')}
          action={<Button onClick={() => void reload()}>{t('common.retry')}</Button>}
        />
      </Screen>
    );
  }

  if (!state) {
    return (
      <Screen title={t('board.title')}>
        <Note
          title={t('home.emptyTitle')}
          body={t('home.emptyBody')}
          action={
            // A real anchor, so Enter and a long press both behave; the classes
            // are the secondary button it stands in for.
            <Link
              to="/setup"
              className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-control bg-court-800 px-4 py-2.5 text-[15px] font-semibold tracking-tight text-ink no-underline"
            >
              {t('home.newTournament')}
            </Link>
          }
        />
      </Screen>
    );
  }

  const metric = state.config.rankingMetric;
  const metricColumn = METRIC_COLUMN[metric];
  const leaderId = crowned[0]?.playerId;
  // An empty podium is the engine saying nothing has been scored, which is what
  // separates "no board yet" from "a board where everyone sits on zero".
  const nothingScored = crowned.length === 0;

  return (
    <Screen
      title={t('board.title')}
      action={
        <Button variant="quiet" onClick={() => setSharing(true)}>
          {t('share.open')}
        </Button>
      }
    >
      {lastError ? (
        <Note
          tone="alert"
          title={errorTitle(lastError.code)}
          action={<Button onClick={clearError}>{t('common.done')}</Button>}
        />
      ) : null}

      {nothingScored ? (
        <Note title={t('board.emptyTitle')} body={t('board.emptyBody')} />
      ) : (
        // table-fixed plus break-words on the name is what keeps a long name
        // from pushing the numeric columns off a 380px screen.
        <table className="w-full table-fixed">
          <caption className="pb-3 text-left text-[13px] text-ink-muted">
            {t('board.rankedBy', { metric: t(METRIC_LABEL[metric]) })}
          </caption>
          <thead>
            <tr className="border-b border-b-line">
              <th
                scope="col"
                className="pb-2 pl-2 pr-1 text-left text-[12px] font-semibold text-ink-muted"
              >
                {t('board.columnPlayer')}
              </th>
              <NumericHead label={t('board.columnPlayed')} width="w-10" sorted={false} extra="" />
              <NumericHead
                label={t('board.columnPoints')}
                width="w-12"
                sorted={metricColumn === 'points'}
                extra=""
              />
              <NumericHead
                label={t('board.columnPpr')}
                width="w-16"
                sorted={metricColumn === 'ppr'}
                extra=""
              />
              <NumericHead
                label={t('board.columnDiff')}
                width="w-14"
                sorted={false}
                extra={DIFF_AT_WIDTH}
              />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const player = byId.get(row.playerId);
              return (
                <BoardRow
                  key={row.playerId}
                  rank={index + 1}
                  // A standing is built from the roster, so this fallback only
                  // fires on a corrupt snapshot: show the id rather than drop
                  // someone's points off the board.
                  name={player?.name ?? row.playerId}
                  status={player?.status ?? 'active'}
                  standing={row}
                  leader={row.playerId === leaderId}
                  metricColumn={metricColumn}
                  neededForPodium={neededForPodium}
                />
              );
            })}
          </tbody>
        </table>
      )}
      <ShareSheet open={sharing} onClose={() => setSharing(false)} />
    </Screen>
  );
}
