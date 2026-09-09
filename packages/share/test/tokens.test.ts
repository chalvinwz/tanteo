/**
 * The two-token model.
 *
 * The share link is a capability: whoever holds it sees the board. The whole
 * safety of that idea rests on the link being the *public* half of a pair, so
 * these tests pin the three properties the server leans on:
 *
 *   1. a write token is fresh and URL-safe,
 *   2. a read token is a deterministic function of a write token and is never
 *      equal to it,
 *   3. the shape check refuses anything that could smuggle a path.
 *
 * If one of these fails, a link pasted into a group chat becomes a write key,
 * so each case here is worth more than the line count suggests.
 */

import { describe, expect, it } from 'vitest';

import {
  createWriteToken,
  deriveReadToken,
  isWellFormedToken,
  shareUrlPath,
  timingSafeEqual,
} from '../src/index.js';

/** The character set of URL-safe base64, and nothing else. */
const URL_SAFE = /^[A-Za-z0-9_-]+$/;

/** A token of exactly this many legal characters, for the boundary cases. */
function tokenOfLength(length: number): string {
  return 'a'.repeat(length);
}

describe('a write token is a fresh secret', () => {
  it('is URL-safe base64 with no padding and no slashes', () => {
    const token = createWriteToken();

    expect(token).toMatch(URL_SAFE);
    expect(token).not.toContain('+');
    expect(token).not.toContain('/');
    expect(token).not.toContain('=');
  });

  it('survives a round trip through a URL path unchanged', () => {
    const token = createWriteToken();

    // The point of URL-safe: nothing in the token needs escaping, so the token
    // in the path is byte-for-byte the token the server compares.
    expect(encodeURIComponent(token)).toBe(token);
  });

  it('passes the shape check the server applies before storage', () => {
    expect(isWellFormedToken(createWriteToken())).toBe(true);
  });

  it('is different every call', () => {
    const tokens = new Set(Array.from({ length: 64 }, () => createWriteToken()));

    // 64 draws of 256 bits. A collision here means the entropy is not there.
    expect(tokens.size).toBe(64);
  });
});

describe('a read token is the public half of a write token', () => {
  it('derives the same read token from the same write token', async () => {
    const writeToken = createWriteToken();

    const first = await deriveReadToken(writeToken);
    const second = await deriveReadToken(writeToken);

    // The server derives on every write and compares against the path, so a
    // derivation that drifted would lock the organizer out of their own board.
    expect(second).toBe(first);
  });

  it('derives a different read token from a different write token', async () => {
    const one = await deriveReadToken(createWriteToken());
    const other = await deriveReadToken(createWriteToken());

    expect(other).not.toBe(one);
  });

  it('derives a different read token when one character of the input changes', async () => {
    const base = 'aaaaaaaaaaaaaaaaaaaaaaaa';

    const one = await deriveReadToken(base);
    const other = await deriveReadToken(`${base.slice(0, -1)}b`);

    expect(other).not.toBe(one);
  });

  it('is well formed and is not the write token it came from', async () => {
    const writeToken = createWriteToken();

    const readToken = await deriveReadToken(writeToken);

    expect(isWellFormedToken(readToken)).toBe(true);
    expect(readToken).not.toBe(writeToken);
    expect(readToken).toMatch(URL_SAFE);
  });

  it('is the only token in the link a viewer receives', async () => {
    const writeToken = createWriteToken();
    const readToken = await deriveReadToken(writeToken);

    const path = shareUrlPath(readToken);

    expect(path).toBe(`/t/${readToken}`);
    expect(path).not.toContain(writeToken);
  });
});

describe('the shape check refuses anything that is not a token', () => {
  it('rejects an empty string', () => {
    expect(isWellFormedToken('')).toBe(false);
  });

  it('rejects a token that is too short to be a secret', () => {
    expect(isWellFormedToken(tokenOfLength(15))).toBe(false);
  });

  it('rejects a token that is too long to be one of ours', () => {
    expect(isWellFormedToken(tokenOfLength(65))).toBe(false);
  });

  it('accepts both length boundaries', () => {
    expect(isWellFormedToken(tokenOfLength(16))).toBe(true);
    expect(isWellFormedToken(tokenOfLength(64))).toBe(true);
  });

  it('rejects a path separator, so a token cannot name a directory', () => {
    // Each of these is long enough to pass the length check, so the separator
    // is the only reason it is refused.
    expect(isWellFormedToken('aaaaaaaa/aaaaaaaa')).toBe(false);
    expect(isWellFormedToken('/aaaaaaaaaaaaaaaa')).toBe(false);
    expect(isWellFormedToken('aaaaaaaaaaaaaaaa/')).toBe(false);
  });

  it('rejects dots, so a traversal can never reach the store', () => {
    expect(isWellFormedToken('aaaaaaaa.aaaaaaaa')).toBe(false);
    expect(isWellFormedToken('..aaaaaaaaaaaaaaaa')).toBe(false);
    expect(isWellFormedToken('..%2F..%2Fetc%2Fpasswd')).toBe(false);
    expect(isWellFormedToken('../../etc/passwd0000')).toBe(false);
  });

  it('rejects base64 that is not the URL-safe alphabet', () => {
    expect(isWellFormedToken('aaaaaaaa+aaaaaaaa')).toBe(false);
    expect(isWellFormedToken('aaaaaaaaaaaaaaaa=')).toBe(false);
    expect(isWellFormedToken('aaaaaaaaaaaaaaaa==')).toBe(false);
  });

  it('rejects whitespace, including a trailing newline', () => {
    expect(isWellFormedToken('aaaaaaaa aaaaaaaa')).toBe(false);
    expect(isWellFormedToken('aaaaaaaaaaaaaaaa\n')).toBe(false);
  });
});

describe('the write check compares in constant time', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa')).toBe(true);
  });

  it('returns true for two separately built copies of the same token', () => {
    const token = createWriteToken();
    const copy = token.split('').join('');

    // Same content, different object. The comparison is on characters, not on
    // reference equality.
    expect(timingSafeEqual(token, copy)).toBe(true);
  });

  it('returns false for strings of different lengths', () => {
    expect(timingSafeEqual('aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaa')).toBe(false);
    expect(timingSafeEqual('aaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa')).toBe(false);
    expect(timingSafeEqual('', 'a')).toBe(false);
  });

  it('returns false when the difference is in the first character', () => {
    expect(timingSafeEqual('baaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('returns false when the difference is in the last character', () => {
    // Guards the loop bound: an off-by-one would call these equal.
    expect(timingSafeEqual('aaaaaaaaaaaaaaab', 'aaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('returns false for a read token compared with its write token', async () => {
    const writeToken = createWriteToken();
    const readToken = await deriveReadToken(writeToken);

    expect(timingSafeEqual(readToken, writeToken)).toBe(false);
  });
});
