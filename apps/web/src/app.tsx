import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { Button, Note, Rule, TAP, cx } from './components/primitives.js';
import { t } from './i18n/index.js';
import { Link, Router, useRoute } from './router.js';
import { BoardScreen } from './screens/board.js';
import { CastScreen } from './screens/cast.js';
import { HomeScreen } from './screens/home.js';
import { LiveScreen } from './screens/live.js';
import { PlayScreen } from './screens/play.js';
import { PlayersScreen } from './screens/players.js';
import { SetupScreen } from './screens/setup.js';
import { TournamentProvider, useTournament } from './state.js';

/**
 * The shell.
 *
 * Four jobs and nothing else: hold the provider and the router, resolve the
 * three boot states before any screen can assume a tournament exists, put the
 * routed screen on the page, and own the one piece of persistent chrome (the
 * bottom bar). Everything a screen shows below its header belongs to that
 * screen; DESIGN.md's RHYTHM dial asks for a shared frame, not a template.
 */

/** Every route in the app. The matcher is segment-exact, so order is free. */
const ROUTES = [
  '/',
  '/setup',
  '/play',
  '/players',
  '/board',
  '/t/:token',
  '/t/:token/cast',
] as const;

/**
 * The routes that only mean anything while a tournament is open.
 *
 * One constant, because "shows the bottom bar" and "sends you home when there
 * is no tournament" are the same fact stated twice, and they must never drift.
 */
const TOURNAMENT_ROUTES: ReadonlySet<string> = new Set(['/play', '/players', '/board']);

/** Phone-first single column, so a laptop does not stretch a score row to 1200px. */
const FRAME = 'mx-auto w-full max-w-[42rem]';

/**
 * Space the page reserves under the fixed bar: the 44px target, its 2px
 * marker, a thumb's worth of gap, and then the home indicator.
 */
const BAR_CLEARANCE = 'pb-[calc(4.5rem+env(safe-area-inset-bottom))]';

/** Where a screen with no bar ends: a gutter, or the home indicator if it is bigger. */
const PAGE_CLEARANCE = 'pb-[max(1.5rem,env(safe-area-inset-bottom))]';

/* -------------------------------------------------------------------------- */

/**
 * The frame every screen sits in: a header row, a court line, and the content.
 *
 * The header is sticky because the organizer scrolls a long court list with one
 * thumb and still has to know which screen the phone is on. The page itself is
 * what scrolls (not an inner box), which is what makes the router's
 * scroll-to-top on navigation, and iOS's collapsing URL bar, behave.
 */
