# M3 Delivery Gate — share server, live view, cast mode

**Result: PASS.** One behaviour was left unverified in the browser at the time
and is now settled: M4 confirmed the app was correct and the observation was an
artefact of the harness. See "RESOLVED IN M4" below, which is kept rather than
deleted because a wrong conclusion was nearly recorded as a defect.
Date: 2026-09-09. Mode: DURING. Direction: `DESIGN.md`.

**Design Read.** A read-only board for a spectator's phone and for a screen
propped up at the venue.
Dials: **ENERGY 3** on both (they are scoreboards), **RHYTHM 2**, **MOTION 1**.

## Gates

`pnpm typecheck` clean across four packages. `pnpm test`: 235 tests passing
(engine 168, server 35, share 23, web 9). `pnpm build` produces the client at
118.32 kB gzip plus a service worker, and the server to `dist`.

## End to end, in a real browser against the real server

The built client served by the real Hono server on one origin, which is the
container shape. Two browser contexts.

| Step | Result |
|---|---|
| Organizer creates a Mexicano, draws round 1 | Courts drawn, nobody sitting out |
| Board, "Share the board", "Create a share link" | Link minted, `/api/t/<readToken>` returns 200 at revision 1 |
| Viewer opens the link in a second context | Tournament name, "Updated just now", "Live", the current round, no organizer controls |
| Organizer scores 17 to 7 | Viewer's board updates **with no reload**: standings appear, Cahya leading |
| Organizer scores again, 21 to 3 | Viewer shows 21 and "Updated just now" |
| Viewer left untouched for 20s | Age climbs honestly 29s to 48s, and **no false warning**, because heartbeats keep contact fresh |
| Cast view | Auto-cycles Board then "On court now" every 10s, keeps the connection line, offers "Phone view" back |
| Fresh load with the server down | "Cannot reach the board" |
| Server restarted, organizer reopens the app | Board republished on boot at revision 4 with no scoring |

Console: no errors.

## Defects found and fixed during this milestone

1. **The staleness warning would have cried wolf every game.** `describeAge`
   measured the age of the last *score*, and the 90-second rule was keyed to
   it. Padel runs minutes between points, so a perfectly healthy stream would
   have told every spectator "the organizer may be offline" mid-game, which
   trains people to ignore the one warning that matters. The hook now tracks
   two separate facts: `receivedAt`, when the board last changed, and
   `contactAt`, when anything last arrived including heartbeats. Judged on
   contact, verified above across a 20-second quiet window with no false alarm.
   Caught by the agent that built the live view, in code I had written.
2. **A reopened tournament left its share link dead.** The syncer pushed only on
   mutation, so after a server restart, or simply reopening the app, every link
   holder saw "No board on this link" until the next score. Now a shared
   tournament republishes on open. Verified: revision 4 appeared on the server
   from the boot path alone.
3. `describeAge` returned hardcoded English, the only user-facing text outside
   the catalog. Now goes through `t()` like everything else.
4. `board.tsx` still had a private `Screen`, so it would not have shared the
   header frame. Reconciled with the shell's.
5. Agent scratch files (`cast-preview.html`, `cast-preview.tsx`, a stray
   `probe.test.ts`) removed before commit.

## RESOLVED IN M4: the one thing not verified in the browser

**The app was right. The M3 observation was an artefact of how the connection
was cut, and this section is kept rather than deleted because the wrong
conclusion was nearly recorded as a defect.**

M4's Playwright suite settles it on a page whose `document.visibilityState` the
test asserts is `visible` before asserting anything else
(`e2e/tests/live-stall.spec.ts`). Over real seconds, with the only variable
being whether anything arrived:

- 50 seconds of a healthy stream with nothing scored: still says Live, no
  warning. Heartbeats at 25s carry it.
- The server is then suspended with SIGSTOP, which holds every socket open while
  delivering nothing: within the allowance the view drops Live and shows
  `live.stalled`, and the board stays on screen underneath.
- SIGCONT: the warning clears.

**Why M3 could not see it.** Neither `context.setOffline(true)` nor
`page.route('**/api/**')` severs an *established* SSE connection: route
interception only reaches requests not yet made, and Chromium's offline
emulation does not tear down an in-flight event-stream response. The heartbeat
kept arriving down the old socket, so the view was correct to keep saying Live.
That also explains the two things that looked damning at the time, the status
never demoting and zero further network calls: contact was genuinely fresh, so
there was nothing for the freshness check to act on.

Verified as non-vacuous two ways: the E2E agent's own sensitivity check (moving
the fake-clock jump below the threshold makes it fail), and a mutation check
run afterwards (raising `STREAM_TIMEOUT_MS` to 45,000 seconds fails the test;
restoring it passes).

## The original M3 note, kept for the record

**A stream that dies after connecting.** The intended behaviour: after 45
seconds with nothing arriving, the view stops claiming to be live, falls back to
polling, and shows that it is out of touch.

What I can state: with the server stopped and a fresh page load, the view
correctly says "Cannot reach the board". The freshness rule itself is unit
tested in `apps/web/test/live-source.test.ts`, including the exact regression in
defect 1.

