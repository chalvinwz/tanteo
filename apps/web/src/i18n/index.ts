import { en } from './en.js';
import type { Strings } from './en.js';
import { id } from './id.js';

/**
 * A deliberately small i18n layer.
 *
 * Two catalogs, one active locale, no dependency. The active locale lives in a
 * module variable rather than in React state so that `t()` reads the same in a
 * component, in `live-source.ts` and in a plain function.
 */

/**
 * `Strings` with its leaves widened to `string`.
 *
 * `en.ts` is `as const`, so `Strings['common']['cancel']` is the literal
 * `'Cancel'` and no translation could ever satisfy it. The widening happens
 * here rather than by dropping `as const` from en.ts: the shape is what a
 * catalog has to match, and a missing or extra key is still a compile error,
 * while en.ts stays the single source of both the shape and the English text.
 */
type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };
export type Catalog = Widen<Strings>;

const catalogs = { en, id } satisfies Record<string, Catalog>;

export type Locale = keyof typeof catalogs;

/** Every locale that has a catalog. */
export const locales = Object.keys(catalogs) as Locale[];

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.hasOwn(catalogs, value);
}

/** Dotted path into the string catalog, e.g. 'play.roundHeading'. */
type Path<T> = T extends string
  ? []
  : { [K in keyof T]: [K & string, ...Path<T[K]>] }[keyof T];

type Join<T extends string[]> = T extends [infer F extends string]
  ? F
  : T extends [infer F extends string, ...infer R extends string[]]
    ? `${F}.${Join<R>}`
    : never;

export type StringKey = Join<Path<Strings>>;

function lookup(locale: Locale, key: string): string | undefined {
  const parts = key.split('.');
  let node: unknown = catalogs[locale];
  for (const part of parts) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * Look up a string and fill its `{placeholders}`.
 *
 * A key the active locale is missing falls back to English, because an
 * untranslated sentence is still readable and `board.columnPpr` is not. A key
 * no catalog has returns the key itself: loud in the UI, harmless at runtime,
 * and it shows up the moment a catalog falls behind.
 *
 * Values are substituted literally, so a player called "{count}" would be
 * substituted once and then left alone. Interpolation runs over the template,
 * never over what it produced.
 */
export function t(
  key: StringKey,
  values?: Readonly<Record<string, string | number>>,
  locale: Locale = getLocale(),
): string {
  const template = lookup(locale, key) ?? lookup('en', key) ?? key;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}

/** BCP 47 tag per catalog, for the document language. */
const documentLanguage: Record<Locale, string> = { en: 'en', id: 'id' };

const STORAGE_KEY = 'tanteo.locale';

/** `in` is the pre-1989 ISO code for Indonesian, still sent by some Android stacks. */
const LANGUAGE_ALIASES: Readonly<Record<string, Locale>> = { in: 'id' };

/** 'id-ID' and 'ID' both mean the Indonesian catalog; 'de-CH' means none of them. */
function fromLanguageTag(tag: string | undefined): Locale | undefined {
  const primary = tag?.split('-')[0]?.toLowerCase();
  if (primary === undefined) return undefined;
  return isLocale(primary) ? primary : LANGUAGE_ALIASES[primary];
}

function storedLocale(): Locale | undefined {
  try {
    // Reading the `localStorage` property at all throws when site data is
    // blocked, so the access sits inside the try and not just the call.
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isLocale(saved) ? saved : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The locale to open in: the organizer's saved choice, then the device's own
 * language, then English.
 */
export function detectLocale(): Locale {
  return storedLocale() ?? fromLanguageTag(globalThis.navigator?.language) ?? 'en';
}

let current: Locale = detectLocale();
const listeners = new Set<() => void>();

/** The locale `t()` answers in when a call does not name one. */
export function getLocale(): Locale {
  return current;
}

/**
 * Switch language, remember the choice, and move the document with it.
 *
 * The `<html lang>` update is not optional politeness: a screen reader
 * pronounces the page in whatever language the document claims, so a
 * translated UI under `lang="en"` is worse than no translation.
 */
export function setLocale(locale: Locale): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    // Private mode refuses the write. The choice still holds for this session.
  }
  if (locale === current) return;
  current = locale;
  if (typeof document !== 'undefined') applyDocumentLocale(locale);
  for (const listener of listeners) listener();
}

/** Subscribe to locale changes. Shaped for `useSyncExternalStore`. */
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Put the locale on the document itself.
 *
 * `<html lang>` decides how a screen reader pronounces the page, and the meta
 * description is what a group chat shows when the organizer pastes the link.
 * Both are baked into index.html at build time, so without this they would
 * stay English under a translated UI. The manifest's own `lang` and
 * `description` are still build-time and are noted in reports/i18n-audit.md.
 */
export function applyDocumentLocale(locale: Locale = getLocale()): void {
  document.documentElement.lang = documentLanguage[locale];
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute('content', t('app.description', undefined, locale));
}
