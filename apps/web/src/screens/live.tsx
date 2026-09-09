import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { history, podium, standings } from '@tanteo/engine';
import type { Match, PlayerRecord, PlayerStatus, RankingMetric, Standing } from '@tanteo/engine';
import { isWellFormedToken } from '@tanteo/share';

import { Screen } from '../app.js';
import { Button, Note, Numeral, TAP, cx } from '../components/primitives.js';
import { formatRate, t } from '../i18n/index.js';
import type { StringKey } from '../i18n/index.js';
import { describeAge, isOutOfTouch, useLiveBoard } from '../live-source.js';
import type { LiveStatus } from '../live-source.js';
import { Link } from '../router.js';

/**
 * The read-only board a viewer opens from a share link.
 *
 * Two facts shape this screen. The first: a spectator wants to know who is
 * winning before which court is playing, so the standings come first and the
 * courts sit under them. The second: this board is on someone else's phone,
 * fed by someone else's connection, so it has to keep saying out loud how old
 * it is. A frozen board that still looks live is the only failure here that
 * actually misleads people.
 *
 * Nothing on this screen changes anything. The one control is "try again",
 * which re-reads; every rule and every number comes from the engine.
 */

/**
 * Past this, the board is not news any more and stops claiming to be current.
 * Ninety seconds is short enough to catch a dead link and long enough that a
 * rally does not trip it.
 */

/** The staleness line is only honest if it re-reads the clock on its own. */
const TICK_MS = 1_000;

/**
 * Rounds played is what makes PPR mean anything, but on a 320px phone the two
 * numbers a spectator actually reads are points and the rate, so it is the
 * first column to go.
 */
const RDS_AT_WIDTH = 'hidden min-[380px]:table-cell';
/** Point diff is a tiebreak, not what anyone came to read. */
const DIFF_AT_WIDTH = 'hidden min-[420px]:table-cell';

const NUMERIC_CELL = 'numeral whitespace-nowrap px-1 py-2.5 text-right align-middle';

/** Which of the numeric columns the engine actually sorted on, if any. */
type MetricColumn = 'points' | 'ppr' | null;

const METRIC_LABEL: Record<RankingMetric, StringKey> = {
  ppr: 'setup.metricPpr',
  total: 'setup.metricTotal',
  wins: 'setup.metricWins',
};

const METRIC_COLUMN: Record<RankingMetric, MetricColumn> = {
  ppr: 'ppr',
  total: 'points',
  // Wins has no column here, so nothing takes the emphasis and the caption
  // still says out loud what the board was ranked by.
  wins: null,
};

/**
 * A real anchor wearing the secondary button's skin, so a long press and
 * open-in-new-tab still work. Interactive, so it takes the 3:1 border token.
 */
const LINK_AS_BUTTON = cx(
  TAP,
  'inline-flex items-center justify-center rounded-control border border-line-control',
  'bg-court-800 px-4 py-2.5 text-[15px] font-semibold tracking-tight text-ink no-underline',
);

/** PPR is a rate: "22" beside "22.75" reads as a tie it is not. */
function rate(value: number): string {
  return formatRate(value);
}

/** A diff without a sign is ambiguous, so positives carry theirs. */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/* -------------------------------------------------------------------------- */

/**
 * Wall clock, sampled once a second.
 *
 * Nobody touches a board on a wall, so the age has to move by itself or it
 * quietly turns into a lie. Kept in its own hook so a tick re-renders the
 * staleness line without re-deriving standings.
 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/* -------------------------------------------------------------------------- */

/** A short marker beside a name. The tone never arrives without its word. */
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