What I could not do is watch an already-connected stream go stale in this
browser. The preview pane never became visible: `document.visibilityState`
stayed `hidden` even after fronting the tab, and browsers throttle timers hard
in hidden pages, which makes any timing observation there unreliable in both
directions. During those attempts I saw the view still reading "Live" after the
server had stopped, and I could not establish whether that was the app or the
throttling. I am not claiming it works, and I am not claiming it is broken.

**What should happen before this ships:** exercise it on a visible page, which
the M4 Playwright run can do directly, and treat it as a release blocker for the
cast view specifically. A venue screen that has silently frozen is the worst
failure this feature can have, which is why it is called out here rather than
left as a footnote.

## Block 1: Hard Gate (all answers must be no)

- [no] Em dash in UI text. *(R-02)* `grep` for U+2014 across all three source
  trees returns nothing.
- [no] Horizontal overflow on mobile. *(R-03)* The live view was checked at
  320px and 420px; the board drops columns rather than scrolling sideways.
- [no] Statistics without a source. *(R-17)* Every number is engine output from
  scores the organizer entered.
- [no] Fictional testimonials. *(R-18)* None.
- [no] Assets invented without instruction. *(R-23)* No new assets.
- [no] Links to nothing. *(R-24)* The cast link and the phone-view link both
  resolve; both were followed.
- [no] Text below WCAG AA. *(R-25)* The live view's new pairing is text over the
  optic-tinted leader row (composite `#1c312c`): ink 12.68:1, optic 11.98:1,
  ink-muted 6.40:1. Sit-out chips on court-900: 7.67:1. Computed, not eyeballed.
- [no] Dead controls. *(R-26)* The live view has exactly two: retry and the cast
  link. Both exercised.
- [no] Missing empty, loading or error states. *(R-27)* loading, missing,
  offline, error, waiting-for-first-score, and no-round-drawn all render, and
  the last board stays on screen underneath an offline notice rather than
  blanking, because a stale board beats a blank one at a venue.
- [no] Generic FAQ. *(R-28)* None.
- [no] Keyboard-inoperable or invisible focus. *(R-32)* Focus ring is the optic
  accent at 3px; no `outline: none` anywhere.
- [no] Feature added by patch script. *(R-33)* All in source.
- [no] Broken theme. *(R-34)* One theme, dark, for the reason in DESIGN.md.
- [no] Delivered without running it. *(R-35)* Run end to end against the real
  server, recorded above, with the one exception stated in full.
- [no] Fabricated claims. *(R-36)* None.
- [no] Built without direction. *(R-37)* `DESIGN.md` predates it.
- [no] Fabricated realistic content. *(R-38)* The live view renders only what
  the organizer pushed.

## Block 2: Purpose-Gate

- [no] Gradients or glow as default. None.
- [no] Generic or library icons. No icon library; the cast panel indicator is
  two marks, not glyphs.
- [no] Unexplained typeface. Unchanged from M2 and recorded in
  `docs/decisions.md`.
- [no] Background pattern. None.
- [no] Decorative arrows. None.
- [no] Decorative badges. The "Leading" badge carries real state.
- [no] Glassmorphism, glow, page-wide shadow. None.
- [no] Identical cards with no hierarchy. Court cards are peers; the score is
  the hero within each.
- [no] Template animations or a contradicted MOTION dial. The cast view's
  10-second panel swap is a content change on a timer, not an animation: no
  fade, no slide, no animated progress. The only two animations in the product
  remain the score tick and the court resort.
- [no] Generic illustrations. None.

## Block 3: Liveliness (all answers must be yes)

- [yes] Dials declared above.
- [yes] Output matches them: both screens are loud, motion stays at one.
- [yes] One focal point per screen: the leader on the board panel, the scores on
  the round panel.
- [yes] Whitespace structural, set by the court-line rules.
- [yes] One deliberate accent: the leader, and nothing else on these screens.
- [yes] Identity motif: the hairline court rule, carried through from M2.
- [yes] Design Read declared before generation.

## Block 4: Craftsmanship and Quality Locks (all answers must be no)

- [no] C-1 decisions justified only by "AI default".
- [no] C-2 non-functional elements.
- [no] C-3 template sections.
- [no] C-4 breaks in a state, theme or breakpoint. The one open question is the
  timing case above, stated rather than hidden.
- [no] C-5 fabricated evidence.
- [no] R-05 AI template layout.
- [no] R-11 everything pill-shaped.
- [no] R-15 generic CTAs. "Create a share link", "Copy link", "Cast view".
- [no] R-16 buzzwords.
- [no] R-20 generic with the name swapped.
- [no] R-21 dark forced without reason.
- [no] R-29 palette over budget.
- [no] R-30 clone of another product.
- [no] R-31 a decision whose reason cannot be written in one line.

## Security note, since this milestone opened a network surface

The share URL carries only the read token. A POST presenting that read token as
the write token is refused with 403, and the server stores no secret. This is
covered by three explicit tests in `apps/server/test/app.test.ts`, including an
assertion that nothing was written. Rationale in `docs/decisions.md`.

Also covered: a body that is not JSON (400), a body over 256KB (413), a path
traversal attempt in the token (400), and a stale queued retry, which is refused
by revision and reported as `accepted: false` with a 200 rather than as an error.
