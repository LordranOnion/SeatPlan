import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deriveViewToken, hashToken, randomRoomId, randomToken, type TokenHashes } from "./auth.js";

export interface RoomRecord extends TokenHashes {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreatedRoom {
  roomId: string;
  editToken: string;
  viewToken: string;
}

/** Persists one Yjs document blob per room, plus token hashes and timestamps. */
export class RoomStore {
  private db: DatabaseSync;

  constructor(path: string, private now: () => number = Date.now) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        edit_hash TEXT NOT NULL,
        view_hash TEXT NOT NULL,
        doc BLOB,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rooms_updated_at ON rooms (updated_at);
    `);
  }

  create(): CreatedRoom {
    const roomId = randomRoomId();
    const editToken = randomToken();
    const viewToken = deriveViewToken(editToken);
    const t = this.now();
    this.db
      .prepare("INSERT INTO rooms (id, edit_hash, view_hash, doc, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)")
      .run(roomId, hashToken(editToken), hashToken(viewToken), t, t);
    return { roomId, editToken, viewToken };
  }

  get(id: string): RoomRecord | null {
    const row = this.db
      .prepare("SELECT id, edit_hash, view_hash, created_at, updated_at FROM rooms WHERE id = ?")
      .get(id) as
      | { id: string; edit_hash: string; view_hash: string; created_at: number; updated_at: number }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      editHash: row.edit_hash,
      viewHash: row.view_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  loadDoc(id: string): Uint8Array | null {
    const row = this.db.prepare("SELECT doc FROM rooms WHERE id = ?").get(id) as { doc: Uint8Array | null } | undefined;
    return row?.doc ? new Uint8Array(row.doc) : null;
  }

  /** Stores the full document state and restarts the room's expiry clock. */
  saveDoc(id: string, state: Uint8Array): void {
    this.db.prepare("UPDATE rooms SET doc = ?, updated_at = ? WHERE id = ?").run(state, this.now(), id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM rooms WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  /** Deletes rooms whose last edit is older than `cutoff`; returns their IDs. */
  deleteOlderThan(cutoff: number): string[] {
    const rows = this.db.prepare("SELECT id FROM rooms WHERE updated_at < ?").all(cutoff) as { id: string }[];
    const del = this.db.prepare("DELETE FROM rooms WHERE id = ?");
    for (const row of rows) del.run(row.id);
    return rows.map((r) => r.id);
  }

  count(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM rooms").get() as { n: number }).n);
  }

  close(): void {
    this.db.close();
  }
}
