# i18n audit: user-facing English outside `t()`

Date: 2026-09-09. Scope: `apps/web`, every file, at commit `6eeea76`.

DESIGN.md commits to "English for v1; every string externalized so Bahasa
Indonesia can follow." This audit asks one question of each user-facing string:
**could a translator reach it by editing `apps/web/src/i18n/` alone?** If not, it
is listed below.

## How this was checked

Every one of the 20 files under `apps/web/src`, plus `apps/web/index.html` and
`apps/web/vite.config.ts`, was read in full. That was backed by three mechanical
passes so nothing was missed by eye:

- every string literal containing two or more adjacent words, with Tailwind
  class strings and comment bodies filtered out;
- every accessible-name attribute (`aria-label`, `placeholder`, `alt`, `title`,
  `aria-valuetext`) across the tree;
- every bare JSX text node, of which there are none but the `+` and `&minus;`
  glyphs.

A key-coverage pass was also run: **150 keys are referenced and all 150 exist in
the catalog**, so nothing renders as a raw dotted path today.

`en.ts` itself is not a finding. It is the catalog, and being English is its job.

## Findings

Ten sites, in four groups. Nothing here is speculative; each was traced to
something a person actually sees or hears.

| File | Line | The literal | Genuinely user-facing? |
| --- | --- | --- | --- |
| `apps/web/src/components/primitives.tsx` | 204 | `` aria-label={`${label}: one less`} `` | **Yes.** The stepper's decrement button. Its only accessible name; the visible glyph is `&minus;`. A screen reader on the BI build reads "Lapangan: one less". |
| `apps/web/src/components/primitives.tsx` | 218 | `` aria-label={`${label}: one more`} `` | **Yes.** Same control, increment side. |
| `apps/web/index.html` | 9 | `Padel Americano and Mexicano scorekeeping that survives a changing roster.` | **Yes.** The meta description: link previews when the organizer pastes the app URL into a group chat, and search results. |
| `apps/web/index.html` | 2 | `<html lang="en">` | **Yes**, though not a string. It declares the language of every word on the page. Serving BI copy under `lang="en"` makes a screen reader pronounce Indonesian with an English voice, and breaks hyphenation and translation offers. |
| `apps/web/vite.config.ts` | 23 | `description: 'Padel Americano and Mexicano scorekeeping that survives a changing roster.'` | **Yes.** Web app manifest. Shown in the install dialog and in the OS app listing after install. |
| `apps/web/vite.config.ts` | 24 | `lang: 'en'` | **Yes**, same class as the `<html lang>` above, for the installed app. |
| `apps/web/src/screens/home.tsx` | 161 | `body={failure}` | **Yes.** `failure` is `error.message` from a failed IndexedDB open or delete (home.tsx:130-131). Renders the browser's own English, e.g. a `DOMException` message, as body copy under a translated title. |
| `apps/web/src/screens/play.tsx` | 59 | `body = error.message` | **Yes.** The `default` branch of `ErrorNote`. Four engine codes are mapped to `t()`; every other code prints the engine's developer sentence, e.g. `no round at index 4`. |
| `apps/web/src/screens/play.tsx` | 239 | `{ body: lastError.message }` | **Yes.** The boot-failure Note. Same raw `Error.message`, this time from storage. |
| `apps/web/src/screens/setup.tsx` | 281 | `body={lastError.message}` | **Yes.** Setup maps no codes at all, so *every* rejected `create()` shows raw engine English, e.g. `courts must be an integer >= 1, got 0`. |

On the last four rows: the literal itself lives in `packages/engine/src/*.ts` (as
`new EngineError(code, 'english sentence')`) or in the browser, not in
`apps/web`. But `apps/web` is where it is chosen and rendered, and no amount of
editing `i18n/` will change what appears there. That makes it in scope.

The four are also not equally likely. `setup.tsx:281` is the one to look at
first: it is the only feedback the setup form gives on a refused create, and it
is unconditionally raw. `play.tsx:59` is guarded by four mapped codes and is a
genuine last resort. `home.tsx:161` and `play.tsx:239` both surface storage
errors, which are already the rarest path in the app.

## Checked and deliberately not listed

Recorded so the short list reads as a decision rather than an oversight.

