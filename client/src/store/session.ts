import { IndexeddbPersistence } from "y-indexeddb";
import type { Awareness } from "y-protocols/awareness";
import type { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { resolveConflicts, type SeatConflict } from "../lib/seating";
import {
  CLOSE_ROOM_FULL,
  CLOSE_ROOM_GONE,
  CLOSE_UNAUTHORIZED,
  connectRoom,
  createRoom,
  deleteRoom,
  fetchViewToken,
  type RoomCredentials,
  type ShareRole,
} from "../lib/sync";
import type { Plan } from "../types";
import { initPlan } from "./actions";
import { CONFLICT_ORIGIN, INIT_ORIGIN, LOCAL_ORIGIN, isInitialized, planMaps, readPlan, writePlan } from "./schema";

export type SessionTarget =
  | { kind: "local" }
  | { kind: "room"; roomId: string; role: ShareRole; token: string };

export type Connection = "none" | "connecting" | "connected" | "offline";

export interface SessionStatus {
  /** The plan is ready to show (local copy loaded, or first sync with the room done). */
  loaded: boolean;
  connection: Connection;
  /** The room was deleted ("Stop sharing" or expiry). Local copies remain. */
  roomGone: boolean;
  unauthorized: boolean;
  roomFull: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Links for the current room, when this browser may share them. */
  share: { roomId: string; editToken?: string; viewToken?: string } | null;
}

const LOCAL_DOC_NAME = "seatplan-local";
const LOCAL_SHARE_KEY = "seatplan.localShare";

function readStoredShare(): RoomCredentials | null {
  try {
    const raw = localStorage.getItem(LOCAL_SHARE_KEY);
    return raw ? (JSON.parse(raw) as RoomCredentials) : null;
  } catch {
    return null;
  }
}

function writeStoredShare(creds: RoomCredentials | null): void {
  try {
    if (creds) localStorage.setItem(LOCAL_SHARE_KEY, JSON.stringify(creds));
    else localStorage.removeItem(LOCAL_SHARE_KEY);
  } catch {
    // Storage unavailable: sharing still works for this visit.
  }
}

/** Overwrites the browser's own (solo) plan with `plan`, e.g. to keep a shared plan after the room is gone. */
export async function copyToLocalPlan(plan: Plan): Promise<void> {
  const doc = new Y.Doc();
  const idb = new IndexeddbPersistence(LOCAL_DOC_NAME, doc);
  await idb.whenSynced;
  writePlan(doc, plan, INIT_ORIGIN);
  // Let y-indexeddb flush the update before closing.
  await new Promise((r) => setTimeout(r, 300));
  await idb.destroy();
  doc.destroy();
}

/**
 * One open plan: the Yjs document, its IndexedDB copy, the optional sync connection,
 * and this user's undo history. The UI reads it through useSyncExternalStore.
 */
export class PlanSession {
  readonly doc = new Y.Doc();
  readonly undo: Y.UndoManager;
  provider: WebsocketProvider | null = null;

  private idb: IndexeddbPersistence;
  private listeners = new Set<() => void>();
  private conflictListeners = new Set<(conflicts: SeatConflict[]) => void>();
  private planCache: Plan | null = null;
  private status: SessionStatus;
  private conflictTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    readonly target: SessionTarget,
    private defaultName: string,
  ) {
    const m = planMaps(this.doc);
    this.undo = new Y.UndoManager([m.meta, m.room, m.tables, m.fixtures, m.guests, m.groups, m.assignments], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 400,
    });
    this.status = {
      loaded: false,
      connection: "none",
      roomGone: false,
      unauthorized: false,
      roomFull: false,
      canUndo: false,
      canRedo: false,
      share: null,
    };

    this.doc.on("update", () => {
      this.planCache = null;
      this.emit();
    });
    this.doc.on("afterTransaction", (tr: Y.Transaction) => {
      // Merges from elsewhere (other users, other tabs, IndexedDB, undo) may create seat conflicts.
      if (tr.origin === LOCAL_ORIGIN || tr.origin === CONFLICT_ORIGIN || tr.origin === INIT_ORIGIN) return;
      if (tr.changed.size === 0) return;
      this.scheduleConflictCheck();
    });
    const onStack = () =>
      this.setStatus({ canUndo: this.undo.canUndo(), canRedo: this.undo.canRedo() });
    this.undo.on("stack-item-added", onStack);
    this.undo.on("stack-item-popped", onStack);
    this.undo.on("stack-cleared", onStack);

    const docName = target.kind === "local" ? LOCAL_DOC_NAME : `seatplan-room-${target.roomId}`;
    this.idb = new IndexeddbPersistence(docName, this.doc);
    void this.idb.whenSynced.then(() => {
      if (this.destroyed) return;
      if (target.kind === "local") {
        initPlan(this.doc, this.defaultName);
        this.setStatus({ loaded: true });
        const creds = readStoredShare();
        if (creds) this.connect(creds.roomId, creds.editToken, creds);
      } else if (isInitialized(this.doc)) {
        // Offline copy of a shared plan: show it right away, sync when connected.
        this.setStatus({ loaded: true });
      }
    });

    if (target.kind === "room") {
      const share =
        target.role === "edit" ? { roomId: target.roomId, editToken: target.token } : { roomId: target.roomId };
      this.setStatus({ share });
      this.connect(target.roomId, target.token, null);
      if (target.role === "edit") {
        fetchViewToken(target.roomId, target.token)
          .then((viewToken) => {
            if (this.status.share) this.setStatus({ share: { ...this.status.share, viewToken } });
          })
          .catch(() => {});
      }
    }
  }

  get canWrite(): boolean {
    if (this.status.roomGone || this.status.unauthorized) return this.target.kind === "local";
    return this.target.kind === "local" || this.target.role === "edit";
  }

  get awareness(): Awareness | null {
    return this.provider?.awareness ?? null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getPlan = (): Plan => {
    if (!this.planCache) this.planCache = readPlan(this.doc);
    return this.planCache;
  };

  getStatus = (): SessionStatus => this.status;

  onConflicts(listener: (conflicts: SeatConflict[]) => void): () => void {
    this.conflictListeners.add(listener);
    return () => this.conflictListeners.delete(listener);
  }

  /** Replaces the whole plan (JSON import, "new plan"). Undoable. */
  replacePlan(plan: Plan): void {
    writePlan(this.doc, plan, LOCAL_ORIGIN);
  }

  /** Creates a room for the local plan and starts syncing it. */
  async startSharing(): Promise<RoomCredentials> {
    if (this.target.kind !== "local") throw new Error("only the local plan can start sharing");
    const creds = await createRoom();
    writeStoredShare(creds);
    this.connect(creds.roomId, creds.editToken, creds);
    return creds;
  }

  /** Deletes the room from the server. The local copy stays. */
  async stopSharing(): Promise<void> {
    const share = this.status.share;
    if (!share?.editToken) return;
    await deleteRoom(share.roomId, share.editToken);
    this.disconnect();
    if (this.target.kind === "local") {
      writeStoredShare(null);
      this.setStatus({ share: null, connection: "none" });
    } else {
      this.setStatus({ roomGone: true, connection: "none" });
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.conflictTimer) clearTimeout(this.conflictTimer);
    this.disconnect();
    this.undo.destroy();
    void this.idb.destroy();
    this.doc.destroy();
    this.listeners.clear();
  }

  private connect(roomId: string, token: string, owner: RoomCredentials | null): void {
    this.disconnect();
    const provider = connectRoom(this.doc, roomId, token);
    this.provider = provider;
    if (owner) this.setStatus({ share: { ...owner } });
    this.setStatus({ connection: "connecting", roomGone: false, unauthorized: false, roomFull: false });

    provider.on("status", ({ status }: { status: string }) => {
      if (this.provider !== provider) return;
      this.setStatus({ connection: status === "connected" ? "connected" : status === "connecting" ? "connecting" : "offline" });
    });
    provider.on("sync", (synced: boolean) => {
      if (this.provider !== provider || !synced) return;
      this.setStatus({ roomFull: false });
      if (!this.status.loaded) this.setStatus({ loaded: true });
    });
    provider.on("connection-close", (event: CloseEvent | null) => {
      if (this.provider !== provider || !event) return;
      if (event.code === CLOSE_ROOM_GONE) {
        this.disconnect();
        if (this.target.kind === "local") {
          // Our shared room expired or someone stopped sharing: we keep working locally.
          writeStoredShare(null);
          this.setStatus({ share: null, connection: "none", roomGone: true, loaded: true });
        } else {
          this.setStatus({ roomGone: true, connection: "none", loaded: true });
        }
      } else if (event.code === CLOSE_UNAUTHORIZED) {
        this.disconnect();
        this.setStatus({ unauthorized: true, connection: "none", loaded: true });
      } else if (event.code === CLOSE_ROOM_FULL) {
        this.setStatus({ roomFull: true });
      }
    });
    this.emit();
  }

  private disconnect(): void {
    const provider = this.provider;
    if (!provider) return;
    this.provider = null;
    provider.awareness.setLocalState(null);
    provider.destroy();
    this.emit();
  }

  private scheduleConflictCheck(): void {
    if (this.conflictTimer || this.destroyed) return;
    this.conflictTimer = setTimeout(() => {
      this.conflictTimer = null;
      if (this.destroyed || !this.canWrite) return;
      const conflicts = resolveConflicts(this.doc);
      if (conflicts.length > 0) for (const l of this.conflictListeners) l(conflicts);
    }, 0);
  }

  private setStatus(patch: Partial<SessionStatus>): void {
    const next = { ...this.status, ...patch };
    const changed = (Object.keys(patch) as (keyof SessionStatus)[]).some((k) => next[k] !== this.status[k]);
    if (!changed) return;
    this.status = next;
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
