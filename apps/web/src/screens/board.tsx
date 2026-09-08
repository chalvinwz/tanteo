import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { podium, standings } from '@tanteo/engine';
import type { PlayerRecord, PlayerStatus, RankingMetric, Standing } from '@tanteo/engine';

import { Button, Note, Rule, cx } from '../components/primitives.js';
import { t } from '../i18n/index.js';
import type { StringKey } from '../i18n/index.js';
import { Link } from '../router.js';
import { useTournament } from '../state.js';
import type { ActionError } from '../state.js';

/**
 * The leaderboard.
 *
 * ENERGY 3 in DESIGN.md terms: this is the screen a group crowds around
 * between rounds, so the numerals are large and every column is tabular, and
 * the single optic accent allowed on this screen goes to whoever is leading.
 *
 * Nothing here knows how to rank anyone. `standings()` produces the order and
 * every metric in it; this file only decides what a phone can show at 380px.
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
  // Wins has no column in this table, so nothing gets the emphasis; the
  // caption still says out loud what the board was ranked by.
  wins: null,
};

/**
 * Point diff is the least load-bearing of the four numbers — it is a tiebreak,
 * not the thing anyone came to read — so it is the column that goes when the
 * phone is narrow. The board never scrolls sideways; a leaderboard is for
 * glancing at.
 */
const DIFF_AT_WIDTH = 'hidden min-[420px]:table-cell';

const NUMERIC_CELL = 'numeral whitespace-nowrap px-1 py-2.5 text-right align-middle';

/** PPR is a rate: "22" beside "22.75" reads as a tie it is not. */
function rate(value: number): string {
  return value.toFixed(2);
}

/** A diff without a sign is ambiguous, so positives carry theirs. */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * An engine code said in the organizer's language. A code with no entry gets a
 * title and no body, which is better than showing raw engine English.
 */
function errorBody(error: ActionError, pointsPerMatch: number | undefined): string | undefined {
  switch (error.code) {
    case 'INVALID_SCORE':
      return pointsPerMatch === undefined
        ? undefined
        : t('errors.scoreInvalid', { total: pointsPerMatch });
    case 'HISTORY_IMMUTABLE':
      return t('errors.historyLocked');
    case 'UNKNOWN_PLAYER':
      return t('errors.unknownPlayer');
    case 'DUPLICATE_PLAYER':
      return t('errors.duplicatePlayer');
    default:
      return undefined;
  }
}

/** `body` is optional on Note, so a missing one is an omitted key, not undefined. */
function bodyProp(body: string | undefined): { body?: string } {
  return body === undefined ? {} : { body };
}

/* -------------------------------------------------------------------------- */

/**
 * A short state marker beside a name. State is never signalled by colour here:
 * the accent tone always arrives with the word that explains it.
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
      // The board is sorted, so say so rather than leaving it to the eye.
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

  // A short-of-rounds player gets a second row carrying the explanation, and
  // that row takes the hairline so the pair reads as one entry.
  const edge = short ? '' : 'border-b border-line-quiet';

  // The leader's row is tinted with the accent, which lifts the floor under
  // muted text, so every number in that row goes to full ink instead.
  const plain = cx('text-[15px]', leader ? 'text-ink' : 'text-ink-muted');
  const strong = 'text-[18px] text-ink';
  const marked = status !== 'active' || short || leader;

  return (
    <>
      <tr className={leader ? 'bg-optic/10' : ''}>
        <th
          scope="row"
          className={cx(
            'py-2.5 pl-2 pr-1 text-left align-middle font-normal',
            edge,
            // Every row reserves the marker border, so crowning the leader
            // never shifts the column by two pixels.
            leader ? 'border-l-2 border-optic' : 'border-l-2 border-transparent',
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
                  // Someone who left keeps a legible row: ink-muted is 8.18:1
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
          {/* Five columns at full width, four when the diff column is dropped;
              browsers clamp a colspan to the columns that exist. */}
          <td
            colSpan={5}
            className="border-b border-line-quiet pb-3 pl-11 pr-1 text-[13px] leading-snug text-ink-muted"
          >
            {t('board.notEnoughRoundsHint', {
              needed: neededForPodium,
              played: standing.roundsPlayed,
            })}
          </td>
        </tr>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/** One frame for every state of this screen, so the title never jumps. */
function Frame({ children }: { children: ReactNode }): ReactNode {
  return (
    <section className="mx-auto w-full max-w-md px-4 pb-8 pt-4">
      <h1 className="text-[24px] font-bold tracking-tight text-ink">{t('board.title')}</h1>
      <Rule className="mt-3" />
      <div className="pt-4">{children}</div>
    </section>
  );
}

export function BoardScreen(): ReactNode {
  const { status, storageBlocked, state, lastError, clearError, reload } = useTournament();

  const rows = useMemo<Standing[]>(() => (state ? standings(state) : []), [state]);

  // podium() is the engine's own answer to "is there a leader yet": it is empty
  // until something is scored, and it steps over anyone short of rounds, so the
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

  const retry = (
    <Button
      onClick={() => {
        clearError();
        void reload();
      }}
    >
      {t('common.retry')}
    </Button>
  );

  if (storageBlocked) {
    return (
      <Frame>
        <Note
          tone="alert"
          title={t('errors.storageTitle')}
          body={t('errors.storageBody')}
          action={retry}
        />
      </Frame>
    );
  }

  if (status === 'loading') {
    return (
      <Frame>
        <Note title={t('common.loading')} />
      </Frame>
    );
  }

  if (status === 'error') {
    return (
      <Frame>
        <Note
          tone="alert"
          title={t('errors.genericTitle')}
          {...bodyProp(lastError ? errorBody(lastError, state?.config.pointsPerMatch) : undefined)}
          action={retry}
        />
      </Frame>
    );
  }

  if (!state) {
    return (
      <Frame>
        <Note
          title={t('home.emptyTitle')}
          body={t('home.emptyBody')}
          action={
            // A real anchor, so this behaves for a keyboard and a long press;
            // the styling matches the secondary button it sits in place of.
            <Link
              to="/setup"
              className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-control bg-court-800 px-4 py-2.5 text-[15px] font-semibold tracking-tight text-ink no-underline"
            >
              {t('home.newTournament')}
            </Link>
          }
        />
      </Frame>
    );
  }

  const metric = state.config.rankingMetric;
  const metricColumn = METRIC_COLUMN[metric];
  const leaderId = crowned[0]?.playerId;

  // An empty podium means nothing has been scored, which is the one thing that
  // separates "no board yet" from "a board where everyone is on zero".
  if (crowned.length === 0) {
    return (
      <Frame>
        <Note title={t('board.emptyTitle')} body={t('board.emptyBody')} />
      </Frame>
    );
  }

  return (
    <Frame>
      {lastError ? (
        <div className="pb-4">
          <Note
            tone="alert"
            title={t('errors.genericTitle')}
            {...bodyProp(errorBody(lastError, state.config.pointsPerMatch))}
            action={retry}
          />
        </div>
      ) : null}

      {/* table-fixed plus break-words on the name is what keeps a long name
          from pushing the numeric columns off a 380px screen. */}
      <table className="w-full table-fixed">
        <caption className="pb-3 text-left text-[13px] text-ink-muted">
          {t('board.rankedBy', { metric: t(METRIC_LABEL[metric]) })}
        </caption>
        <thead>
          <tr className="border-b border-line">
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
                // A standing is built from the roster, so the fallback only
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
    </Frame>
  );
}
