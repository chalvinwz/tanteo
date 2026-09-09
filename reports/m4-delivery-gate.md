# M4 Delivery Gate — shipping polish

**Result: PASS.**
Date: 2026-09-09. Mode: DURING. Direction: `DESIGN.md`.
Scope: PWA installability, i18n extraction, the container image, self-hosting
docs, and the end-to-end suite. M4 added no new screens, so the design blocks
below re-check the shipped surface rather than new work.

## The gates the brief asked for

| Gate | Result |
|---|---|
| PWA installable | **Yes.** Chrome reports no installability errors; manifest served, service worker registered and controlling the page |
| Accessibility >= 90 | **100** on `/`, `/setup` and a share link |
| Playwright e2e | 6 tests, all passing, including the brief's required scenario |
| `docker buildx` multi-arch | `linux/amd64` and `linux/arm64` both build |
| typecheck / unit tests | Clean; 235 tests across four packages |

Lighthouse also reports best practices 100 and SEO 0.91 on all three URLs.
Performance lands at 0.87 to 0.89 against a 0.9 target and is configured as a
warning, not an error, because the brief gates installability and accessibility
and does not gate performance. It is left visible rather than tuned away.

## The release blocker from M3 is settled, and the app was right

M3 could not establish whether a live view whose stream dies stops claiming to
be live. It now can, on a page the test asserts is `visible` before it asserts
anything else:

- 50 real seconds of a healthy stream with nothing scored: still says Live, no
  warning. Heartbeats carry it. This is the "does not cry wolf" half at full
  scale.
- The server is suspended with `SIGSTOP`, which holds every socket open while
  delivering nothing: the view drops Live and shows `live.stalled`, with the
  board still on screen underneath.
- `SIGCONT`: the warning clears.

**Why M3 saw what it saw.** Neither `context.setOffline(true)` nor
`page.route('**/api/**')` severs an established SSE connection. Route
interception only reaches requests not yet made, and Chromium's offline
emulation does not tear down an in-flight event-stream response. The heartbeat
kept arriving down the old socket, so the view was correct to keep saying Live,
and the "zero further network calls" that looked damning was the freshness check
correctly having nothing to act on.

Confirmed non-vacuous twice: the E2E author's own sensitivity check (moving the
fake-clock jump below the threshold makes it fail), and a mutation check run
afterwards, raising `STREAM_TIMEOUT_MS` to 45,000 seconds, which fails the test;
restoring it passes.

## The e2e suite

Six tests, one command, chromium at 390x844 with touch. The config builds and
starts the real server, so the suite exercises the container shape rather than a
dev server.

1. **The brief's required scenario, unbroken:** create a tournament, score a
   round, add a late joiner, verify board order under PPR, open the share link
   in a genuine second `browser.newContext()`, and watch the untouched viewer
   receive the next score with no reload.
2. **Live stall**, above, in two forms: a fast fake-clock regression guard and
   the slow wall-clock one.
3. **Offline resume** with the service worker enabled and the network cut: the
   tournament comes back from IndexedDB and the precached shell.
4. **Substitution**, the product thesis: the outgoing player keeps their points,
   keeps their row, is badged as left, and is still the leader; the newcomer
   starts at zero.
5. **Keyboard:** Escape closes the score sheet, returns focus to the court card,
   and keeps the point that was entered.

Copy is imported from `apps/web/src/i18n/en.ts` rather than retyped, so a future
copy change cannot turn these green for the wrong reason.

## The container

Verified by building and running it, not just by writing it:

- `docker buildx --platform linux/amd64,linux/arm64` builds both. The arm64 leg
  is file copies rather than a compile under emulation, because nothing in the
  tree is a native addon. That was the reason for choosing `node:sqlite` back in
  M0 and it is the payoff.
- The build stage runs on `BUILDPLATFORM`, so TypeScript compiles once instead
  of once per target; `pnpm deploy --prod` resolves the runtime tree separately,
  so vite, vitest and the type packages never reach the final layer. 171 MB.
- Running: the API answers, the client and its assets are served, a share link
  falls back to the app shell, and a snapshot written before a container restart
  is still there afterwards.
- Inside the container, a POST presenting the read token as the write token is
  refused with 403.

## i18n

`reports/i18n-audit.md` found ten sites where user-facing English could not be
reached by editing `i18n/` alone. All ten are addressed:

