import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

/**
 * The router.
 *
 * Seven flat routes, one dynamic segment, no nested data loading. A router
 * dependency would be the heaviest thing in a bundle that has to open on bad
 * courtside data, so this is hand-rolled. The surface deliberately mirrors the
 * usual one (`<Link>`, `useRoute`, `navigate`) so swapping in a real router
 * later is one file. See docs/decisions.md.
 */

export interface RouteMatch {
  /** The matched pattern, e.g. '/t/:token'. 'not-found' when nothing matched. */
  pattern: string;
  path: string;
  params: Readonly<Record<string, string>>;
}

interface RouterValue extends RouteMatch {
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

/**
 * Where the app is mounted, with a trailing slash. Vite injects this from the
 * build's `base`, so a GitHub Pages deployment at /tanteo/ and a self-hosted
 * one at / run the same code.
 */
const BASE = import.meta.env.BASE_URL || '/';

/**
 * Strip the mount point, so route patterns stay written as if mounted at /.
 * Takes the base explicitly so it can be tested without a build.
 */
export function stripBase(pathname: string, base: string = BASE): string {
  if (base === '/') return pathname || '/';
  const withoutSlash = base.replace(/\/$/, '');
  if (pathname === withoutSlash) return '/';
  if (pathname.startsWith(base)) return `/${pathname.slice(base.length)}`;
  // A path outside the mount point is not ours to rewrite; hand it back and let
  // it fall through to not-found rather than silently pretending it matched.
  return pathname || '/';
}

/** Put the mount point back on, for anything the browser has to understand. */
export function withBase(path: string, base: string = BASE): string {
  if (base === '/') return path;
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

function currentPath(): string {
  return stripBase(window.location.pathname);
}

/**
 * Match a path against `/a/:b` style patterns.
 * Patterns are tried in order, so put the more specific one first.
 */
export function matchRoute(patterns: readonly string[], path: string): RouteMatch {
  const segments = path.replace(/\/+$/, '').split('/').filter(Boolean);

  for (const pattern of patterns) {
    const patternSegments = pattern.split('/').filter(Boolean);
    if (patternSegments.length !== segments.length) continue;

    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < patternSegments.length; i++) {
      const expected = patternSegments[i] as string;
      const actual = segments[i] as string;
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeURIComponent(actual);
        continue;
      }
      if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { pattern, path, params };
  }

  return { pattern: 'not-found', path, params: {} };
}

export function Router({
  patterns,
  children,
}: {
  patterns: readonly string[];
  children: ReactNode;
}): ReactNode {
  const [path, setPath] = useState(currentPath);

  // Back and forward are the browser's job; we only have to listen.
  useEffect(() => {
    const onPop = (): void => setPath(currentPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (to === currentPath()) return;
    // History takes a real URL, so the mount point goes back on here. Route
    // patterns everywhere else stay base-free.
    const href = withBase(to);
    if (options?.replace) window.history.replaceState(null, '', href);
    else window.history.pushState(null, '', href);
    setPath(to);
    // A route change is a new screen, so it starts at the top. Without this a
    // deep scroll on the board carries over onto the score screen.
    window.scrollTo(0, 0);
  }, []);

  const value = useMemo<RouterValue>(
    () => ({ ...matchRoute(patterns, path), navigate }),
    [patterns, path, navigate],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRoute(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('useRoute must be used inside <Router>');
  return value;
}

export function useNavigate(): RouterValue['navigate'] {
  return useRoute().navigate;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  to: string;
  replace?: boolean;
};

/**
 * A real anchor, so Enter, middle-click and "open in new tab" all behave. Only
 * a plain left click is intercepted for client-side navigation.
 */
export function Link({ to, replace, onClick, children, ...rest }: LinkProps): ReactNode {
  const navigate = useNavigate();
  return (
    <a
      href={withBase(to)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to, replace === undefined ? undefined : { replace });
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
