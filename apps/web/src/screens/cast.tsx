import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { history, podium, standings } from '@tanteo/engine';
import type { Match, PlayerRecord, RankingMetric, Standing, TournamentState } from '@tanteo/engine';
import { isWellFormedToken } from '@tanteo/share';

import { Numeral, Rule, cx } from '../components/primitives.js';
import { formatRate, t } from '../i18n/index.js';
import type { StringKey } from '../i18n/index.js';
import { describeAge, isOutOfTouch, useLiveBoard } from '../live-source.js';
import type { LiveStatus } from '../live-source.js';
import { Link } from '../router.js';

/**
 * The cast view.
 *
 * A tablet or a TV propped up at the venue and read from across a court. It is
 * the same data as the phone view and none of the same assumptions: nobody is
 * holding this screen, nobody will scroll it, and nobody should want to touch
 * it. So there is no nav and no card to tap, and the one control there is sits
 * in the corner furthest from where a passer-by leaning in puts a hand.
 *
 * Two things follow from "read from across a court":
 *
 * 1. Nothing is sized in px. A 10-inch tablet and a 55-inch TV are the same
 *    number of viewport units and wildly different numbers of pixels, so every
 *    size here is a share of the viewport, floored so it never disappears and
 *    capped so a two-court round does not print a numeral off the screen.
 * 2. The board and the courts take turns rather than share the space. Half a
 *    screen each would halve the type, which is the one thing this view cannot
 *    afford to spend.
 *
 * The turn-taking is a content swap on a timer, not an animation. MOTION dial 1
 * still holds: the score tick inside <Numeral /> is the only thing that moves.
 * The rotation is shown by two static marks, not a filling bar, and the swap
 * carries no fade and no slide. (An unpausable live scoreboard is legitimate
 * under WCAG 2.2.2's real-time exception, and there is nothing here to pause
 * anyway: the panels do not move, they are replaced.)
 */

/* -------------------------------------------------------------------------- */

/** How long each panel holds the screen. */
const PANEL_MS = 10_000;

/** How often the age line re-reads the clock. Slower than a second because
 *  "2 min ago" does not change fast enough to earn a re-render per tick. */
const CLOCK_MS = 5_000;

/**
 * Past this, a connected board that has not moved is called stale.
 *
 * Same number and same rule as the phone view, deliberately: two screens in one
 * room disagreeing about whether the board is current would be worse than
 * either answer on its own. A venue screen that has quietly stopped updating is
 * the failure this whole strip exists to prevent.
 */

const PANELS = ['board', 'round'] as const;
type Panel = (typeof PANELS)[number];

const PANEL_NAME: Record<Panel, StringKey> = {
  board: 'live.standings',
  round: 'live.currentRound',
};

const METRIC_LABEL: Record<RankingMetric, StringKey> = {
  ppr: 'setup.metricPpr',
  total: 'setup.metricTotal',
  wins: 'setup.metricWins',
};

/* -------------------------------------------------------------------------- */

/**
 * A type size that fills whatever screen this lands on.
 *
 * The `vh` term is the share of the height the element may spend, which is what
 * makes eight rows fill a TV and sixteen rows still fit. The `vw` term caps it,
 * which is what keeps portrait from overflowing sideways when the height is
 * generous and the width is not. The floor keeps a crowded panel legible; the
 * ceiling stops a nearly empty one from turning into a poster.
 */
function fluid(floor: string, vh: number, vw: number, ceiling: string): string {
  return `clamp(${floor}, min(${vh.toFixed(2)}vh, ${vw.toFixed(2)}vw), ${ceiling})`;
}

/** The frame's own sizes: everything that is not a score or a name. */
const TITLE_SIZE = fluid('1rem', 3.4, 3.2, '2.5rem');
const LABEL_SIZE = fluid('0.8rem', 2.4, 1.9, '1.75rem');
/** One step up from a label, for when the strip has bad news to deliver. */
const ALERT_SIZE = fluid('1rem', 3.2, 2.6, '2.25rem');

