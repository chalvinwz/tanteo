import { afterEach, describe, expect, it } from 'vitest';

import { en } from '../src/i18n/en.js';
import { id } from '../src/i18n/id.js';
import { getLocale, locales, setLocale, subscribeLocale, t } from '../src/i18n/index.js';
import type { StringKey } from '../src/i18n/index.js';

/**
 * The catalogs, checked against each other.
 *
 * TypeScript already refuses a catalog of the wrong shape, so these tests are
 * aimed at what the type system cannot see: a translation that silently drops
 * a `{placeholder}`, a key that was copied from English and never translated,
 * and the runtime behaviour of locale selection on a device that refuses
 * storage. The vitest environment is node, which has no `localStorage` at all,
 * so every test in this file exercises the private-mode path for free.
 */

type Flat = Map<string, string>;

function flatten(node: unknown, prefix: string, into: Flat): Flat {
  if (typeof node === 'string') {
    into.set(prefix, node);
    return into;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    flatten(value, prefix ? `${prefix}.${key}` : key, into);
  }
  return into;
}

const ENGLISH = flatten(en, '', new Map());
const INDONESIAN = flatten(id, '', new Map());

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();
}

/**
 * Keys whose Indonesian is deliberately the English, word for word.
 *
 * Listed one by one so that every exception is a decision someone made and can
 * be argued with, and so that translating one later fails this file rather
 * than passing quietly.
 */
const SAME_IN_BOTH: ReadonlyMap<string, string> = new Map([
  ['app.name', 'the product name'],
  ['setup.americano', 'the format name'],
  ['setup.mexicano', 'the format name'],
  ['setup.formatLabel', 'Format is the Indonesian word too'],
  ['board.columnPpr', 'poin per ronde abbreviates to the same three letters'],
  ['play.matchPoint', 'borrowed: this is what gets shouted on an Indonesian court'],
]);

describe('the Indonesian catalog', () => {
  it('has exactly the English keys, no more and no fewer', () => {
    const missing = [...ENGLISH.keys()].filter((key) => !INDONESIAN.has(key));
    const untranslatable = [...INDONESIAN.keys()].filter((key) => !ENGLISH.has(key));
    expect({ missing, untranslatable }).toEqual({ missing: [], untranslatable: [] });
  });

  it('keeps every {placeholder} the English string has', () => {
    // The failure this catches renders as the literal text "{count} pemain".
    const broken: Array<{ key: string; english: string[]; indonesian: string[] }> = [];
    for (const [key, english] of ENGLISH) {
      const indonesian = INDONESIAN.get(key);
      if (indonesian === undefined) continue;
      const want = placeholders(english);
      const got = placeholders(indonesian);
      if (want.join() !== got.join()) broken.push({ key, english: want, indonesian: got });
    }
    expect(broken).toEqual([]);
  });

  it('translates everything except the listed proper nouns and borrowings', () => {
    const untranslated = [...ENGLISH]
      .filter(([key, english]) => INDONESIAN.get(key) === english && !SAME_IN_BOTH.has(key))
      .map(([key]) => key);
    expect(untranslated).toEqual([]);
  });

  it('has no stale entry in the exception list', () => {
    const nowDifferent = [...SAME_IN_BOTH.keys()].filter(
      (key) => INDONESIAN.get(key) !== ENGLISH.get(key),
    );
    expect(nowDifferent).toEqual([]);
  });

  it('does not inflect for plurals, because Indonesian does not', () => {
    expect(t('home.playerCount', { count: 1 }, 'id')).toBe('1 pemain');
    expect(t('home.playerCount', { count: 9 }, 'id')).toBe('9 pemain');
  });
});

describe('t()', () => {
  afterEach(() => {
    setLocale('en');
  });

  it('falls back to English, not to the key, for a key a catalog is missing', () => {
    // Reached by removing a key rather than by declaring one: the catalog type
    // makes a genuinely missing key impossible to write, and this is the path
    // that would run if a future catalog were built any other way.
    const group = id.board as unknown as Record<string, string | undefined>;
    const original = group['columnDiff'];
    delete group['columnDiff'];
    try {
      expect(t('board.columnDiff', undefined, 'id')).toBe(en.board.columnDiff);
    } finally {
      group['columnDiff'] = original;
    }
    expect(t('board.columnDiff', undefined, 'id')).toBe(id.board.columnDiff);
  });

  it('returns the key when no catalog has it', () => {
    const absent = 'board.columnNobodyAdded' as StringKey;
    expect(t(absent, undefined, 'id')).toBe('board.columnNobodyAdded');
  });

  it('answers in the active locale when the call does not name one', () => {
    expect(t('common.cancel')).toBe('Cancel');
    setLocale('id');
    expect(t('common.cancel')).toBe('Batal');
  });

  it('still honours an explicit locale argument', () => {
    setLocale('id');
    expect(t('common.cancel', undefined, 'en')).toBe('Cancel');
  });
});

describe('locale selection', () => {
  afterEach(() => {
    setLocale('en');
  });

  it('lists both catalogs', () => {
    expect(locales).toEqual(['en', 'id']);
  });

  it('sets and reads the current locale', () => {
    expect(getLocale()).toBe('en');
    setLocale('id');
    expect(getLocale()).toBe('id');
  });

  it('does not throw where storage is refused', () => {
    // Node has no localStorage, which is the same shape of failure as a browser
    // in private mode: the property access itself is what blows up.
    expect(globalThis.localStorage).toBeUndefined();
    expect(() => {
      setLocale('id');
    }).not.toThrow();
  });

  it('tells subscribers, once per actual change', () => {
    let changes = 0;
    const unsubscribe = subscribeLocale(() => {
      changes += 1;
    });
    setLocale('id');
    setLocale('id');
    expect(changes).toBe(1);
    unsubscribe();
    setLocale('en');
    expect(changes).toBe(1);
  });
});
