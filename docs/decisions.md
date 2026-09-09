# Decisions

Short records of choices that are easy to second-guess later. Each one names the
deciding factor, not just the outcome.

## Seeded PRNG in engine state

**Decision.** `TournamentConfig` carries a `seed`, and a serializable cursor
lives in `TournamentState.rng`. The engine never calls `Math.random` or reads a
clock.

**Why.** Mexicano round 1 is specified as random, and Americano breaks pairing
ties randomly. Both would make the engine unreplayable, which would in turn make
the golden fixture a snapshot of one lucky run rather than an executable spec.
With a seed, a tournament replays bit for bit from its event log, which is also
what lets the share server treat a snapshot as authoritative.

## `rounds` on `TournamentConfig`

**Decision.** Optional. Americano derives a default from the whist rotation
(`ceil(C(n,2) / pairsPerRound)`); Mexicano leaves it unset and generates rounds
until the organizer stops.

**Why.** The brief's domain model has no round count, but Americano cannot
precompute a schedule without one. Deriving it means the common case, 8 players
on 2 courts, produces exactly 7 rounds, the rotation where everyone partners
everyone once.

## Hand-rolled router, not `react-router-dom`

**Decision.** A ~40-line router behind `<Link>` and `useRoute()`.

**Why.** Seven flat routes, one dynamic param, no nested data loading. The
dependency would be the heaviest single item in the client bundle on a product
whose stated problem is unreliable courtside data. It also keeps the service
worker's navigation fallback free of a second opinion about history.

**Cost accepted.** We own popstate, link interception and 404 handling. The
Playwright e2e covers navigation, so these get exercised.

**Exit.** The API surface deliberately mirrors react-router's. Swapping in the
real thing, if nested layouts ever justify it, is one file.

## `node:sqlite`, not `better-sqlite3`

**Decision.** Node's built-in SQLite, behind a `SnapshotStore` interface.

**Why.** The multi-arch `docker buildx` gate is the deciding factor: a native
addon is the most likely thing to make the arm64 leg slow or broken, and the
server's storage need is one table (`token -> snapshot JSON, updated_at`). No
feature depth is being given up at that scale. Verified on Node 24.15.0: WAL,
prepared statements, upsert and a `backup` API all present, no experimental
warning.

**Exit.** `SnapshotStore` is `get` / `put` / `subscribe`. Swapping drivers is one
file.

## Archivo Black for the numerals, not the system stack

**Decision.** Score numerals are set in Archivo Black (Omnibus-Type, drawn by
Hector Gatti, version 1.006), self-hosted at
`apps/web/public/fonts/archivo-black-numerals.woff2` and reached through a new
`--font-display` token. `--font-sans` is untouched, so every word in the app is
still the platform grotesque and only the numbers changed. The licence is the
SIL Open Font License 1.1: `OFL.txt` sits beside the binary, and the copyright
and licence notices are kept inside the subset's own name records.

**Why this face.** DESIGN.md asks for "oversized tabular-lining numerals in one
distinctive display face", and the word carrying the weight is tabular. A digit
that changes width as it ticks is the defect `.numeral` exists to prevent, and
the faces you reach for first cannot do it. Oswald, Big Shoulders, Teko, League
Gothic and Saira Condensed are all condensed signage gothics that would suit a
floodlit court, and every one of them ships proportional digits with no `tnum`
feature at all, so their 1 is a third narrower than their 7 and no CSS can
correct it. Sixty cuts were measured through the Google Fonts API by reading
the digit advances straight out of the served binary. Eleven are tabular by
default. Most of those eleven are text grotesques wanting a job they were not
drawn for (Chivo, Familjen Grotesk, Host Grotesk, Archivo Narrow) or the
platform default in another coat (Roboto Condensed); of the display faces that
remain, Bebas Neue is condensed but too light in the stroke to carry a court,
and Funnel Display is rounded and softer still. Archivo Black is the one with
the ink. Every digit in it is 667/1000 em and it carries no `tnum` to negotiate
over, so a score is tabular before CSS asks for anything. It is also not on the
default roster antislop R-06 calls out.

**Size, because this app loads on bad courtside data.** The source is the
upstream Google Fonts repository, `ofl/archivoblack/ArchivoBlack-Regular.ttf`,
90,988 bytes. `pyftsubset` cuts it to the seventeen characters a score can
contain (ten digits, plus, hyphen, minus, full stop, comma, space, no-break
space) and re-flavours it as woff2: **3,596 bytes**, 18 glyphs. The latin cut
the same source serves from its CDN is 9,792 bytes, so the subset saves 6,196
bytes of it. The face now costs less than the three app icons together and
under 1% of the 408 KB precache. The `unicode-range` in `styles.css` is that
character list written down, so regenerating the file needs no separate note.