- The stepper's two `aria-label`s now come from the catalog. They were the only
  accessible name on those buttons, so a screen reader on a translated build
  would have read "Lapangan: one less".
- Four sites rendered raw `Error.message` as body copy, which meant the engine's
  developer English ("courts must be an integer >= 1, got 0") reached users and
  would have survived translation untouched. They now show a translated sentence.
- `<html lang>` and the meta description are set at runtime from the catalog via
  `applyDocumentLocale()`. The document language decides how a screen reader
  pronounces the page, so it has to move with the copy.

Still build-time and documented rather than fixed: the web app manifest's own
`lang` and `description`. Changing those per locale needs build-time templating,
which is real work with no consumer until a second catalog exists.

A key-coverage pass confirms all 150 referenced keys exist, so nothing renders
as a raw dotted path.

## Block 1: Hard Gate (all answers must be no)

- [no] Em dash. *(R-02)* `grep` for U+2014 across source, README, reports and
  e2e returns nothing.
- [no] Broken mobile layout. *(R-03)* The e2e suite runs at 390x844 with touch.
- [no] Statistics without a source. *(R-17)* The README cites no user numbers,
  no benchmarks and no badges, because there are none to cite.
- [no] Fictional testimonials. *(R-18)* None.
- [no] Assets invented without instruction. *(R-23)* No new assets.
- [no] Links to nothing. *(R-24)* README links point at files in this repo.
- [no] Text below WCAG AA. *(R-25)* Lighthouse accessibility 100 on all three
  URLs.
- [no] Dead controls. *(R-26)* Unchanged surface, exercised by the e2e suite.
- [no] Missing empty, loading or error states. *(R-27)* Unchanged, and the four
  raw-error sites now carry a written sentence instead of a developer string.
- [no] Generic FAQ. *(R-28)* None.
- [no] Keyboard-inoperable or invisible focus. *(R-32)* Covered by an e2e test
  and by Lighthouse.
- [no] Feature added by patch script. *(R-33)* Everything in source.
- [no] Broken theme. *(R-34)* One theme, for the reason in DESIGN.md.
- [no] Delivered without running it. *(R-35)* Image built and run, e2e run four
  times green, Lighthouse run, installability confirmed against a live server.
- [no] Fabricated claims. *(R-36)* Every number in this report came from a
  command run in this session.
- [no] Built without direction. *(R-37)* `DESIGN.md` predates all of it.
- [no] Fabricated realistic content. *(R-38)* None.

## Block 2: Purpose-Gate

No new UI was added in M4, so the M3 answers stand unchanged: no gradients,
glow, glass, page-wide shadow, icon library, background pattern, decorative
arrows or badges, and no animation beyond the score tick and the court resort.

## Block 3: Liveliness (all answers must be yes)

- [yes] Dials declared in the M2 and M3 reports and unchanged.
- [yes] Output still matches them.
- [yes] One focal point per screen.
- [yes] Whitespace structural.
- [yes] One deliberate accent.
- [yes] Identity motif: the hairline court rule.
- [yes] Design Read declared before generation.

## Block 4: Craftsmanship and Quality Locks (all answers must be no)

- [no] C-1 decisions justified only by "AI default".
- [no] C-2 non-functional elements.
- [no] C-3 template sections. The README has no section that exists because
  READMEs usually have one.
- [no] C-4 breaks in a state, theme, breakpoint or without a mouse.
- [no] C-5 fabricated evidence.
- [no] R-05 AI template layout.
- [no] R-11 everything pill-shaped.
- [no] R-15 generic CTAs.
- [no] R-16 buzzwords, in the UI or in the README.
- [no] R-20 generic with the name swapped.
- [no] R-21 dark forced without reason.
- [no] R-29 palette over budget.
- [no] R-30 clone of another product.
- [no] R-31 a decision whose reason cannot be written in one line.

## Carried forward, stated rather than hidden

- The display face is still the system stack. DESIGN.md asks for a distinctive
  one; a webfont cannot be fetched by an app whose premise is booting with no
  signal, and self-hosting one means adding a binary nobody has chosen.
  One-file exit documented in `docs/decisions.md`.
- Lighthouse performance sits at 0.87 to 0.89. Not a gate, and not tuned away.
- The manifest's `lang` and `description` remain build-time, as above.
- The e2e suite takes about 1.8 minutes, dominated by the one wall-clock test.
  That test is slow because the rule it checks is measured in real seconds, and
  it is the one failure in this product that would mislead a room full of people.