export function Screen({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}): ReactNode {
  const { pattern } = useRoute();
  return (
    <div className={cx(FRAME, 'flex min-h-full flex-col')}>
      <header className="sticky top-0 z-30 bg-court-950 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <h1 className="min-w-0 text-[19px] font-bold tracking-tight text-ink">{title}</h1>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </div>
        {/* Inside the sticky box, so the line stays under the title rather than
            scrolling off and letting content slide up against the header. */}
        <Rule />
      </header>
      {/* px-4 is the shared page gutter; a screen that wants full bleed for a
          court card can undo it with -mx-4. */}
      <main
        className={cx(
          'flex-1 px-4 pt-4',
          TOURNAMENT_ROUTES.has(pattern) ? BAR_CLEARANCE : PAGE_CLEARANCE,
        )}
      >
        {children}
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The frame for the screens that are not a tournament: boot states, the 404,
 * and the live view placeholder. The wordmark is there because otherwise a
 * cold boot on a bad connection is an unattributed dark rectangle.
 */
function Standalone({ children }: { children: ReactNode }): ReactNode {
  return (
    <main className={cx(FRAME, 'flex min-h-full flex-col justify-center gap-4 px-4 py-10')}>
      <p className="text-[15px] font-bold tracking-tight text-ink">{t('app.name')}</p>
      {children}
    </main>
  );
}

function BootProblem({
  title,
  body,
  onRetry,
}: {
  title: string;
  body: string;
  onRetry: () => void;
}): ReactNode {
  return (
    <Standalone>
      <Note
        tone="alert"
        title={title}
        body={body}
        // Retry is the secondary weight on purpose: the alert Note already
        // spends the optic accent here, and one hot thing per screen is the
        // whole point of holding the accent back.
        action={<Button onClick={onRetry}>{t('common.retry')}</Button>}
      />
    </Standalone>
  );
}

/* -------------------------------------------------------------------------- */

/** A real anchor wearing the secondary button's skin, so long-press and
 *  open-in-new-tab still work where a <Button> would swallow them. */
const LINK_AS_BUTTON = cx(
  TAP,
  'inline-flex items-center justify-center rounded-control border border-line-control',
  'bg-court-800 px-4 py-2.5 text-[15px] font-semibold tracking-tight text-ink no-underline',
);

function NotFound(): ReactNode {
  return (
    <Standalone>
      <Note
        title={t('errors.notFoundTitle')}
        body={t('errors.notFoundBody')}
        action={
          <Link to="/" replace className={LINK_AS_BUTTON}>
            {t('common.back')}
          </Link>
        }
      />
    </Standalone>
  );
}

/**
 * The read-only live view ships in a later milestone. The route is real and
 * answers honestly rather than 404-ing a link somebody has already shared; the
 * body carries the next action, so there is nothing to click that would lie.
 */

/* -------------------------------------------------------------------------- */

interface NavItem {
  to: string;
  label: string;
}

/**
 * The bottom bar, on the three routes where a tournament is open.
 *
 * Fixed, compact, and below the Sheet's z-50 so a sheet always covers it.
 * The current destination is marked three ways: the optic accent, a 2px top
 * marker, and aria-current, because colour alone is not a state.
 */
function BottomBar({ pattern }: { pattern: string }): ReactNode {
  const items: readonly NavItem[] = [
    { to: '/play', label: t('play.title') },
    { to: '/players', label: t('players.open') },
    { to: '/board', label: t('board.open') },
  ];

  return (
    <nav
      aria-label={t('nav.label')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line-quiet bg-court-900 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className={cx(FRAME, 'grid grid-cols-3 gap-1 px-1')}>
        {items.map((item) => {
          const current = item.to === pattern;
          // Omitted rather than set to undefined: with
          // exactOptionalPropertyTypes those are two different things.
          const marker: { 'aria-current'?: 'page' } = current ? { 'aria-current': 'page' } : {};
          return (
            <li key={item.to} className="flex">
              <Link
                to={item.to}
                {...marker}
                className={cx(
                  TAP,
                  'flex w-full items-center justify-center border-t-2 px-2 py-3',
                  'text-center text-[13px] no-underline',
                  current
                    ? 'border-optic font-semibold text-optic'
                    : 'border-transparent font-medium text-ink-muted',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */

function CurrentScreen({
  pattern,
  params,
}: {
  pattern: string;
  params: Readonly<Record<string, string>>;
}): ReactNode {
  switch (pattern) {
    case '/':
      return <HomeScreen />;
    case '/setup':
      return <SetupScreen />;
    case '/play':
      return <PlayScreen />;
    case '/players':
      return <PlayersScreen />;
    case '/board':
      return <BoardScreen />;
    // The two public routes. A viewer holds a read token and nothing else, so
    // these render the read-only board and never the organizer's shell.
    case '/t/:token':
      return <LiveScreen token={params['token'] ?? ''} cast={false} />;
    case '/t/:token/cast':
      return <CastScreen token={params['token'] ?? ''} />;
    default:
      return <NotFound />;
  }
}

function Shell(): ReactNode {
  const { status, storageBlocked, state, reload } = useTournament();
  const { pattern, params, navigate } = useRoute();

  const needsTournament = TOURNAMENT_ROUTES.has(pattern);
  // A shared link, a reopened tab, or a tournament discarded from another
  // screen can all land here with nothing to score.
  const stranded = needsTournament && status === 'ready' && state === null;

  useEffect(() => {
    // Replace, not push: Back should leave the app, not bounce off a screen
    // that will only redirect again.
    if (stranded) navigate('/', { replace: true });
  }, [stranded, navigate]);

  const onRetry = (): void => {
    void reload();
  };

  // Storage is fatal: without it the tournament cannot survive a locked
  // screen, so it replaces the app rather than sitting inside a screen.
  if (storageBlocked) {
    return (
      <BootProblem
        title={t('errors.storageTitle')}
        body={t('errors.storageBody')}
        onRetry={onRetry}
      />
    );
  }

  if (status === 'loading') {
    return (
      <Standalone>
        {/* Names what is being opened. A bare spinner would say nothing. */}
        <Note title={t('common.loading')} />
      </Standalone>
    );
  }

  // Boot got as far as reading storage and then failed on it.
  if (status === 'error') {
    return (
      <BootProblem
        title={t('errors.genericTitle')}
        body={t('errors.bootBody')}
        onRetry={onRetry}
      />
    );
  }

  // The effect above is already on its way home; a half-built screen would
  // flash a court list that does not exist.
  if (stranded) return null;

  return (
    <>
      <CurrentScreen pattern={pattern} params={params} />
      {needsTournament ? <BottomBar pattern={pattern} /> : null}
    </>
  );
}

export function App(): ReactNode {
  return (
    <TournamentProvider>
      <Router patterns={ROUTES}>
        <Shell />
      </Router>
    </TournamentProvider>
  );
}
