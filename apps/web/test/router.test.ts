import { describe, expect, it } from 'vitest';

import { matchRoute, stripBase, withBase } from '../src/router.js';

/**
 * The router's base handling.
 *
 * tanteo ships two ways: self-hosted at the root of its own origin, and on
 * GitHub Pages under /tanteo/. The same bundle serves both, so every path the
 * browser sees carries the mount point and every route pattern is written
 * without it. Get this wrong in one direction and every link 404s; get it wrong
 * in the other and nothing matches, so the app renders not-found forever.
 */

const ROUTES = ['/', '/setup', '/play', '/players', '/board', '/t/:token', '/t/:token/cast'];

describe('stripBase', () => {
  it('is a no-op at the root, which is the self-hosted case', () => {
    expect(stripBase('/', '/')).toBe('/');
    expect(stripBase('/board', '/')).toBe('/board');
  });

  it('removes the mount point under a subpath', () => {
    expect(stripBase('/tanteo/', '/tanteo/')).toBe('/');
    expect(stripBase('/tanteo/board', '/tanteo/')).toBe('/board');
    expect(stripBase('/tanteo/t/abc123', '/tanteo/')).toBe('/t/abc123');
  });

  it('handles the mount point with no trailing slash', () => {
    // What the browser shows when someone types the bare URL.
    expect(stripBase('/tanteo', '/tanteo/')).toBe('/');
  });

  it('leaves a path outside the mount point alone', () => {
    // Better to fall through to not-found than to invent a match.
    expect(stripBase('/somewhere-else', '/tanteo/')).toBe('/somewhere-else');
  });
});

describe('withBase', () => {
  it('is a no-op at the root', () => {
    expect(withBase('/board', '/')).toBe('/board');
  });

  it('prefixes the mount point', () => {
    expect(withBase('/', '/tanteo/')).toBe('/tanteo/');
    expect(withBase('/board', '/tanteo/')).toBe('/tanteo/board');
    expect(withBase('/t/abc123', '/tanteo/')).toBe('/tanteo/t/abc123');
  });

  it('round trips with stripBase', () => {
    // The property that actually matters: a link built by withBase must match
    // the pattern it came from after stripBase puts it back.
    for (const base of ['/', '/tanteo/', '/padel/tanteo/']) {
      for (const path of ['/', '/board', '/t/abc123', '/t/abc123/cast']) {
        expect(stripBase(withBase(path, base), base)).toBe(path);
      }
    }
  });
});

describe('the two together, against the real route table', () => {
  it('matches every route under a subpath deployment', () => {
    const base = '/tanteo/';
    const cases: Array<[string, string]> = [
      ['/tanteo/', '/'],
      ['/tanteo/setup', '/setup'],
      ['/tanteo/play', '/play'],
      ['/tanteo/players', '/players'],
      ['/tanteo/board', '/board'],
      ['/tanteo/t/abc123', '/t/:token'],
      ['/tanteo/t/abc123/cast', '/t/:token/cast'],
    ];
    for (const [browserPath, expected] of cases) {
      expect(matchRoute(ROUTES, stripBase(browserPath, base)).pattern).toBe(expected);
    }
  });

  it('reads the share token correctly through the mount point', () => {
    const match = matchRoute(ROUTES, stripBase('/tanteo/t/FjgzKaOQKdEd', '/tanteo/'));
    expect(match.params['token']).toBe('FjgzKaOQKdEd');
  });

  it('still resolves an unknown path to not-found under a subpath', () => {
    expect(matchRoute(ROUTES, stripBase('/tanteo/nope', '/tanteo/')).pattern).toBe('not-found');
  });
});
