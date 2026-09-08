# tanteo engine — behavioural spec

The engine is the product. Everything below is normative; the UI is a shell over it.

## Product thesis

> The roster is mutable at any point during a tournament, and every point ever
> scored is attributed to the human who actually played it.

Every rule here serves that sentence.

## Purity rules

- No DOM, no network, no `Date`, no `Math.random`. Randomness comes only from
  the seeded PRNG in `rng.ts`, whose cursor lives in state.
- Every public function is `(state, input) => newState`. Never mutate an input.
- `TournamentState` is plain JSON — no `Map`, `Set`, `Date` or class instances.
  (`Map` is fine as a *return* value from `history.ts` helpers; it must not be
  stored in state.)
- Errors are thrown as `EngineError` with a typed `code`.

## Module contract

```ts
// standings.ts
export function standings(state: TournamentState): Standing[];
export function podium(state: TournamentState): Standing[];

// americano.ts
export function defaultAmericanoRounds(playerCount: number, courts: number): number;
export function generateAmericanoRounds(
  state: TournamentState,
  fromRoundIndex: number,
  totalRounds: number,
): { rounds: Round[]; rng: RngState };

// mexicano.ts
export function generateMexicanoRound(
  state: TournamentState,
  roundIndex: number,
): { round: Round; rng: RngState };

// roster.ts
export function applyRosterEvent(state: TournamentState, event: RosterEvent): TournamentState;

// tournament.ts
export function createTournament(
  config: TournamentConfigInput,
  players: Player[],
): TournamentState;
export function recordScore(
  state: TournamentState,
  roundIndex: number,
  court: number,
  scoreA: number,
  scoreB: number,
): TournamentState;
export function clearScore(
  state: TournamentState,
  roundIndex: number,
  court: number,
): TournamentState;
export function generateNextRound(state: TournamentState): TournamentState;
```

`generateAmericanoRounds` returns *only* rounds `fromRoundIndex .. totalRounds-1`.
The caller splices them onto `state.rounds.slice(0, fromRoundIndex)`.

## Config defaults

Filled by `createTournament` when the input omits them:

| field                | default                                              |
| -------------------- | ---------------------------------------------------- |
| `pointsPerMatch`     | `24`                                                  |
| `rankingMetric`      | `'ppr'`                                               |
| `podiumMinRoundsPct` | `0.5`                                                 |
| `rounds`             | Americano: `defaultAmericanoRounds(n, courts)`; Mexicano: omitted |
| `seed`               | `'tanteo'`                                            |

Rejected with `INVALID_CONFIG`: `courts < 1`, `pointsPerMatch < 1`,
`podiumMinRoundsPct` outside `[0, 1]`, non-integer `courts` or `pointsPerMatch`.
Rejected with `NOT_ENOUGH_PLAYERS`: fewer than 4 starting players.
Rejected with `DUPLICATE_PLAYER`: repeated player id.

`defaultAmericanoRounds(n, courts)` = `ceil(C(n,2) / pairsPerRound)` where
`pairsPerRound = 2 * min(courts, floor(n / 4))`, minimum 1. For 8 players on 2
courts this is 7 — exactly the whist rotation where everyone partners everyone
once.

## Scoring

Fixed total: `scoreA + scoreB === pointsPerMatch`, both non-negative integers.
Anything else throws `INVALID_SCORE`. `recordScore` on a round or court that
does not exist throws `ROUND_NOT_FOUND` / `MATCH_NOT_FOUND`.

## Sit-outs

Per round, `playing = min(courts, floor(active / 4)) * 4` players take the
court; the rest sit out. Sit-outs are chosen from the active roster by, in
order:

1. fewest sit-outs so far (rounds below the one being generated),
2. least recent sit-out — longest ago goes first, never-sat-out counts as
   longest ago,
3. roster order, as a deterministic final tiebreak.

Under the default `ppr` metric, sitting out never damages a ranking, so there
are no compensation points.

## Americano

Full schedule precomputed at creation, whist-style: everyone partners everyone
once where the player count allows, otherwise repeats are minimised.

Rounds already carrying a score are immutable. A roster event regenerates
`beforeRound .. rounds-1` only, optimising in this priority order:

1. minimise repeated partnerships across the whole tournament, **including
   played rounds**,
2. balance opponents faced,
3. fair sit-out rotation (the rule above).

A greedy pass plus local-search swaps is sufficient. Do not write an exact
solver. Suggested shape: score a candidate round as
`W_PARTNER * sum(partnerCount^2) + W_OPPONENT * sum(opponentCount^2)` with
`W_PARTNER` dominant, build greedily from the cheapest available pair, then run
bounded swap passes. Ties break through the seeded PRNG so the result stays
deterministic.