**Why self-hosted.** The app has to boot with no network, which is what deferred
this decision in the first place. Workbox already globs `woff2`, so the file is
a precache entry and is on the device before the first dead spot rather than
being fetched at the moment it is needed. `font-display: swap` with the
grotesque behind it: a late score beats a missing one.

**Verified** against the production build, served over HTTP and driven to a
real score. `document.fonts` reports the face loaded, `.numeral` computes to
it, and all ten digits measure 64.032 px at 96 px. The score sheet numeral held
112.87 px across eight consecutive ticks from 11 to 18. The same measurement on
the fallback, system-ui at weight 800 with the feature switched off, spreads
17.3 px, which is why `font-variant-numeric: tabular-nums lining-nums` stays in
the rule: a no-op on Archivo Black, load-bearing on the grotesque behind it.
Built under `TANTEO_BASE=/tanteo/` the CSS asks for
`/tanteo/fonts/archivo-black-numerals.woff2`, so the absolute URL does not
break the subpath build.

**Cost accepted.** Three things, all small and all sharp. The face is
registered `usWeightClass` 400 despite being black, so the `@font-face` has to
claim the 400 to 900 range or the browser paints synthetic bold on top of a
face that is already black; anyone editing that rule needs to know why the
range is there. The subset covers numerals only, so a non-numeral character
placed inside `.numeral` renders in the grotesque quietly rather than failing
where someone would see it. And on a cold first paint the grotesque shows
first, which shifts the `ch`-width columns on the cast screen once when the
real face arrives.

**Exit.** Still one file. Drop a different `.woff2` into
`apps/web/public/fonts/` and change the family name in the two declarations
that carry it, `@font-face` and `--font-display`. Nothing in the app references
the face.

## The app icon: a court whose net has moved

**Decision.** A padel court seen from above, drawn at its real 1:2 proportion in
thin white line-work, with the net as a bar of optic yellow overhanging its
posts. The net sits at 62% of the court's length, not at 50%. Generated by
`scripts/make-icons.mjs`, with `apps/web/public/favicon.svg` carrying the same
geometry by hand.

**Why.** The user approved a real mark, so this is a designed identity rather
than the placeholder it replaces. A court on its own belongs to any padel app.
DESIGN.md reserves the optic accent for "scores in motion", and a displaced net
is the smallest possible way to draw a score: the court is the product's
subject, the offset is the product's job. The net overhang is what a real net
does, and it also stops the outline reading as a door.

Rejected along the way, each for a reason worth keeping: stacked score bars
(read as a menu icon), a half-filled court (read as a window), tramlines only
(read as a letter H), a monogram (read as a plus sign), and the court with
service lines (too busy below 192px).

**Why a script.** The geometry stays identical across sizes, and the maskable
safe area is computed rather than guessed: the same drawing shrinks to 58% of
the canvas so a launcher's circular crop never clips the net.

## Two share tokens, not one

**Decision.** The organizer's device holds a 32-byte `writeToken`. The share URL
carries `readToken = SHA-256(writeToken)`. The server stores snapshots under the
read token and, on a write, checks that the SHA-256 of the presented write token
equals the read token in the path.

**Why.** The brief says capability URLs and no auth, which taken literally means
one token in the URL. That token would then be both the viewing credential and
the writing credential, so every spectator the link is forwarded to could
overwrite the tournament. A link pasted into a group chat should not be a write
key.

Two tokens fix it without adding accounts, sessions or state: the server stores
no secret, needs no user table, and still cannot be written to by someone who
only has the link. Recovering the write token from the read token is a preimage
attack on SHA-256.

Verified: a POST presenting the read token as the write token returns 403, a
POST with no write header returns 401, and a correct write returns the exact
bytes on the following GET.

**Cost accepted.** An organizer who loses their device loses the ability to push
to that link, because the write token lived only there. That is the same
trade-off as any capability model with no account to recover from, and it is the
right one for a product whose whole premise is no accounts.

## Snapshot bodies are opaque to the server

**Decision.** The server stores the posted JSON as text and never parses a
tournament. The revision travels in a header, not by reading the body.

**Why.** The engine is the only place the rules live. A server that understood
`TournamentState` would be a second implementation waiting to disagree with the
first. The one exception is a `JSON.parse` on write whose result is discarded:
that is a validity check so a viewer is never handed something unparseable, not
an interpretation.

Refusing a stale write is therefore a comparison of two integers, which is all
"last write from the one organizer wins" needs.
