import { en } from './en.js';
import type { Strings } from './en.js';

/**
 * A deliberately small i18n layer.
 *
 * v1 ships English only, so this exists to keep every string out of the
 * components rather than to switch languages today. Adding Bahasa Indonesia
 * means adding one file and one entry in `catalogs`, and nothing else.
 */

const catalogs = { en } satisfies Record<string, Strings>;

export type Locale = keyof typeof catalogs;

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

function lookup(locale: Locale, key: string): string {
  const parts = key.split('.');
  let node: unknown = catalogs[locale];
  for (const part of parts) {
    if (typeof node !== 'object' || node === null) return key;
    node = (node as Record<string, unknown>)[part];
  }
  // A missing key returns the key itself. Loud in the UI, harmless at runtime,
  // and it shows up immediately when a translation file falls behind.
  return typeof node === 'string' ? node : key;
}

/**
 * Look up a string and fill its `{placeholders}`.
 *
 * Values are substituted literally, so a player called "{count}" would be
 * substituted once and then left alone. Interpolation runs over the template,
 * never over what it produced.
 */
export function t(
  key: StringKey,
  values?: Readonly<Record<string, string | number>>,
  locale: Locale = 'en',
): string {
  const template = lookup(locale, key);
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}