/**
 * The round the venue is looking at: the one being played, or the last one once
 * the schedule is done. Same derivation the organizer's play screen uses, and
 * it is -1 when no round has been drawn yet.
 */
function shownRoundIndex(state: TournamentState): number {
  const cursor = history.currentRoundIndex(state);
  return cursor >= state.rounds.length ? state.rounds.length - 1 : cursor;
}

/* -------------------------------------------------------------------------- */

/**
 * Empty, loading, missing, offline and error, at the size the rest of the
 * screen is read at.
 *
 * <Note /> is the organizer app's answer to the same job and it is the wrong
 * one here: its 15px title is a footnote on a 55-inch screen, which is exactly
 * the failure this view has to avoid. Same contract as <Note /> otherwise, so
 * no state is ever a bare spinner or a bare "no data".
 */
function Announcement({ title, body }: { title: string; body?: string }): ReactNode {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[1.6vh] px-[4vw] text-center">
      <p
        className="font-bold tracking-tight text-ink"
        style={{ fontSize: fluid('1.5rem', 7.5, 6.2, '5rem') }}
      >
        {title}
      </p>
      {body ? (
        <p
          className="max-w-[46ch] leading-snug text-ink-muted"
          style={{ fontSize: fluid('1rem', 3.4, 2.9, '2.25rem') }}
        >
          {body}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A short word beside a name, saying what the colour of that name means.
 *
 * The leader's word is boxed in the accent, which measures 15.31:1 and is the
 * one thing on this panel allowed to shout. A roster note (left, paused) is the
 * bare word: at this size a hairline box around eleven pixels of text is a
 * smudge from across the court, and the word was always the part carrying the
 * meaning.
 */
function Tag({
  tone,
  size,
  children,
}: {
  tone: 'accent' | 'quiet';
  size: string;
  children: ReactNode;
}): ReactNode {
  return (
    <span
      style={{ fontSize: size }}
      className={cx(
        'shrink-0 whitespace-nowrap font-semibold',
        tone === 'accent'
          ? 'rounded-court border border-optic px-[0.5em] py-[0.1em] text-optic'
          : 'text-ink-muted',
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

/** The field standings() already ranked on. Nothing here computes a metric. */
function metricValue(standing: Standing, metric: RankingMetric): number {
  switch (metric) {
    case 'ppr':
      return standing.ppr;
    case 'total':
      return standing.totalPoints;
    case 'wins':
      return standing.wins;
  }
}

function BoardPanel({ state }: { state: TournamentState }): ReactNode {
  const rows = useMemo<Standing[]>(() => standings(state), [state]);
  // podium() is the engine's own answer to "is there a leader yet": empty until
  // something is scored, and it steps over anyone short of rounds, so the one
  // accent this screen spends never lands on a player who cannot hold the lead.
  const crowned = useMemo<Standing[]>(() => podium(state), [state]);
  const byId = useMemo(() => {
    const map = new Map<string, PlayerRecord>();
    for (const player of state.players) map.set(player.id, player);
    return map;
  }, [state]);

  if (crowned.length === 0) {
    return <Announcement title={t('live.waiting')} body={t('board.emptyBody')} />;
  }

  const metric = state.config.rankingMetric;
  const leaderId = crowned[0]?.playerId;

  // The rows share out what is left of the screen. Sixty-eight units rather
  // than a hundred: the header, the two court lines, the caption and the footer
  // are already spent, and the rest is slack for a name that wraps. The gap
  // between rows is cut from the same share rather than being a flat number, so
  // eight rows and twenty-four rows both land at about the same fill instead of
  // one of them floating in the middle of the screen.
  const share = 68 / Math.max(rows.length, 1);
  const nameSize = fluid('1rem', share * 0.58, 6.5, '5rem');
  const numberSize = fluid('1.25rem', share * 0.8, 9.5, '8rem');
  const rankSize = fluid('0.8rem', share * 0.38, 3.2, '2.25rem');
  const tagSize = fluid('0.85rem', share * 0.3, 2.2, '1.5rem');
  const rowPad = `${(share * 0.09).toFixed(2)}vh`;

  return (
    <ol className="flex flex-1 flex-col justify-center">
      {rows.map((row, index) => {
        const player = byId.get(row.playerId);
        // A standing is built from the roster, so this fallback only fires on a
        // corrupt snapshot: show the id rather than drop someone off the board.
        const name = player?.name ?? row.playerId;
        const status = player?.status ?? 'active';
        const leader = row.playerId === leaderId;
        return (
          <li
            key={row.playerId}
            style={{ paddingTop: rowPad, paddingBottom: rowPad }}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-[2vw] border-b border-line-quiet last:border-b-0"
          >
            <span
              style={{ fontSize: rankSize }}
              className="numeral w-[2.5ch] shrink-0 text-right text-ink-muted"
            >
              {index + 1}
            </span>
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-[1.2vw] gap-y-[0.3vh]">
              <span
                style={{ fontSize: nameSize }}
                className={cx(
                  'break-words font-bold leading-tight tracking-tight',
                  // The leader is the one place this screen spends the accent,
                  // and the word rides along with it, so the crown survives a
                  // colour-blind reader and a TV with the colour turned down.
                  leader ? 'text-optic' : 'text-ink',
                )}
              >
                {name}
              </span>
              {leader ? (
                <Tag tone="accent" size={tagSize}>
                  {t('board.leader')}
                </Tag>
              ) : null}
              {status === 'left' ? (
                <Tag tone="quiet" size={tagSize}>
                  {t('players.left')}
                </Tag>
              ) : null}
              {status === 'paused' ? (
                <Tag tone="quiet" size={tagSize}>
                  {t('players.paused')}
                </Tag>
              ) : null}
            </span>
            <span
              style={{ fontSize: numberSize }}
              className={cx(
                'numeral w-[5.5ch] shrink-0 text-right leading-none',
                leader ? 'text-optic' : 'text-ink',
              )}
            >
              {/* Points per round is a rate, so it keeps its decimals: "22"
                  beside "22.75" reads as a tie it is not. It is also the one
                  metric that cannot roll, because <Numeral /> ticks integers. */}
              {metric === 'ppr' ? (
                <span className="tabular-nums">{formatRate(row.ppr)}</span>
              ) : (
                <Numeral value={metricValue(row, metric)} />
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */

function TeamLine({
  ids,
  playerName,
  score,
  nameSize,
  scoreSize,
}: {
  ids: readonly string[];
  playerName: (id: string) => string;
  score: number | undefined;
  nameSize: string;
  scoreSize: string;
}): ReactNode {
  return (
    <span className="flex items-center justify-between gap-[1.5vw] py-[0.6vh]">
      <span className="flex min-w-0 flex-col">
        {ids.map((id) => (
          // One name per line, wrapped rather than truncated: at this distance
          // the half of a name that gets cut is the half that tells two players
          // apart.
          <span
            key={id}
            style={{ fontSize: nameSize }}
            className="break-words font-semibold leading-tight tracking-tight text-ink"
          >
            {playerName(id)}
          </span>
        ))}
      </span>
      {score === undefined ? null : (
        <span style={{ fontSize: scoreSize }} className="numeral shrink-0 leading-none text-ink">
          <Numeral value={score} />
        </span>
      )}
    </span>
  );
}

function CourtCard({
  match,
  playerName,
  scoreSize,
  nameSize,
  labelSize,
}: {
  match: Match;
  playerName: (id: string) => string;
  scoreSize: string;
  nameSize: string;
  labelSize: string;
}): ReactNode {
  const scored = match.scoreA !== undefined && match.scoreB !== undefined;

  return (
    // The card boundary takes the 3:1 token rather than the decorative one:
    // from ten meters it is the only thing saying which two numbers belong to
    // the same court, which makes it information, not a rule.
    <li className="flex flex-col rounded-court border border-line-control bg-court-800 px-[1.5vw] py-[1vh]">
      <span
        style={{ fontSize: labelSize }}
        className="flex items-baseline justify-between gap-[1vw] border-b border-line-quiet pb-[0.6vh] font-semibold text-ink-muted"
      >
        <span>{t('score.heading', { court: match.court })}</span>
        {/* A real 0 and "nobody has entered this yet" are different facts, so
            an unscored court never shows a digit. */}
        {scored ? null : <span className="font-normal">{t('play.notScored')}</span>}
      </span>

      <TeamLine
        ids={match.teamA}
        playerName={playerName}
        score={match.scoreA}
        nameSize={nameSize}
        scoreSize={scoreSize}
      />
      {/* The net. */}
      <span className="block h-px bg-line-quiet" role="presentation" />
      <TeamLine
        ids={match.teamB}
        playerName={playerName}
        score={match.scoreB}
        nameSize={nameSize}
        scoreSize={scoreSize}
      />
    </li>
  );
}

function RoundPanel({ state }: { state: TournamentState }): ReactNode {
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const player of state.players) map.set(player.id, player.name);
    return map;
  }, [state]);
  // Falls back to the id, which is ugly on purpose: a court holding somebody
  // who is not on the roster is a bug worth seeing, not one worth hiding.
  const playerName = (id: string): string => nameById.get(id) ?? id;

  const index = shownRoundIndex(state);
  const round = index < 0 ? undefined : state.rounds[index];

  if (!round || round.matches.length === 0) {
    // play.emptyBody is an instruction to the organizer, and that is the right
    // audience: the person staring at a venue screen with no round on it is
    // almost always the one who can draw it.
    return <Announcement title={t('play.emptyTitle')} body={t('play.emptyBody')} />;
  }

  // Courts are laid out wide before they are laid out deep, because a card that
  // keeps its width keeps each name on one line. Three across is the stop: past
  // that the name column is narrower than the names.
  const count = round.matches.length;
  const columns = Math.min(3, Math.max(1, count <= 3 ? count : Math.ceil(count / 2)));
  const gridRows = Math.ceil(count / columns);
  const cardVh = 60 / gridRows;
  const cardVw = 100 / columns;

  const scoreSize = fluid('1.5rem', cardVh * 0.34, cardVw * 0.26, '14rem');
  const nameSize = fluid('0.95rem', cardVh * 0.13, cardVw * 0.1, '4rem');
  const labelSize = fluid('0.75rem', cardVh * 0.075, cardVw * 0.055, '1.75rem');

  return (
    <div className="flex flex-1 flex-col justify-center gap-[1.5vh]">
      <ul
        className="grid gap-[1.2vw]"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {round.matches.map((match) => (
          <CourtCard
            // The round index is in the key so a card is a new card when the
            // round changes, and the same card (score tick and all) when only a
            // score does.
            key={`${index}:${match.court}`}
            match={match}
            playerName={playerName}
            scoreSize={scoreSize}
            nameSize={nameSize}
            labelSize={labelSize}
          />
        ))}
      </ul>

      {/* Under points per round, sitting out costs a player nothing, so this is
          a roster fact stated plainly. It is also the line a spectator reads to
          find out whether they are on next. */}
      <div
        style={{ fontSize: labelSize }}
        className="flex flex-wrap items-baseline gap-x-[1.2vw] gap-y-[0.5vh]"
      >
        <span className="font-semibold text-ink-muted">
          {round.sitOuts.length === 0 ? t('play.nobodySittingOut') : t('play.sittingOut')}
        </span>
        {round.sitOuts.map((id) => (
          <span
            key={id}
            // court-900 is the token for a court that is out of play, which is
            // exactly what these players are this round.
            className="rounded-court border border-line-quiet bg-court-900 px-[0.6em] py-[0.15em] text-ink-muted"
          >
            {playerName(id)}
          </span>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** What is wrong with the connection, or null when nothing is. */
function troubleWord(status: LiveStatus): string | null {
  switch (status) {
    case 'offline':
      return t('live.offlineTitle');
    case 'missing':
      return t('live.missingTitle');
    case 'error':
      return t('live.errorTitle');
    case 'live':
    case 'polling':
    case 'loading':
      return null;
  }
}

export function CastScreen({ token }: { token: string }): ReactNode {
  const { status, state, receivedAt, contactAt } = useLiveBoard(token);
  const [panelIndex, setPanelIndex] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(
      () => setPanelIndex((current) => (current + 1) % PANELS.length),
      PANEL_MS,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const panel: Panel = PANELS[panelIndex] ?? 'board';

  // A typo in a link taped to the back of a tablet should say the link is
  // wrong, not leave the room watching a server error. The shape check is local
  // and costs one regex, and the phone view draws the same conclusion.
  const shown: LiveStatus = isWellFormedToken(token) ? status : 'missing';

  const age = describeAge(receivedAt, now);
  const connected = shown === 'live' || shown === 'polling';
  // Keyed on contact, not on the last score: a padel game runs minutes
  // between points, so scoring silence is normal and only a silent
  // connection is a problem.
  const stale = isOutOfTouch(contactAt, now);
  const trouble = troubleWord(shown);
  // A board that has not moved in ninety seconds does not also get to carry a
  // word saying it is current. Silence beats a claim we cannot back.
  const connection =
    connected && !stale
      ? shown === 'live'
        ? t('live.connectionLive')
        : t('live.connectionPolling')
      : null;
  const warning = trouble ?? (connected && stale ? t('live.stalled') : null);

  let body: ReactNode;
  if (state) {
    body = panel === 'board' ? <BoardPanel state={state} /> : <RoundPanel state={state} />;
  } else if (shown === 'missing') {
    body = <Announcement title={t('live.missingTitle')} body={t('live.missingBody')} />;
  } else if (shown === 'error') {
    body = <Announcement title={t('live.errorTitle')} body={t('live.errorBody')} />;
  } else if (shown === 'offline') {
    // Nothing has ever arrived on this device, so live.offlineBody ("the board
    // below is the last one that arrived") would be describing something that
    // is not there. Title only until the catalog has a line for this case.
    body = <Announcement title={t('live.offlineTitle')} />;
  } else if (shown === 'polling') {
    body = <Announcement title={t('live.loading')} body={t('live.connectionPolling')} />;
  } else {
    body = <Announcement title={t('live.loading')} />;
  }

  // The tournament's own name is what the room should see; "Live board" stands
  // in only when there is no name to show yet.
  const name = state?.config.name.trim() ?? '';
  const heading = name === '' ? t('live.title') : name;

  const roundIndex = state ? shownRoundIndex(state) : -1;
  const panelTitle =
    panel === 'round' && roundIndex >= 0
      ? t('play.roundHeading', { current: roundIndex + 1 })
      : t(PANEL_NAME[panel]);

  let caption: string | null = null;
  if (state && panel === 'board') {
    caption = t('board.rankedBy', { metric: t(METRIC_LABEL[state.config.rankingMetric]) });
  } else if (state && panel === 'round' && roundIndex >= 0 && state.config.rounds !== undefined) {
    // "of 7" only says something next to a round number. Beside the panel's own
    // name, which is what the heading falls back to before a round is drawn, it
    // is a fragment attached to nothing.
    caption = t('play.roundOf', { total: state.config.rounds });
  }

  return (
    // No max-width frame: the phone view is one column because a thumb reads it,
    // and this one is the whole screen because a court does. min-h-dvh rather
    // than a fixed height, so an unusually large tournament grows the page
    // instead of having its last row clipped off the bottom of it.
    <div className="flex min-h-dvh flex-col px-[3vw] pb-[max(2vh,env(safe-area-inset-bottom))] pt-[max(2vh,env(safe-area-inset-top))]">
      <header className="flex flex-wrap items-baseline justify-between gap-x-[2.5vw] gap-y-[0.8vh]">
        <h1
          style={{ fontSize: TITLE_SIZE }}
          className="min-w-0 break-words font-bold tracking-tight text-ink"
        >
          {heading}
        </h1>

        <div className="flex shrink-0 items-baseline gap-[1.5vw]">
          {/* Connection and freshness. Small by default, one size up and inside
              a boundary when it has bad news, because the failure this screen
              must never hide is looking healthy while frozen. With no board at
              all the announcement below already says this at full size, so the
              strip stays out of the way. */}
          {state ? (
            <p
              style={{ fontSize: warning === null ? LABEL_SIZE : ALERT_SIZE }}
              className={cx(
                'flex flex-wrap items-baseline gap-x-[1vw]',
                warning === null
                  ? 'text-ink-muted'
                  : 'rounded-court border border-line-control px-[0.6em] py-[0.15em] font-semibold text-ink',
              )}
            >
              {warning === null ? null : <span>{warning}</span>}
              {age === null ? null : <span>{t('live.updated', { age })}</span>}
              {connection === null ? null : <span className="font-semibold">{connection}</span>}
            </p>
          ) : null}

          {/* The only control on this screen. Top corner, because that is the
              part of a propped-up tablet a passer-by does not lean on, and a
              real anchor, so it keeps its focus ring and its 44px target
              without wearing a border that invites a tap. */}
          <Link
            to={`/t/${token}`}
            style={{ fontSize: LABEL_SIZE }}
            className="inline-flex min-h-11 shrink-0 items-center px-[0.6em] text-ink-muted no-underline"
          >
            {t('live.phoneView')}
          </Link>
        </div>
      </header>

      <Rule className="my-[1.4vh]" />

      <main className="flex flex-1 flex-col gap-[1.2vh]">
        {state ? (
          <div className="flex flex-wrap items-baseline justify-between gap-x-[2.5vw] gap-y-[0.5vh]">
            <h2 style={{ fontSize: TITLE_SIZE }} className="font-bold tracking-tight text-ink">
              {panelTitle}
            </h2>
            {caption ? (
              <p style={{ fontSize: LABEL_SIZE }} className="text-ink-muted">
                {caption}
              </p>
            ) : null}
          </div>
        ) : null}
        {body}
      </main>

      {/* Which panel is up and that another is coming: one mark per panel, the
          current one filled, each one carrying its name. Filled against
          outlined is a shape difference and the name is a word, so neither
          colour nor motion is left holding the state on its own. Nothing here
          animates, and there is no bar filling up towards the next swap. */}
      {state ? (
        <>
          <Rule className="my-[1.4vh]" />
          <footer className="flex items-center justify-between gap-[2.5vw]">
            <ul className="flex items-center gap-[2vw]">
              {PANELS.map((option, position) => {
                const current = position === panelIndex;
                // Omitted rather than set to undefined: with
                // exactOptionalPropertyTypes those are two different things.
                const marker: { 'aria-current'?: 'true' } = current
                  ? { 'aria-current': 'true' }
                  : {};
                return (
                  <li key={option} {...marker} className="flex items-center gap-[0.9vw]">
                    <span
                      className={cx(
                        'block size-[1.2vmin] min-h-2 min-w-2 shrink-0 rounded-court border',
                        current ? 'border-ink bg-ink' : 'border-line-control',
                      )}
                    />
                    <span
                      style={{ fontSize: LABEL_SIZE }}
                      className={cx(
                        'tracking-tight',
                        current ? 'font-semibold text-ink' : 'text-ink-muted',
                      )}
                    >
                      {t(PANEL_NAME[option])}
                    </span>
                  </li>
                );
              })}
            </ul>
            <span style={{ fontSize: LABEL_SIZE }} className="text-ink-muted">
              {t('app.name')}
            </span>
          </footer>
        </>
      ) : null}
    </div>
  );
}
