import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { bearerToken, deriveViewToken, roleForToken } from "./auth.js";
import { loadConfig, type Config } from "./config.js";
import { startExpiryJob } from "./expiry.js";
import { RoomStore } from "./rooms.js";
import { CLOSE_ROOM_FULL, CLOSE_ROOM_GONE, CLOSE_UNAUTHORIZED, LiveRoom } from "./sync.js";

export interface SyncServer {
  server: Server;
  store: RoomStore;
  port: number;
  /** Disconnects clients of a room and forgets it in memory (storage is handled by the caller). */
  evict(roomId: string): void;
  close(): Promise<void>;
}

const ROOM_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const HOUR_MS = 60 * 60 * 1000;

export async function startServer(overrides: Partial<Config> = {}): Promise<SyncServer> {
  const config = loadConfig(overrides);
  const store = new RoomStore(config.dbPath);
  const live = new Map<string, LiveRoom>();
  const creations = new Map<string, number[]>();
  const allowedOrigins = config.corsOrigin.split(",").map((s) => s.trim()).filter(Boolean);

  const evict = (roomId: string) => {
    const room = live.get(roomId);
    if (!room) return;
    live.delete(roomId);
    room.closeAll(CLOSE_ROOM_GONE, "room deleted");
  };

  function cors(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    if (allowedOrigins.includes("*")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    } else if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
  }

  function json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  }

  function clientIp(req: IncomingMessage): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
    return req.socket.remoteAddress ?? "unknown";
  }

  /** Sliding one-hour window of room creations per IP. */
  function allowCreation(ip: string): boolean {
    const now = Date.now();
    const recent = (creations.get(ip) ?? []).filter((t) => now - t < HOUR_MS);
    if (recent.length >= config.maxRoomsPerIpPerHour) {
      creations.set(ip, recent);
      return false;
    }
    recent.push(now);
    creations.set(ip, recent);
    return true;
  }

  const server = createServer((req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      // GET /api/health
      if (req.method === "GET" && url.pathname === "/api/health") {
        return json(res, 200, { ok: true, rooms: store.count(), live: live.size });
      }

      // POST /api/rooms -> { roomId, editToken, viewToken }
      if (req.method === "POST" && url.pathname === "/api/rooms") {
        if (!allowCreation(clientIp(req))) return json(res, 429, { error: "too_many_rooms" });
        return json(res, 201, store.create());
      }

      if (parts[0] === "api" && parts[1] === "rooms" && parts[2] && ROOM_ID_RE.test(parts[2])) {
        const roomId = parts[2];
        const room = store.get(roomId);
        if (!room) return json(res, 404, { error: "not_found" });
        const token = bearerToken(req.headers.authorization);
        const role = roleForToken(room, token);

        // GET /api/rooms/:id/links (edit token) -> { viewToken }
        if (req.method === "GET" && parts[3] === "links" && parts.length === 4) {
          if (role !== "edit" || !token) return json(res, 403, { error: "forbidden" });
          return json(res, 200, { roomId, viewToken: deriveViewToken(token) });
        }

        // DELETE /api/rooms/:id (edit token): "Stop sharing"
        if (req.method === "DELETE" && parts.length === 3) {
          if (role !== "edit") return json(res, 403, { error: "forbidden" });
          store.delete(roomId);
          evict(roomId);
          res.writeHead(204);
          res.end();
          return;
        }
      }

      json(res, 404, { error: "not_found" });
    } catch (err) {
      console.error(err);
      json(res, 500, { error: "internal" });
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes });

  // WebSocket endpoint: /ws/:roomId?token=...
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "ws" || parts.length !== 2) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // Accept the upgrade first so the browser can see the close code and reason.
      const roomId = parts[1];
      const record = ROOM_ID_RE.test(roomId) ? store.get(roomId) : null;
      if (!record) return ws.close(CLOSE_ROOM_GONE, "room not found");
      const role = roleForToken(record, url.searchParams.get("token"));
      if (!role) return ws.close(CLOSE_UNAUTHORIZED, "invalid token");

      let room = live.get(roomId);
      if (!room) {
        room = new LiveRoom(roomId, store, config.saveDebounceMs, (r) => {
          if (live.get(r.id) === r) live.delete(r.id);
        });
        live.set(roomId, room);
      }
      if (room.size >= config.maxClientsPerRoom) return ws.close(CLOSE_ROOM_FULL, "room full");
      room.add(ws, role);
    });
  });

  const stopExpiry = startExpiryJob(store, config.roomTtlDays, config.expiryIntervalMs, evict);

  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    server,
    store,
    port,
    evict,
    async close() {
      stopExpiry();
      for (const room of live.values()) {
        room.flush();
        room.closeAll(1001, "server shutting down");
      }
      live.clear();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const srv = await startServer();
  console.log(`SeatPlan sync server on ws://localhost:${srv.port}/ws (HTTP API on http://localhost:${srv.port}/api)`);
  const shutdown = async () => {
    await srv.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