## Mexicano

No precomputed schedule. Each round is generated from current standings:

1. pick sit-outs by the fairness rule above,
2. sort the remaining active players by the tournament's `rankingMetric`
   (same tiebreaks as the leaderboard),
3. fill courts top-down in groups of four,
4. within a court, pair 1st + 4th vs 2nd + 3rd.

Round 0 has no data: shuffle the active players with the seeded PRNG.

A late joiner with no played rounds is inserted into the sort by their seed —
`top` at the front, `middle` at the midpoint, `bottom` at the back — for pairing
only. The seed never reaches the leaderboard and is ignored once they have one
played round.

## Roster events

All events carry `beforeRound`. An event whose `beforeRound` is at or below a
round that already has a score throws `HISTORY_IMMUTABLE`. Applying an event:

- appends to `state.events`,
- updates the affected `PlayerRecord.status`,
- regenerates rounds from `beforeRound` forward (Americano: reschedule the
  remaining rounds; Mexicano: drop future unscored rounds — they are generated
  one at a time anyway),
- bumps `revision`.

| event        | effect                                                                          |
| ------------ | ------------------------------------------------------------------------------- |
| `join`       | new `PlayerRecord`, `status: 'active'`, `joinedBeforeRound`, optional pairing seed. Unknown id is an error — the caller adds the player via the event, so `join` carries a *new* id; a repeat id throws `DUPLICATE_PLAYER`. |
| `leave`      | `status: 'left'`. Stats freeze but stay on the board. Not drawn from `beforeRound` on. |
| `pause`      | `status: 'paused'`. Same as leave for pairing; distinguished for the UI.        |
| `resume`     | `status: 'active'`. No seed — they have real history.                           |
| `substitute` | outgoing `status: 'left'` with `replacedBy`; incoming is a new `PlayerRecord` with `replaces`, `joinedBeforeRound`, optional seed, zero rounds played. |

**Substitution is the core fix.** The outgoing player's played matches and
points remain theirs forever. The incoming player inherits only the future
schedule position, starting from zero. Both appear on the leaderboard.

`join` and `substitute` need the player's name; the engine takes it from a
`Player` the caller supplies. Signature detail: `applyRosterEvent` receives only
the event, so `join`/`substitute` events must reference a player already present
in `state.players` **or** the caller uses the helper below. Implement both:

```ts
export function addPlayer(state: TournamentState, player: Player): TournamentState;
```

`addPlayer` registers a name/id with `status: 'left'` and
`joinedBeforeRound: Infinity`-equivalent (use `Number.MAX_SAFE_INTEGER`) so they
are inert until a `join` or `substitute` event activates them. `join` on an
unregistered id throws `UNKNOWN_PLAYER`.

## Standings

Compute every metric for every player who has ever been in the draw, including
those who left. Sort by `config.rankingMetric`, descending, tiebreaks in order:
total points, point diff, wins, then roster order.

- `roundsPlayed` — rounds with a recorded score the player appeared in.
- `totalPoints` — sum of their team's score in those matches.
- `ppr` — `totalPoints / roundsPlayed`, `0` when `roundsPlayed === 0`.
- `pointDiff` — sum of `theirScore - opponentScore`.
- `wins` / `draws` / `losses` — per match.
- `podiumEligible` — `roundsPlayed >= ceil(podiumMinRoundsPct * maxRoundsPlayedByAnyone)`.

Why `ppr` is the default, and the reason UI copy should give: it is the only
metric fair to both late joiners and sit-outs. A player scoring at the same rate
ranks the same regardless of when they arrived.

`podium(state)` returns the top three *eligible* players in standings order.
Ineligible players stay on the leaderboard with a badge; they just cannot
occupy the final top three.

Two edge cases the engine settles rather than leaving to the UI:

- **Before the first score, the podium is empty.** The bar is
  `ceil(pct x 0) === 0`, so everyone clears it, and the top three of an all-zero
  board would be whoever the organizer typed in first. That is a wrong answer,
  not a formatting problem.
- **A player registered by `addPlayer` but never activated has no standings
  row.** A name on the roster sheet is not a competitor. They appear the moment
  a `join` or `substitute` event dates their entry.

## Invariants (property tests must hold these)

1. No player appears twice in one round.
2. Every active player either plays or sits out in each generated round.
3. `scoreA + scoreB === pointsPerMatch` for every recorded score.
4. A player's `totalPoints` equals the sum of their recorded match scores.
5. Substitution never moves historical points between players.
6. Americano regeneration never mutates a round that has a score.
7. Every function leaves its input state untouched (deep-equal before/after).
8. State survives a `JSON.parse(JSON.stringify(state))` round trip unchanged.