function StandingRow({
  rank,
  name,
  status,
  standing,
  leader,
  metricColumn,
}: {
  rank: number;
  name: string;
  status: PlayerStatus;
  standing: Standing;
  leader: boolean;
  metricColumn: MetricColumn;
}): ReactNode {
  // The leader's row is tinted with the accent, which raises the floor under
  // muted text, so every number in that row goes to full ink instead.
  const plain = cx('text-[15px]', leader ? 'text-ink' : 'text-ink-muted');
  const strong = 'text-[18px] text-ink';
  const edge = 'border-b border-b-line-quiet';
  const short = !standing.podiumEligible;
  const marked = leader || short || status !== 'active';

  return (
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
                // max-w-full is load-bearing: as a flex item this span sizes
                // itself to the name, and a name with no break in it is wider
                // than the column, so without the cap it walks over the
                // scores instead of wrapping. Measured at 320px.
                'max-w-full break-words text-[15px] leading-tight',
                leader ? 'font-bold' : 'font-semibold',
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
      <td className={cx(NUMERIC_CELL, edge, plain, RDS_AT_WIDTH)}>{standing.roundsPlayed}</td>
      <td className={cx(NUMERIC_CELL, edge, metricColumn === 'points' ? strong : plain)}>
        {standing.totalPoints}
      </td>
      <td className={cx(NUMERIC_CELL, edge, metricColumn === 'ppr' ? strong : plain)}>
        {rate(standing.ppr)}
      </td>
      <td className={cx(NUMERIC_CELL, edge, plain, DIFF_AT_WIDTH)}>{signed(standing.pointDiff)}</td>
    </tr>
  );
}

/**
 * The board.
 *
 * table-fixed plus break-words on the name is what keeps a long name from
 * pushing the numeric columns off a 320px screen. The widths match the
 * organizer's board on purpose: two people reading the same tournament on two
 * phones should be reading the same shape.
 */
function LiveStandings({
  rows,
  playerById,
  leaderId,
  metric,
}: {
  rows: readonly Standing[];
  playerById: ReadonlyMap<string, PlayerRecord>;
  leaderId: string | undefined;
  metric: RankingMetric;
}): ReactNode {
  const metricColumn = METRIC_COLUMN[metric];
  return (
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
          <NumericHead
            label={t('board.columnPlayed')}
            width="w-10"
            sorted={false}
            extra={RDS_AT_WIDTH}
          />
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
          const player = playerById.get(row.playerId);
          return (
            <StandingRow
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
            />
          );
        })}
      </tbody>
    </table>
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
        // One name per line: wrapping keeps a long name whole at 320px, where
        // truncating would hide the half that tells two players apart.
        <span key={id} className="block break-words text-[15px] font-semibold tracking-tight">
          {playerName(id)}
        </span>
      ))}
    </>
  );
}

/**
 * A court, read exactly as the organizer reads it: a header line, a team, the
 * net, the other team. It is a plain box, not a button, so it carries the
 * decorative line token rather than the interactive one and offers no target
 * a spectator could press expecting something to happen.
 */
function LiveCourt({
  match,
  playerName,
  delayMs,
}: {
  match: Match;
  playerName: (id: string) => string;
  delayMs: number;
}): ReactNode {
  const score =
    match.scoreA !== undefined && match.scoreB !== undefined
      ? { a: match.scoreA, b: match.scoreB }
      : null;

  return (
    <div
      // The round transition, the second of this app's two animations. It
      // replays only when the round index changes, because that is what the
      // key on the list item is keyed to.
      style={{ animationDelay: `${delayMs}ms` }}
      className={cx(
        'animate-court-resort grid grid-cols-[minmax(0,1fr)_auto] gap-x-3',
        'rounded-court border border-line-quiet bg-court-800 px-4 py-3',
      )}
    >
      <span className="col-span-2 row-start-1 flex items-baseline justify-between gap-3 border-b border-line-quiet pb-2 text-[13px] font-semibold text-ink-muted">
        {t('score.heading', { court: match.court })}
        {score === null ? (
          // A real 0 and "nobody entered this" are different facts, so an
          // unscored court never shows a digit.
          <span className="font-normal">{t('play.notScored')}</span>
        ) : null}
      </span>

      <span className="col-start-1 row-start-2 min-w-0 py-2.5 text-ink">
        <TeamNames ids={match.teamA} playerName={playerName} />
      </span>
      {score === null ? null : (
        <span className="numeral col-start-2 row-start-2 self-center text-[38px] leading-none text-ink">
          <Numeral value={score.a} />
        </span>
      )}

      {/* The net. */}
      <span className="col-span-2 row-start-3 block h-px bg-line-quiet" role="presentation" />

      <span className="col-start-1 row-start-4 min-w-0 py-2.5 text-ink">
        <TeamNames ids={match.teamB} playerName={playerName} />
      </span>
      {score === null ? null : (
        <span className="numeral col-start-2 row-start-4 self-center text-[38px] leading-none text-ink">
          <Numeral value={score.b} />
        </span>
      )}
    </div>
  );
}

