# tanteo

Padel Americano and Mexicano scorekeeping for social tournaments, built for the
evening where the roster refuses to hold still.

## The problem

Social padel rosters change. Someone texts that they are twenty minutes away.
Someone tweaks an ankle in round three and sits down. Someone's partner turns up
and wants in.

Scorekeeping apps for these formats freeze the roster the moment the tournament
starts. The schedule is precomputed, the leaderboard has fixed rows, and there
is no way to tell the app that this is a different human now. So organizers do
the only thing left to them: the stand-in plays as the missing person.

From that point the board is fiction. The late arrival's points are filed under
someone who already went home, and that name keeps climbing the table all
evening. At the end of the night nobody can say who actually won.

tanteo takes the other route.

> The roster is mutable at any point during a tournament, and every point ever
> scored is attributed to the human who actually played it.

Add a player mid tournament and they enter the next round's draw. Substitute
someone out and their played matches, points and rank stay theirs forever, while
the player taking their slot starts from zero. Both stay on the leaderboard,
because both played. Pause a player and their stats freeze where they are.
Rounds that already carry a score are never re-drawn.

That is the whole pitch. There is no user base to quote and no benchmark to
show. Read `packages/engine/SPEC.md` if you want the rules stated precisely.

## The two formats

**Americano.** The full schedule is drawn at setup, whist style: everyone
partners everyone once where the player count allows it, and repeats are
minimised where it does not. Eight players on two courts gives seven rounds. A
roster change re-plans the remaining rounds and leaves the played ones alone.

**Mexicano.** Nothing is precomputed. Each round is drawn from the standings at
that moment: sort the active players, fill courts top down in fours, and inside
a court pair first with fourth against second with third. Round one is a seeded
shuffle, because there is nothing to sort yet.

Both use a fixed points total per match, 24 by default. Enter one side and the
other follows. Players over the court limit sit out, chosen by fewest sit-outs
so far, then by who sat out longest ago.

### Why points per round is the default ranking

Points per round is total points divided by rounds played. It is the only
metric that is fair to a late arrival and to someone who sat out at the same
time. Score at the same rate and you rank the same, whenever you got here.

Total points rewards being present for more rounds, so anyone who arrives in
round four starts the night behind and cannot catch up. Wins ignores margin, so
a 13 to 11 counts the same as a 24 to 0. Both are available in setup. Points per
round is what the product argues for, because it is the ranking that makes a
mutable roster mean something.

The podium is separate from the leaderboard: a player needs at least half as
many rounds as the busiest player to be eligible for the top three. Everyone
else stays on the board with a badge saying why they are not on the podium.

## An evening, end to end

1. Set up the tournament: name, format, courts, points per match, ranking, and
   the players who turned up.
2. Draw round one and score each court. Tap to add a point, hold to take one
   back. The two sides always add up to the match total.
3. Change the roster whenever you need to. Add, pause, bring back, mark as left,
   or substitute. Changes land on the next round, never on a scored one.
4. Start the next round. Watch the board.
5. Optionally create a share link and paste it into the group chat.

The organizer app works with the radio off. The tournament lives in the
browser's IndexedDB on that device, and the app shell is precached, so it boots
and scores with no network at all. Sharing is the only part that waits for
signal.

## Run it yourself

There is no published image yet, so build one. From the repo root:

```sh
docker build -t tanteo .
docker run -p 8080:8080 -v tanteo-data:/data tanteo
```

Open http://localhost:8080. One container serves both the built client and the
share API on the same origin, so there is one thing to run and no CORS to
configure.

The SQLite file lives at `/data/tanteo.sqlite` inside the container, which is
declared as a volume. Mount something there, as above, or a restart takes the
evening's boards with it. A host directory works too:

```sh
docker run -p 8080:8080 -v "$PWD/data:/data" tanteo
```

The container runs as uid 1000, so on Linux a bind-mounted directory has to be
writable by that uid. A named volume, as in the first example, avoids the
question.

### Environment variables

| Variable          | Default in the image | What it does                                                          |
| ----------------- | -------------------- | --------------------------------------------------------------------- |
| `PORT`            | `8080`               | Port the server listens on.                                            |
| `TANTEO_DB`       | `/data/tanteo.sqlite`| Path to the SQLite file. `:memory:` gives a throwaway server that keeps nothing. |
| `TANTEO_WEB_ROOT` | `/app/public`        | Directory holding the built client. If it is missing, the server logs a warning and serves the API only. |

Outside the image the defaults are `8080`, `./data/tanteo.sqlite` and
`./public`.

The container has a healthcheck that polls `/api/health`, and the process
handles `SIGTERM` and `SIGINT` by closing the socket and the database, so a
plain `docker stop` does not leave a WAL file to recover.

### Serve it over HTTPS