| Site | Why it is not a finding |
| --- | --- |
| `main.tsx:8`, `router.tsx:98`, `state.tsx:344` | Thrown developer invariants (`'#root is missing from index.html'` and two hook-misuse messages). Nothing renders them; they fire only if the app is wired up wrong. |
| `primitives.tsx:209,223`, `score-sheet.tsx:271,279` | The `&minus;` and `+` glyphs. Symbols, identical in Indonesian, and all four buttons already carry a translated accessible name (the score sheet's come from `t('score.increment')` / `t('score.decrement')`; the stepper's are rows 1 and 2 above). |
| `vite.config.ts:21-22`, `index.html:13` | `name`/`short_name`/`<title>` are all `tanteo`. The product name, the same in every language. |
| `cast.tsx:354` | `"nobody has entered this yet"` sits inside a JSX comment explaining the neighbouring branch. Not rendered. |
| `apps/web/test/live-source.test.ts` | Test file. |
| Tailwind class strings throughout | Not text. |
| `apps/server`, `packages/share` | Out of scope for this audit. Note that the server's JSON error bodies (`'no such board'`, `'malformed token'`) are read by code, never shown: `live-source.ts` branches on the HTTP status and the UI text comes from `t('live.*')`. |

## Adjacent, and not a string problem

Two things a BI release will hit that no amount of string externalisation fixes.
Flagged here because the audit is the natural place to notice them, and because
someone will otherwise find them the week the translation lands.

- **Numbers are formatted for English.** `rate()` in `board.tsx:54`,
  `live.tsx:78` and `cast.tsx:243` uses `toFixed(2)`, which always produces a
  full stop. Indonesian writes `22,75`. `signed()` (`board.tsx:59`,
  `live.tsx:83`) is fine as it stands. This wants `Intl.NumberFormat` keyed to
  the active locale, not a catalog entry.
- **There is no way to select a locale.** `t()` takes `locale: Locale = 'en'`
  (`i18n/index.ts:51`) and no caller ever passes it, so adding `id.ts` to
  `catalogs` puts the file on disk with nothing able to reach it.

## What to do

In the order that gets a BI build working, cheapest first.

1. **Two catalog entries and one component change.** Add
   `common.stepperDown` / `common.stepperUp` (or a single
   `common.stepperAdjust` pair keyed on direction) taking a `{label}`
   placeholder, and swap the two template literals in `primitives.tsx`. This is
   the only literal English left in a rendered component, and it costs ten
   minutes.
2. **Decide the policy for engine error text, then apply it in one place.** The
   engine's messages are developer diagnostics and should not be product copy in
   any language. Either map the remaining `ErrorCode`s in the catalog and drop
   the raw `message` from all four render sites, or keep the raw text but mark it
   as diagnostic (small, monospace, behind a disclosure) so it never reads as a
   sentence written for the organizer. `setup.tsx:281` is the one that matters:
   give setup the same `errorTitle(code)` switch that `board.tsx:64` and
   `players.tsx:47` already have.
3. **Give the shell a locale.** Drive `lang` on `<html>` from the active locale
   at boot, and make `t()` read a module-level current locale instead of
   defaulting its third parameter. Until this exists, step 4 has nowhere to
   plug in.
4. **Move the two descriptions and the two `lang` fields into the catalog.**
   `index.html` and the manifest are build-time, so they need a build-time
   answer rather than a runtime `t()`: either generate the manifest per locale
   from the catalog, or accept one canonical language for store metadata and say
   so in `docs/decisions.md`. Worth an explicit decision, because "the install
   dialog is always English" is defensible and "we forgot" is not.
5. **Format numbers through `Intl`** before the first non-English build, not
   after.
6. **Prune before translating.** Fourteen catalog keys are referenced nowhere:
   `app.tagline`, `common.save`, `common.round`, `common.court`, `common.points`,
   `play.matchPoint`, `score.teamA`, `score.teamB`, `score.saved`,
   `board.podium`, `share.pushedAt`, `live.pendingTitle`, `live.pendingBody`,
   `live.quiet`. Some are dead (`live.pendingTitle` and `live.pendingBody`
   describe the placeholder live view that M3 replaced); others may be intended
   for screens not yet built. Either way, sending all fourteen to a translator
   bills someone for strings nobody will read.

Nothing in this report was fixed. These files are not mine to edit.
