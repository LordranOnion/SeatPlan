import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import type { WebSocket } from "ws";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type { Role } from "./auth.js";
import type { RoomStore } from "./rooms.js";

// Message types of the y-websocket protocol.
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;

/** Close codes the client understands. */
export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_ROOM_GONE = 4404;
export const CLOSE_ROOM_FULL = 4429;

const PING_INTERVAL_MS = 30_000;

interface Connection {
  role: Role;
  /** Awareness client IDs announced over this connection, removed when it closes. */
  awarenessIds: Set<number>;
  alive: boolean;
}

/** An in-memory room: the shared document, presence, and connected sockets. */
export class LiveRoom {
  readonly doc = new Y.Doc({ gc: true });
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly conns = new Map<WebSocket, Connection>();
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;
  private pingTimer: NodeJS.Timeout;

  constructor(
    readonly id: string,
    private store: RoomStore,
    private saveDebounceMs: number,
    private onEmpty: (room: LiveRoom) => void,
  ) {
    const saved = store.loadDoc(id);
    if (saved) Y.applyUpdate(this.doc, saved);
    // The server has no presence of its own.
    this.awareness.setLocalState(null);

    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder), origin as WebSocket | null);
      this.dirty = true;
      this.scheduleSave();
    });

    this.awareness.on(
      "update",
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const conn = this.conns.get(origin as WebSocket);
        if (conn) {
          for (const id of added) conn.awarenessIds.add(id);
          for (const id of removed) conn.awarenessIds.delete(id);
        }
        const changed = [...added, ...updated, ...removed];
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
        this.broadcast(encoding.toUint8Array(encoder), null);
      },
    );

    this.pingTimer = setInterval(() => {
      for (const [ws, conn] of this.conns) {
        if (!conn.alive) {
          ws.terminate();
          continue;
        }
        conn.alive = false;
        try {
          ws.ping();
        } catch {
          ws.terminate();
        }
      }
    }, PING_INTERVAL_MS);
    this.pingTimer.unref();
  }

  get size(): number {
    return this.conns.size;
  }

  add(ws: WebSocket, role: Role): void {
    const conn: Connection = { role, awarenessIds: new Set(), alive: true };
    this.conns.set(ws, conn);
    ws.binaryType = "arraybuffer";
    ws.on("pong", () => {
      conn.alive = true;
    });
    ws.on("message", (data: ArrayBuffer | Buffer) => {
      try {
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        this.handleMessage(ws, conn, bytes);
      } catch (err) {
        console.warn(`[room ${this.id}] bad message`, err);
        ws.close(1003, "bad message");
      }
    });
    ws.on("close", () => this.remove(ws));
    ws.on("error", () => this.remove(ws));

    // Start the sync handshake: send our state vector, then the current presence.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    send(ws, encoding.toUint8Array(encoder));
    const states = this.awareness.getStates();
    if (states.size > 0) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]));
      send(ws, encoding.toUint8Array(aw));
    }
  }

  private handleMessage(ws: WebSocket, conn: Connection, message: Uint8Array): void {
    const decoder = decoding.createDecoder(message);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        const syncType = decoding.readVarUint(decoder);
        if (syncType === syncProtocol.messageYjsSyncStep1) {
          syncProtocol.readSyncStep1(decoder, encoder, this.doc);
        } else if (syncType === syncProtocol.messageYjsSyncStep2 || syncType === syncProtocol.messageYjsUpdate) {
          // View-only connections may read but never write: their updates are dropped here.
          if (conn.role !== "edit") return;
          syncProtocol.readUpdate(decoder, this.doc, ws);
        } else {
          throw new Error(`unknown sync message ${syncType}`);
        }
        if (encoding.length(encoder) > 1) send(ws, encoding.toUint8Array(encoder));
        break;
      }
      case MESSAGE_AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), ws);
        break;
      case MESSAGE_QUERY_AWARENESS: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()]),
        );
        send(ws, encoding.toUint8Array(encoder));
        break;
      }
      default:
        // Ignore unknown message types (e.g. auth messages) for forward compatibility.
        break;
    }
  }

  private broadcast(message: Uint8Array, except: WebSocket | null): void {
    for (const ws of this.conns.keys()) {
      if (ws !== except) send(ws, message);
    }
  }

  private remove(ws: WebSocket): void {
    const conn = this.conns.get(ws);
    if (!conn) return;
    this.conns.delete(ws);
    awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.awarenessIds], null);
    if (this.conns.size === 0) {
      this.flush();
      this.dispose();
      this.onEmpty(this);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, this.saveDebounceMs);
  }

  /** Writes the document to storage if it changed since the last write. */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.store.saveDoc(this.id, Y.encodeStateAsUpdate(this.doc));
  }

  /** Disconnects everyone without saving, used when the room is deleted. */
  closeAll(code: number, reason: string): void {
    this.dirty = false;
    for (const ws of [...this.conns.keys()]) {
      this.conns.delete(ws);
      ws.close(code, reason);
    }
    this.dispose();
  }

  private dispose(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    clearInterval(this.pingTimer);
    this.awareness.destroy();
    this.doc.destroy();
  }
}

function send(ws: WebSocket, message: Uint8Array): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(message, (err) => {
    if (err) ws.terminate();
  });
}
