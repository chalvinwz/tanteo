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
With a seed, a tournament replays bit for bit from its event log — which is also
what lets the share server treat a snapshot as authoritative.

## `rounds` on `TournamentConfig`

**Decision.** Optional. Americano derives a default from the whist rotation
(`ceil(C(n,2) / pairsPerRound)`); Mexicano leaves it unset and generates rounds
until the organizer stops.

**Why.** The brief's domain model has no round count, but Americano cannot
precompute a schedule without one. Deriving it means the common case — 8 players
on 2 courts — produces exactly 7 rounds, the rotation where everyone partners
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
