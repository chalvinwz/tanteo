import { DatabaseSync } from 'node:sqlite';

/**
 * Snapshot storage.
 *
 * The server holds one row per share token and nothing else: no accounts, no
 * history, no merge. The organizer's device is the source of truth and this is
 * the shelf its latest snapshot sits on.
 *
 * The body is stored as opaque text. The server never parses a tournament,
 * which is what keeps the engine the single definition of the rules; the
 * revision travels beside it so a late-arriving retry cannot overwrite a newer
 * push.
 */

export interface Snapshot {
  body: string;
  revision: number;
  /** Epoch millis of the write, so a viewer can show how stale the board is. */
  updatedAt: number;
}

export interface SnapshotStore {
  get(readToken: string): Snapshot | undefined;
  /** Returns false when the write was refused as stale. */
  put(readToken: string, snapshot: Snapshot): boolean;
  close(): void;
}

export function createSqliteStore(path: string): SnapshotStore {
  const db = new DatabaseSync(path);
  // WAL so a read during a write does not block; this is a read-heavy shelf
  // with one writer per token.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      read_token TEXT PRIMARY KEY,
      body       TEXT NOT NULL,
      revision   INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  const selectStmt = db.prepare(
    'SELECT body, revision, updated_at FROM snapshots WHERE read_token = ?',
  );
  // The WHERE on the upsert is what refuses a stale write: a retry that was
  // queued offline can arrive after a newer push, and last-write-wins has to
  // mean latest-revision-wins, not latest-to-arrive-wins.
  const upsertStmt = db.prepare(`
    INSERT INTO snapshots (read_token, body, revision, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(read_token) DO UPDATE SET
      body = excluded.body,
      revision = excluded.revision,
      updated_at = excluded.updated_at
    WHERE excluded.revision >= snapshots.revision
  `);

  return {
    get(readToken) {
      const row = selectStmt.get(readToken) as
        | { body: string; revision: number; updated_at: number }
        | undefined;
      if (!row) return undefined;
      return { body: row.body, revision: row.revision, updatedAt: row.updated_at };
    },

    put(readToken, snapshot) {
      const result = upsertStmt.run(
        readToken,
        snapshot.body,
        snapshot.revision,
        snapshot.updatedAt,
      );
      return Number(result.changes) > 0;
    },

    close() {
      db.close();
    },
  };
}

/** In-memory store, for tests and for a throwaway container. */
export function createMemoryStore(): SnapshotStore {
  const rows = new Map<string, Snapshot>();
  return {
    get: (readToken) => rows.get(readToken),
    put(readToken, snapshot) {
      const existing = rows.get(readToken);
      if (existing && snapshot.revision < existing.revision) return false;
      rows.set(readToken, snapshot);
      return true;
    },
    close() {
      rows.clear();
    },
  };
}
