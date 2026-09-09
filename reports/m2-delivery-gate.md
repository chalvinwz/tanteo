# M2 Delivery Gate: organizer PWA

**Result: PASS**
Date: 2026-09-09. Mode: DURING. Direction: `DESIGN.md`.
Scope: the offline organizer app (`apps/web`). The live share view is M3 and is
not claimed here.

**Design Read.** A courtside scorekeeping tool for one organizer holding one
phone in floodlight, in a floodlit-night-court visual language.
Dials: **ENERGY 3** on the score screen and the board, **ENERGY 1** on home,
setup and players; **RHYTHM 2**; **MOTION 1**.

## How this was verified

`pnpm typecheck` (both packages), `pnpm test` (168 engine tests), `pnpm build`
(112.36 kB gzip JS, 4.76 kB gzip CSS, service worker with 13 precache entries),
plus a click-through of the running app at a 380x820 viewport.

One honest note on method: the Browser pane could not paint during the
walkthrough (Claude's window was covered), so synthetic mouse clicks timed out.
Controls were therefore driven by dispatching real events on the actual
elements, which runs the same React handlers a tap runs, and every result below
was read back out of the live DOM. Rendered geometry, computed colours and
`scrollWidth` were measured in the running page, not inferred. What this method
does **not** prove is physical touch behaviour: the long-press-to-decrement
gesture in the score sheet is verified by code inspection and by its keyboard
equivalent, not by a real finger.

An earlier walkthrough attempt was discarded entirely: five UI agents were still
running and driving the same browser profile, so its observations (including a
suspected overflow) were another session's state. The run below was done after
they finished, from a cleared IndexedDB.

## Click-through, element by element

| Control | Result |
|---|---|
| `/` empty state, "Set up a tournament" | Navigates to `/setup` |
| Name field | Accepts text |
| Format Americano / Mexicano | Selects; hint text swaps to match |
| Courts stepper `+` / `-` | 1 to 2; clamps at bounds |
| Points stepper | Holds 24 |
| Rank by (3 metrics) | Selects; the PPR rationale shows for the chosen metric |
| Player name + "Add" x8 | 8 players listed, each with "Remove" |
| Draw-shape line | "Everyone plays every round" at 8 players / 2 courts |
| "Start the tournament" | Creates and navigates to `/play` |
| "Draw round 1" | Two courts drawn, "Everyone is on court" |
| Court 1 card | Opens the score sheet |
| "Add a point to Adi Bartholomew Vandersteen" x15 | 15 / 9, sums to 24 |
| Team already at 24, `+` | No change (clamped correctly) |
| Footer "Done" | Commits; sheet closes; card shows 15 and 9 |
| Escape in the sheet | Closes and commits (see fix 3 below) |
| "Start round 2" | Disabled with "Score every court first" until both courts are in, then draws round 2 |
| Bottom nav Score / Players / Board | All three navigate; active item marked by colour, weight, a top marker and `aria-current` |
| "Add player" | Sheet opens with the seed already on "Middle of the pack" and "Joins round 2" shown before confirming |
| "Add player" confirm | Budi added at 0 Rds / 0 Pts; seed not shown anywhere on the board |
| "Substitute" on Eko | Sheet titled "Who takes over from Eko?" with the keeps-his-points explanation |
| "Swap them in" | Eko: 1 Rds, 18 Pts, "Replaced by Fajar", "Stats frozen at round 1". Fajar: 0 Rds, "In for Eko" |
| Board | Ranked by PPR, leader labelled "Leading", Eko still listed with his 18 points |
| Hard reload on `/board` | Resumes from IndexedDB |
| `/play` with no tournament | Redirects to `/` (replace), shows the empty state |
| `/t/:token` | Says the share link is not wired up yet. No fake live view |
| `/nope` | "No such screen" plus a real anchor to `/` |

Console: no errors or warnings at any point.

Correctness spot-check against the engine: after round 1 the standings were
Dewi 18, Eko 18, Adi 15, Bartholomew 15, Cahya 9, Hana 9, Bima 6, Gita 6, and
round 2 court 1 was drawn as Dewi + Bartholomew vs Eko + Adi. That is 1st+4th vs
2nd+3rd, exactly the Mexicano rule.

## Defects found and fixed during the gate

1. **`board.tsx` had its own private `Screen`**, so it would not have shared the
   header frame with the other four screens. Now imports the shell's.
2. **"Needs 1 rounds to reach the podium."** Reworded to the attributive form,
   "Short of the 1-round bar for the podium, with 0 played", which reads
   correctly at every count without a plural rule.
3. **A "Save" button that was not a save.** The sheet commits on every exit
   (Escape, backdrop, header, footer), which is right courtside because no tap
   can be lost. But a control labelled Save implies Escape discards, and the
   header carried a second control doing the identical thing. The footer is now
   the single primary "Done" and the duplicate header control is suppressed.
4. `newId()` used `'randomUUID' in crypto`, which narrows `crypto` to `never` in
   the else branch and broke the non-secure-context fallback.
5. Eight i18n keys the screens referenced were missing from the catalog.

## Block 1: Hard Gate (all answers must be no)

- [no] Em dash anywhere in UI text. *(R-02)* Verified: `grep` for U+2014 across
  `apps/web/src` returns nothing. The one `&minus;` is the stepper's glyph.
- [no] Horizontal overflow or broken mobile layout. *(R-03)* Measured in the
  running app at 380px on every screen: `documentElement.scrollWidth` is 380 and
  `window.innerWidth` is 380 on home, setup, play, players and board. The board
  drops its Diff column at the narrow width instead of scrolling sideways.
- [no] Statistics without a source. *(R-17)* Every number on screen is computed
  by the engine from scores the organizer entered.
- [no] Fictional testimonials. *(R-18)* None exist.
- [no] Assets invented without instruction. *(R-23)* The icon was explicitly
  approved by the user and designed against DESIGN.md; rationale and the
  rejected directions are in `docs/decisions.md`. No avatars, no logos, no
  invented statistics.
- [no] Nav links to nothing. *(R-24)* Three destinations, all real. `/t/:token`
  says plainly it is not open yet rather than pretending.
- [no] Text below WCAG AA. *(R-25)* Computed, not eyeballed, with the skill's
  script. Rendered values sampled from the live DOM are `rgb(242,246,250)` and
  `rgb(159,179,200)` on the court grounds: 16.21:1 and 8.18:1 on court-950,
  13.98:1 and 7.05:1 on court-800. Optic yellow is 15.31:1 on court-950 in both
  directions. **The finding that mattered:** white line-work at 0.30 alpha
  measures 2.68:1 and fails the 3:1 non-text bar, so interactive borders use a
  separate 0.40 token at 3.75:1 and the quieter tokens are reserved for
  decorative court rules that carry no information.
- [no] Dead controls. *(R-26)* Every control in the table above was exercised
  and did something.
- [no] Missing empty, loading or error states. *(R-27)* Every screen has all
  three, routed through one `Note` component so none can degrade into a bare
  spinner or a bare "No data". Storage-blocked is a distinct fatal state with a
  retry.
- [no] Generic FAQ. *(R-28)* No FAQ exists.
- [no] Keyboard-inoperable or invisible focus. *(R-32)* Focus ring measured on a
  focused element in the running app: `rgb(216, 255, 46) solid 3px`, offset 2px.
  A scan of every loaded stylesheet found zero `outline: none` or `outline: 0`.
  Escape closes the sheet, Tab is trapped inside it, and focus returns to the
  opener on close. The score sheet's long-press has explicit keyboard-reachable
  `+` and `-` buttons with names like "Take a point back from Cahya Hana".
- [no] Feature added by patch script. *(R-33)* Everything is in source. The one
  script, `make-icons.mjs`, generates image assets and rewrites nothing.
- [no] A broken theme. *(R-34)* One theme ships, dark, and the reason is in
  DESIGN.md: social padel ends under floodlights. Not a trend default.
- [no] Delivered without running it. *(R-35)* Built, run, and clicked through as
  recorded above, with the method's one limitation stated.
- [no] Fabricated claims. *(R-36)* None.
- [no] Built without direction. *(R-37)* `DESIGN.md` predates the UI and was
  committed in M0.
- [no] Realistic-looking fabricated content. *(R-38)* Source contains no seeded
  player data; this was checked by grep after demo tournaments appeared in the
  browser. They came from agents testing their own screens and lived only in
  IndexedDB.

## Block 2: Purpose-Gate

- [no] Gradients or glow as a default. None anywhere. Flat court surfaces only.
- [no] Generic or library icons. No icon library is installed. The app ships
  almost no glyphs: the stepper's `+` and `&minus;`, and that is it.
- [no] Monospace-as-aesthetic or unexplained typeface. The system stack is used
  for a stated reason: this app must boot with no network, so a CDN webfont is
  not available to it. Recorded in `docs/decisions.md`, along with the cost.
- [no] Background grid or pattern. The court lines are structural dividers, not
  a texture behind content.
- [no] Decorative arrows. None.
- [no] Decorative badges. Three status badges exist, all carrying real state:
  Playing, Paused, Left, plus "Short of rounds" and "Leading".
- [no] Glassmorphism. Not used.
- [no] Shadow on everything. Exactly one element carries a shadow, the Sheet,
  because it is the only surface that lifts above the page.
- [no] Glow. Not used.
- [no] Identical cards with no hierarchy. Court cards are uniform because the
  courts genuinely are peers; the score is the hero within each.
- [no] Template animations or a contradicted MOTION dial. Exactly two animations
  exist, both named in DESIGN.md: the score tick and the court resort. Both
  respect `prefers-reduced-motion`. Nothing else moves, no fade-ins, no hover
  scale, no skeleton shimmer.
- [no] Generic illustrations. None.

## Block 3: Liveliness (all answers must be yes)

- [yes] Dials declared, at the top of this report.
- [yes] Output matches the dials. The score screen and board carry the large
  numerals and the accent; setup and players are quiet. Motion is the two
  allowed animations and no more.
- [yes] One focal point per screen: the score on a court card, the leader on the
  board, the primary action on setup.
- [yes] Whitespace is structural, set by the court-line rules that divide
  regions the way lines divide a court.
- [yes] One deliberate accent. Optic yellow appears on the primary action, the
  active nav item, the leader, and scores. Nowhere else.
- [yes] Identity motif: the hairline court rule, repeated as the divider at
  every level, from the header down to the split between the two teams in the
  score sheet.
- [yes] Design Read declared before generation.

## Block 4: Craftsmanship and Quality Locks (all answers must be no)

- [no] C-1 decisions justified only by "AI default". Every token in
  `styles.css` carries its reason inline.
- [no] C-2 non-functional elements.
- [no] C-3 template sections. Five screens, each because the organizer needs it.
- [no] C-4 breaks in a state, theme, breakpoint or without a mouse.
- [no] C-5 fabricated evidence.
- [no] R-05 AI template layout. No hero, no feature grid, no pricing, no footer.
- [no] R-11 everything pill-shaped. Three radii, used as hierarchy: 2px court
  boxes, 6px controls, 14px the one lifting sheet.
- [no] R-15 generic CTAs. "Set up a tournament", "Draw round 1", "Start round 2",
  "Swap them in".
- [no] R-16 buzzwords.
- [no] R-20 generic with the name swapped. The court ground, the line-work and
  the optic accent are specific to padel after dark.
- [no] R-21 dark forced without reason. The reason is the product's setting.
- [no] R-29 palette over budget. Two core surfaces plus ink and one accent.
- [no] R-30 clone of another product.
- [no] R-31 a decision whose reason cannot be written in one line.

## Carried into M3 and M4, stated rather than hidden

- The display face is the system stack, so the numerals are less distinctive
  than DESIGN.md asks for. One-file exit documented.
- Long-press decrement is verified by inspection and by its keyboard
  equivalent, not by physical touch.
- Lighthouse CI, installability on a real device, and the offline cold boot
  against a built service worker are M4 gates and are not claimed here.
