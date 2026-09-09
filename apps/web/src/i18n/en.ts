/**
 * Every user-facing string in the organizer app.
 *
 * Externalised so Bahasa Indonesia can follow without touching a component.
 * Voice, from DESIGN.md: courtside plain talk, short imperatives, padel
 * vocabulary where it is natural. No exclamation marks except at match point.
 */
export const en = {
  app: {
    name: 'tanteo',
    tagline: 'Padel scoring that survives a changing roster',
    /** The meta description, and the manifest's, in one place. */
    description: 'Padel Americano and Mexicano scorekeeping that survives a changing roster.',
  },

  common: {
    cancel: 'Cancel',
    back: 'Back',
    done: 'Done',
    save: 'Save',
    remove: 'Remove',
    confirm: 'Confirm',
    round: 'Round',
    court: 'Court',
    points: 'points',
    loading: 'Opening your tournament',
    retry: 'Try again',
  },

  nav: {
    label: 'Sections',
  },

  stepper: {
    decrease: '{label}: one less',
    increase: '{label}: one more',
  },

  home: {
    emptyTitle: 'No game running',
    emptyBody: 'Set one up and you can start scoring in about a minute.',
    newTournament: 'Set up a tournament',
    resumeTitle: 'Pick up where you left off',
    resumeAction: 'Resume',
    discard: 'Discard this tournament',
    discardConfirm: 'Discard {name}? Every score in it goes with it.',
    roundProgress: 'Round {current} of {total}',
    roundOpen: 'Round {current}',
    playerCount: '{count} players',
  },

  setup: {
    title: 'Set up a tournament',
    nameLabel: 'Name',
    namePlaceholder: 'Friday night at the club',
    formatLabel: 'Format',
    americano: 'Americano',
    mexicano: 'Mexicano',
    americanoHint: 'Fixed draw. Everyone partners everyone, as far as the numbers allow.',
    mexicanoHint: 'Each round is drawn from the standings. Winners meet winners.',
    courtsLabel: 'Courts',
    pointsLabel: 'Points per match',
    pointsHint: 'Both scores add up to this. Enter one side and the other follows.',
    metricLabel: 'Rank by',
    metricPpr: 'Points per round',
    metricTotal: 'Total points',
    metricWins: 'Wins',
    metricPprHint:
      'Points per round is the only ranking fair to a late arrival and to someone who sat out. Score at the same rate and you rank the same, whenever you got here.',
    metricTotalHint: 'Total points rewards playing more rounds, so late arrivals start behind.',
    metricWinsHint: 'Wins ignores margin. A 13 to 11 counts the same as a 24 to 0.',
    playersLabel: 'Players',
    playerNamePlaceholder: 'Player name',
    addPlayer: 'Add',
    needFourPlayers: 'Four players minimum. Add {count} more.',
    duplicateName: '{name} is already on the list.',
    start: 'Start the tournament',
    playersOnCourt: '{playing} on court, {sitting} sitting out each round',
    playersEvenFit: 'Everyone plays every round',
  },

  play: {
    title: 'Score',
    roundHeading: 'Round {current}',
    roundOf: 'of {total}',
    tapToScore: 'Tap a court to score it',
    notScored: 'Not scored',
    sittingOut: 'Sitting out',
    nobodySittingOut: 'Everyone is on court',
    nextRound: 'Start round {next}',
    finishRoundFirst: 'Score every court first',
    scheduleDone: 'That was the last round. The board is final.',
    emptyTitle: 'No round yet',
    emptyBody: 'Draw the first round and the courts will show up here.',
    drawFirstRound: 'Draw round 1',
    notEnoughPlayers: 'Fewer than four players are active, so there is nothing to draw.',
    matchPoint: 'Match point!',
  },

  score: {
    heading: 'Court {court}',
    teamA: 'Team A',
    teamB: 'Team B',
    tapToAdd: 'Tap to add a point',
    holdToRemove: 'Hold to take one back',
    increment: 'Add a point to {team}',
    decrement: 'Take a point back from {team}',
    total: 'Adds up to {total}',
    clear: 'Clear this score',
    saved: 'Scored',
  },

  players: {
    title: 'Players',
    open: 'Players',
    active: 'Playing',
    paused: 'Paused',
    left: 'Left',
    addTitle: 'Add a player',
    addAction: 'Add player',
    nameLabel: 'Name',
    seedLabel: 'Where do they slot in?',
    seedHint: 'A guess for pairing only, until they have played a round. It never shows on the board.',
    seedTop: 'With the leaders',
    seedMiddle: 'Middle of the pack',
    seedBottom: 'With the rest',
    joinsNextRound: 'Joins round {round}',
    pause: 'Pause',
    resume: 'Bring back',
    leave: 'Mark as left',
    substitute: 'Substitute',
    substituteTitle: 'Who takes over from {name}?',
    substituteHint:
      '{name} keeps every point they played. The new player starts from zero and takes the empty slot.',
    substituteAction: 'Swap them in',
    statsFrozen: 'Stats frozen at round {round}',
    replacedBy: 'Replaced by {name}',
    replaces: 'In for {name}',
    lockedTitle: 'Round {round} is already scored',
    lockedBody: 'Roster changes land on the next round, not this one.',
    emptyTitle: 'Nobody here yet',
    emptyBody: 'Add the players who turned up and they will be in the next draw.',
  },

  board: {
    title: 'Board',
    open: 'Board',
    emptyTitle: 'Nothing scored yet',
    emptyBody: 'The board fills in as soon as the first court is scored.',
    rankedBy: 'Ranked by {metric}',
    columnPlayer: 'Player',
    columnPlayed: 'Rds',
    columnPoints: 'Pts',
    columnPpr: 'PPR',
    columnDiff: 'Diff',
    leader: 'Leading',
    notEnoughRounds: 'Short of rounds',
    // Attributive form on purpose: "1-round bar" and "3-round bar" both read
    // correctly, so the string needs no plural rule.
    notEnoughRoundsHint:
      'Short of the {needed}-round bar for the podium, with {played} played. Still on the board, just not in the top three.',
    podium: 'Podium',
  },

  age: {
    justNow: 'just now',
    seconds: '{count}s ago',
    minutes: '{count} min ago',
    hours: '{count} h ago',
  },

  share: {
    open: 'Share the board',
    title: 'Share the board',
    body: 'Anyone with this link can watch the board. They cannot change anything.',
    start: 'Create a share link',
    creating: 'Creating the link',
    copy: 'Copy link',
    copied: 'Copied',
    copyFailed: 'Could not copy. Select the link and copy it by hand.',
    castHint: 'Open the link on a tablet or a TV at the venue and pick Cast view.',
    pushPending: 'Not sent yet. It goes out when the signal comes back.',
    pushedAt: 'Sent {age}',
    pushFailed: 'The server refused the last push.',
    checking: 'Looking for a share server',
    unavailableTitle: 'No share server on this deployment',
    unavailableBody:
      'Scoring works here with no connection at all. Sharing a live board needs the tanteo server, which this build is not talking to. Self-host it and sharing turns on.',
  },

  live: {
    pendingTitle: 'The share link is not wired up yet',
    pendingBody:
      'Scoring works offline today. Sharing a read-only board comes with the server.',
    title: 'Live board',
    loading: 'Opening the board',
    missingTitle: 'No board on this link',
    missingBody:
      'Either the link is wrong, or the organizer has not shared this tournament yet.',
    offlineTitle: 'Cannot reach the board',
    offlineBody: 'This device is offline. The board below is the last one that arrived.',
    errorTitle: 'The board could not be read',
    errorBody: 'The server answered with something tanteo could not use.',
    updated: 'Updated {age}',
    waiting: 'Waiting for the first score',
    stalled: 'Out of touch with the organizer. This board may have moved on.',
    quiet: 'Connected. Nothing scored for a while.',
    connectionLive: 'Live',
    connectionPolling: 'Checking every few seconds',
    standings: 'Board',
    currentRound: 'On court now',
    castView: 'Cast view',
    phoneView: 'Phone view',
    castHint: 'Cycles the board and the courts for a screen at the venue.',
  },

  errors: {
    storageTitle: 'Cannot reach this browser storage',
    storageBody:
      'tanteo keeps your tournament on this device. Private browsing or a blocked storage setting will stop it.',
    genericTitle: 'Something went wrong',
    // Shown instead of the engine's own sentence, which is developer English
    // and would survive translation untouched. The code goes beside it so a
    // bug report can still say which rule was hit.
    genericBody: 'tanteo refused that change. Nothing was lost, so try again.',
    detailCode: 'Code: {code}',
    notFoundTitle: 'No such screen',
    notFoundBody: 'That address does not go anywhere in tanteo.',
    bootBody: 'tanteo could not open your saved tournaments. Reloading usually clears it.',
    scoreInvalid: 'Both scores have to add up to {total}.',
    historyLocked: 'That round already has scores, so it cannot be re-drawn.',
    unknownPlayer: 'That player is not in this tournament.',
    duplicatePlayer: 'Someone with that name is already here.',
  },
} as const;

export type Strings = typeof en;
