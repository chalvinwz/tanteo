import type { RngState } from './types.js';

/**
 * A seeded PRNG carried in tournament state.
 *
 * The engine has no clock and no Math.random, so a tournament replays bit for
 * bit from its seed and its event log. That is what makes the golden fixture a
 * spec rather than a snapshot of one lucky run.
 *
 * mulberry32 over an FNV-1a hash of the seed string. Fast, tiny, and good
 * enough to shuffle a padel draw — not for anything that needs real entropy.
 */

function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(a: number): number {
  let t = (a + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createRng(seed: string): RngState {
  return { seed, cursor: 0 };
}

/** Draw a float in [0, 1) and return the advanced cursor alongside it. */
export function next(rng: RngState): [number, RngState] {
  const value = mulberry32((hashSeed(rng.seed) + rng.cursor * 0x9e3779b9) >>> 0);
  return [value, { seed: rng.seed, cursor: rng.cursor + 1 }];
}

/** Draw an integer in [0, max). */
export function nextInt(rng: RngState, max: number): [number, RngState] {
  const [value, advanced] = next(rng);
  return [Math.floor(value * max), advanced];
}

/** Fisher-Yates, returning a new array and the advanced cursor. */
export function shuffle<T>(items: readonly T[], rng: RngState): [T[], RngState] {
  const out = [...items];
  let cursor = rng;
  for (let i = out.length - 1; i > 0; i--) {
    const [j, advanced] = nextInt(cursor, i + 1);
    cursor = advanced;
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return [out, cursor];
}