/**
 * Who is off this round. Rendered only when somebody is, because a spectator
 * has no decision to make here: the list exists to answer "where is Ana", and
 * when nobody sits out the courts have already answered it.
 */
function SitOuts({
  ids,
  playerName,
}: {
  ids: readonly string[];
  playerName: (id: string) => string;
}): ReactNode {
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

export function LiveScreen({ token, cast }: { token: string; cast: boolean }): ReactNode {
  const { status, state, receivedAt, contactAt, retry } = useLiveBoard(token);
  const now = useNow();

  const rows = useMemo<Standing[]>(() => (state ? standings(state) : []), [state]);
  // podium() is the engine's own answer to "is there a leader yet": empty
  // until something is scored, and it steps over anyone short of rounds, so
  // the accent never lands on a player who cannot take a podium place.
  const crowned = useMemo<Standing[]>(() => (state ? podium(state) : []), [state]);

  const playerById = useMemo(() => {
    const map = new Map<string, PlayerRecord>();
    for (const player of state?.players ?? []) map.set(player.id, player);
    return map;
  }, [state]);

  // Falls back to the id, which is ugly on purpose: a court holding somebody
  // who is not on the roster is a bug worth seeing, not one worth hiding.
  const playerName = (id: string): string => playerById.get(id)?.name ?? id;

  // A typo in a pasted link should say the link is wrong, not that the server
  // said something strange. The shape check is local and costs one regex.
  const wellFormed = isWellFormedToken(token);
  const shown: LiveStatus = wellFormed ? status : 'missing';

  const age = describeAge(receivedAt, now);
  // Keyed on contact, not on the last score: a padel game runs minutes
  // between points, so scoring silence is normal and only a silent
  // connection is a problem.
  const stale = isOutOfTouch(contactAt, now);
  const connected = shown === 'live' || shown === 'polling';
  // A board that has not moved in ninety seconds does not also get to carry a
  // word saying it is current. Silence beats a claim we cannot back.
  const connectionWord =
    connected && !stale
      ? shown === 'live'
        ? t('live.connectionLive')
        : t('live.connectionPolling')
      : null;

  const retryAction = <Button onClick={retry}>{t('common.retry')}</Button>;

  let statusNote: ReactNode = null;
  switch (shown) {
    case 'loading':
      statusNote = <Note title={t('live.loading')} />;
      break;
    case 'missing':
      statusNote = (
        <Note
          tone="alert"
          title={t('live.missingTitle')}
          body={t('live.missingBody')}
          // Re-reading a malformed link cannot help, so nothing offers to.
          action={wellFormed ? retryAction : null}
        />
      );
      break;
    case 'offline':
      statusNote = (
        <Note
          tone="alert"
          title={t('live.offlineTitle')}
          // The body promises a board underneath, so it is only told when
          // there is one. exactOptionalPropertyTypes: omit, never undefined.
          {...(state ? { body: t('live.offlineBody') } : {})}
          action={retryAction}
        />
      );
      break;
    case 'error':
      statusNote = (
        <Note
          tone="alert"
          title={t('live.errorTitle')}
          body={t('live.errorBody')}
          action={retryAction}
        />
      );
      break;
    default:
      // Connected. The only thing that can be wrong now is silence, and an
      // unreachable board already explains its own silence.
      statusNote = stale ? <Note tone="alert" title={t('live.stalled')} /> : null;
      break;
  }

  // A stale board beats a blank one at a venue, so whatever last arrived stays
  // on screen underneath whichever note is explaining the connection.
  const board = ((): ReactNode => {
    if (!state) return null;

    const cursor = history.currentRoundIndex(state);
    const everyRoundComplete = cursor >= state.rounds.length;
    const shownIndex = everyRoundComplete ? state.rounds.length - 1 : cursor;
    const round = state.rounds[shownIndex];
    const courts = round?.matches ?? [];
    const sitOuts = round?.sitOuts ?? [];
    const totalRounds = state.config.rounds;
    // Mexicano deals one round at a time, so "all complete" only means the
    // organizer has not drawn the next one. Americano really is finished.
    const finished = everyRoundComplete && state.config.format !== 'mexicano';

    return (
      <>
        {crowned.length === 0 ? (
          <Note title={t('live.waiting')} />
        ) : (
          <LiveStandings
            rows={rows}
            playerById={playerById}
            leaderId={crowned[0]?.playerId}
            metric={state.config.rankingMetric}
          />
        )}

        <section className="flex flex-col gap-3 border-t border-line-quiet pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-[13px] font-semibold text-ink-muted">{t('live.currentRound')}</h2>
            {round ? (
              <p className="flex items-baseline gap-1 text-[13px] text-ink-muted">
                {/* The engine counts rounds from zero; the 1-based number is
                    produced here, at the boundary, and nowhere deeper. */}
                <span>{t('play.roundHeading', { current: shownIndex + 1 })}</span>
                {totalRounds === undefined ? null : (
                  <span>{t('play.roundOf', { total: totalRounds })}</span>
                )}
              </p>
            ) : null}
          </div>

          {courts.length === 0 ? (
            <Note title={t('play.emptyTitle')} />
          ) : (
            <ul className="flex flex-col gap-3">
              {courts.map((match, index) => (
                // The round index is in the key so the cards remount, and
                // replay the round transition, only when the round changes.
                <li key={`${shownIndex}:${match.court}`}>
                  <LiveCourt match={match} playerName={playerName} delayMs={index * 40} />
                </li>
              ))}
            </ul>
          )}

          {sitOuts.length === 0 ? null : <SitOuts ids={sitOuts} playerName={playerName} />}
          {finished ? <Note title={t('play.scheduleDone')} /> : null}
        </section>
      </>
    );
  })();

  // The tournament's own name is what a link in a group chat should open with;
  // "Live board" then rides in the corner so the screen still says what it is.
  const name = state?.config.name.trim() ?? '';
  const heading = name === '' ? t('live.title') : name;
  const corner =
    name === '' ? null : <p className="text-[13px] text-ink-muted">{t('live.title')}</p>;

  return (
    <Screen title={heading} {...(corner === null ? {} : { action: corner })}>
      <div className="flex flex-col gap-5">
        {statusNote}

        {age === null ? null : (
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] text-ink-muted">
            <span>{t('live.updated', { age })}</span>
            {connectionWord === null ? null : (
              <span className="font-semibold text-ink">{connectionWord}</span>
            )}
          </p>
        )}

        {board}

        {/* The cast layout is its own screen, so this only offers the trip out.
            On the cast route there is nothing to offer: you are already there,
            and a link built out of a broken token would only break again. */}
        {cast || !wellFormed ? null : (
          <div className="flex flex-col items-start gap-2 border-t border-line-quiet pt-5">
            <Link to={`/t/${encodeURIComponent(token)}/cast`} className={LINK_AS_BUTTON}>
              {t('live.castView')}
            </Link>
            <p className="text-[13px] leading-snug text-ink-muted">{t('live.castHint')}</p>
          </div>
        )}
      </div>
    </Screen>
  );
}
