import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { deriveViewToken, hashToken, roleForToken } from "../src/auth.js";
import { runExpiry } from "../src/expiry.js";
import { startServer, type SyncServer } from "../src/index.js";
import { RoomStore } from "../src/rooms.js";

const DAY = 24 * 60 * 60 * 1000;

function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("timed out"));
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe("auth", () => {
  it("maps tokens to roles", () => {
    const edit = "edit-token-123";
    const view = deriveViewToken(edit);
    const room = { editHash: hashToken(edit), viewHash: hashToken(view) };
    expect(roleForToken(room, edit)).toBe("edit");
    expect(roleForToken(room, view)).toBe("view");
    expect(roleForToken(room, "nope")).toBeNull();
    expect(roleForToken(room, "")).toBeNull();
    expect(roleForToken(room, null)).toBeNull();
  });

  it("derives a stable view token that differs from the edit token", () => {
    expect(deriveViewToken("a")).toBe(deriveViewToken("a"));
    expect(deriveViewToken("a")).not.toBe(deriveViewToken("b"));
    expect(deriveViewToken("a")).not.toBe("a");
  });
});

describe("RoomStore and expiry", () => {
  it("creates, saves, loads and deletes rooms without storing tokens in plain text", () => {
    const store = new RoomStore(":memory:");
    const { roomId, editToken, viewToken } = store.create();
    const record = store.get(roomId)!;
    expect(record.editHash).not.toContain(editToken);
    expect(roleForToken(record, editToken)).toBe("edit");
    expect(roleForToken(record, viewToken)).toBe("view");

    store.saveDoc(roomId, new Uint8Array([1, 2, 3]));
    expect([...store.loadDoc(roomId)!]).toEqual([1, 2, 3]);
    expect(store.delete(roomId)).toBe(true);
    expect(store.get(roomId)).toBeNull();
    store.close();
  });

  it("deletes rooms 30 days after the last edit", () => {
    let now = 1_000_000_000_000;
    const store = new RoomStore(":memory:", () => now);
    const old = store.create().roomId;
    now += 20 * DAY;
    const fresh = store.create().roomId;
    now += 11 * DAY;

    const evicted: string[] = [];
    const deleted = runExpiry(store, 30, (id) => evicted.push(id), now);
    expect(deleted).toEqual([old]);
    expect(evicted).toEqual([old]);
    expect(store.get(fresh)).not.toBeNull();

    // An edit restarts the clock.
    store.saveDoc(fresh, new Uint8Array([0]));
    now += 25 * DAY;
    expect(runExpiry(store, 30, () => {}, now)).toEqual([]);
    store.close();
  });
});

describe("sync server", () => {
  let srv: SyncServer;
  let base: string;
  const providers: WebsocketProvider[] = [];

  beforeEach(async () => {
    srv = await startServer({ port: 0, host: "127.0.0.1", dbPath: ":memory:", saveDebounceMs: 10 });
    base = `http://127.0.0.1:${srv.port}`;
  });

  afterEach(async () => {
    for (const p of providers.splice(0)) p.destroy();
    await srv.close();
  });

  function connect(roomId: string, token: string, doc = new Y.Doc()) {
    const provider = new WebsocketProvider(`ws://127.0.0.1:${srv.port}/ws`, roomId, doc, {
      params: { token },
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      disableBc: true,
    });
    providers.push(provider);
    return { doc, provider };
  }

  async function createRoom() {
    const res = await fetch(`${base}/api/rooms`, { method: "POST" });
    expect(res.status).toBe(201);
    return (await res.json()) as { roomId: string; editToken: string; viewToken: string };
  }

  it("relays edits between two editors and persists the document", async () => {
    const room = await createRoom();
    const a = connect(room.roomId, room.editToken);
    const b = connect(room.roomId, room.editToken);
    await waitFor(() => a.provider.synced && b.provider.synced);

    a.doc.getMap("guests").set("g1", "Maria");
    await waitFor(() => b.doc.getMap("guests").get("g1") === "Maria");

    b.doc.getMap("guests").set("g2", "Νίκος");
    await waitFor(() => a.doc.getMap("guests").get("g2") === "Νίκος");

    await waitFor(() => {
      const saved = srv.store.loadDoc(room.roomId);
      if (!saved) return false;
      const s = new Y.Doc();
      Y.applyUpdate(s, saved);
      return s.getMap("guests").size === 2;
    });
  });

  it("ignores writes from view-only connections", async () => {
    const room = await createRoom();
    const editor = connect(room.roomId, room.editToken);
    const viewer = connect(room.roomId, room.viewToken);
    await waitFor(() => editor.provider.synced && viewer.provider.synced);

    editor.doc.getMap("tables").set("t1", "Table 1");
    await waitFor(() => viewer.doc.getMap("tables").get("t1") === "Table 1");

    viewer.doc.getMap("tables").set("hack", "should not spread");
    await new Promise((r) => setTimeout(r, 300));
    expect(editor.doc.getMap("tables").has("hack")).toBe(false);

    // A late joiner gets the server copy, which never accepted the viewer write.
    const late = connect(room.roomId, room.editToken);
    await waitFor(() => late.provider.synced);
    expect(late.doc.getMap("tables").get("t1")).toBe("Table 1");
    expect(late.doc.getMap("tables").has("hack")).toBe(false);
  });

  it("rejects bad tokens and unknown rooms with distinct close codes", async () => {
    const room = await createRoom();
    const codes: number[] = [];
    for (const url of [
      `ws://127.0.0.1:${srv.port}/ws/${room.roomId}?token=wrong`,
      `ws://127.0.0.1:${srv.port}/ws/unknownroom123?token=${room.editToken}`,
    ]) {
      await new Promise<void>((resolve) => {
        const ws = new WebSocket(url);
        ws.on("close", (code) => {
          codes.push(code);
          resolve();
        });
      });
    }
    expect(codes).toEqual([4401, 4404]);
  });

  it("returns the view link only to editors and deletes rooms on Stop sharing", async () => {
    const room = await createRoom();
    const links = await fetch(`${base}/api/rooms/${room.roomId}/links`, {
      headers: { Authorization: `Bearer ${room.editToken}` },
    });
    expect(await links.json()).toMatchObject({ viewToken: room.viewToken });

    const forbidden = await fetch(`${base}/api/rooms/${room.roomId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${room.viewToken}` },
    });
    expect(forbidden.status).toBe(403);

    const a = connect(room.roomId, room.editToken);
    await waitFor(() => a.provider.synced);
    let closeCode = 0;
    a.provider.on("connection-close", (event: CloseEvent | null) => {
      if (event) closeCode = event.code;
    });

    const del = await fetch(`${base}/api/rooms/${room.roomId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${room.editToken}` },
    });
    expect(del.status).toBe(204);
    expect(srv.store.get(room.roomId)).toBeNull();
    await waitFor(() => closeCode === 4404);
  });

  it("rate-limits room creation per IP", async () => {
    await srv.close();
    srv = await startServer({ port: 0, host: "127.0.0.1", dbPath: ":memory:", maxRoomsPerIpPerHour: 2 });
    base = `http://127.0.0.1:${srv.port}`;
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await fetch(`${base}/api/rooms`, { method: "POST" })).status);
    expect(statuses).toEqual([201, 201, 429]);
  });
});
