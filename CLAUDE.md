# tanteo

Padel Americano and Mexicano scorekeeping for social tournaments.

## The thesis

> The roster is mutable at any point during a tournament, and every point ever
> scored is attributed to the human who actually played it.

Every architecture and design decision serves that sentence. When a change seems
to pull against it, the change is wrong.

## Shape

- `packages/engine` is the product. Pure TypeScript, no DOM, no network, no
  clock, no `Math.random`. Read `packages/engine/SPEC.md` before changing it,
  and add the property test before the implementation.
- `apps/web` is a shell over the engine. It never re-implements a rule. If a
  rule seems missing, it belongs in the engine.
- `apps/server` exists only to serve the read-only live share link. The
  organizer's device is the single source of truth.

## Working agreement

- TDD the engine. Conventional commits.
- Ask before adding any runtime dependency.
- Decisions that are easy to second-guess live in `docs/decisions.md`. Read it
  before proposing a change to the router or the SQLite driver.

<!-- antislop:start -->
## antislop

UI and copy in this repo are governed by the antislop filter, in DURING mode.
`DESIGN.md` is the direction; antislop is the filter on top of it.

Load the core skill plus the skill for the task:
- UI / visual: `antislop-ui`
- Copy and text: `antislop-copywriting`
- People (contrast, keyboard, states): `antislop-human`
- Mobile / responsive: `antislop-layoutmobile` (this is a phones-first product,
  so this one applies to every screen)

Run the Delivery Gate before declaring a UI milestone complete and save the PASS
report under `reports/`.
<!-- antislop:end -->