Put tanteo behind TLS if you can. Browsers restrict service workers, app
installation and the clipboard API to secure contexts, so on a plain `http://`
LAN address the organizer app will not install as a PWA and the copy button on
the share sheet falls back to selecting the link by hand. Everything else works.

### Building the image for another architecture

The image has been verified building for `linux/amd64` and `linux/arm64`.
Nothing in the tree is a native addon, which is why the arm64 leg is a set of
file copies rather than a compile under emulation. Storage is Node's built-in
`node:sqlite` for exactly this reason; see `docs/decisions.md`.

Multi-platform builds need a buildx builder with the container driver:

```sh
docker buildx create --name tanteo-builder --use
docker buildx build --platform linux/amd64,linux/arm64 -t tanteo:0.1.0 .
```

That leaves the result in the build cache. Docker cannot load a two-architecture
image into the local daemon, so add `--push` with a registry tag to publish it,
or build one platform at a time with `--load` to run it here.

## The share link

The organizer taps "Share the board" and gets a URL like
`https://your-host/t/<token>`. Anyone holding it sees a live read-only board and
can switch to a cast view for a tablet or a screen propped up at the venue. It
updates over server-sent events, and falls back to polling every five seconds
when the stream will not hold.

A link holder cannot change anything. There are two tokens, not one:

- The **write token** is 32 random bytes generated on the organizer's device. It
  never leaves that device except as a request header.
- The **read token** is the SHA-256 of the write token. That is what goes in the
  URL.

The server stores snapshots under the read token. On a write it checks that the
SHA-256 of the presented write token equals the read token in the path. So the
server holds no secret, needs no accounts or sessions, and still cannot be
written to by someone who only has the link. Recovering the write token from the
read token is a preimage attack on SHA-256.

The cost of this is real and worth stating: an organizer who loses their device
loses the ability to push to that link, because the write token lived only
there. That is the trade-off of any capability model with no account to recover
from. The reasoning is in `docs/decisions.md` under "Two share tokens, not one".

The server also never parses a tournament. It stores the posted JSON as opaque
text and compares a revision number in a header, so there is no second
implementation of the rules waiting to disagree with the engine.

## Development

Node 24 and pnpm 11. The server stores snapshots with the built-in
`node:sqlite` module, which is why the Dockerfile and CI both pin Node 24. pnpm
is pinned in `packageManager`, so `corepack enable` is enough to get the right
version.

```sh
pnpm install
pnpm test        # 235 tests across four packages
pnpm typecheck
pnpm build
```

### Layout

| Path              | What it is                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `packages/engine` | The product. Pure TypeScript: no DOM, no network, no clock, no `Math.random`. 168 tests, including property tests over the invariants in `SPEC.md`. |
| `packages/share`  | The two-token share model, used by both the browser and the server so there is one definition of the derivation. 23 tests. |
| `apps/web`        | React PWA. Dexie over IndexedDB, a hand-rolled router, Tailwind. A shell over the engine; it never re-implements a rule. 9 tests. |
| `apps/server`     | Hono plus `node:sqlite`. Serves the read-only share link and the built client. 35 tests. |

The engine is developed test first. Add the property test before the
implementation, and read `packages/engine/SPEC.md` first, because it is
normative.

### Running it locally

The organizer app on its own, with Vite and hot reload at
http://localhost:5173:

```sh
pnpm --filter @tanteo/web dev
```

Scoring, the roster and the board all work there. Creating a share link does
not, because there is no API on that port. For the full one-origin shape, which
is what the container runs, build first and then start the server over the built
client:

```sh
pnpm build
pnpm run start:local
```

That serves on `PORT` (8080 by default) with an in-memory database, so it starts
clean every time. Set `TANTEO_DB` to a path if you want it to persist.

### Continuous integration

`.github/workflows/ci.yml` runs the typecheck, the unit tests and the build on
every push and pull request, and builds the Docker image for both architectures.

## Not in v1

Deliberately absent, not missing:

- **Accounts.** No sign-up, no login, no password to lose. The organizer's
  device is the source of truth and the share link is a capability URL.
- **Team and mixed format variants.** Americano and Mexicano only.
- **Cross-session ratings.** A tournament is an evening. tanteo does not carry a
  rating between them.
- **Payments.** Nothing to buy, no court fees to split.
- **Native apps.** It installs as a PWA from the browser.
- **Push notifications.** The share link updates while it is open. It does not
  buzz anyone's phone.

## Where the reasoning lives

- `packages/engine/SPEC.md` is the normative spec: config defaults, scoring,
  sit-outs, roster events, standings, and the invariants the property tests
  hold.
- `docs/decisions.md` records the choices that are easy to second-guess, each
  with its deciding factor and the cost accepted. Read it before proposing a
  change to the router or the SQLite driver.
- `DESIGN.md` is the visual direction.
- `reports/` holds the antislop delivery gate reports, one per UI milestone,
  including what was verified and how.
