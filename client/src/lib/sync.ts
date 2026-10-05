import { WebsocketProvider } from "y-websocket";
import type * as Y from "yjs";

export type ShareRole = "edit" | "view";

export interface RoomCredentials {
  roomId: string;
  editToken: string;
  viewToken: string;
}

/** Close codes sent by the sync server. */
export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_ROOM_GONE = 4404;
export const CLOSE_ROOM_FULL = 4429;

/**
 * Sharing needs a sync server. Production builds (e.g. GitHub Pages) only offer it when
 * VITE_SYNC_URL was set at build time; the dev server assumes one on port 1234.
 */
export function sharingEnabled(): boolean {
  return import.meta.env.DEV || !!import.meta.env.VITE_SYNC_URL;
}

/** WebSocket base URL of the sync server, e.g. ws://localhost:1234 */
export function syncUrl(): string {
  const configured = import.meta.env.VITE_SYNC_URL as string | undefined;
  if (configured) return configured.replace(/\/+$/, "");
  const secure = location.protocol === "https:";
  return `${secure ? "wss" : "ws"}://${location.hostname}:1234`;
}

export function apiUrl(path: string): string {
  return syncUrl().replace(/^ws/, "http") + path;
}

export class SyncError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function request(path: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), init);
  } catch {
    throw new SyncError("unreachable");
  }
  if (!res.ok) throw new SyncError(res.status === 429 ? "rate_limited" : "failed", res.status);
  return res;
}

/** Creates a room on the sync server. */
export async function createRoom(): Promise<RoomCredentials> {
  const res = await request("/api/rooms", { method: "POST" });
  return (await res.json()) as RoomCredentials;
}

/** "Stop sharing": deletes the room and its data from the server. */
export async function deleteRoom(roomId: string, editToken: string): Promise<void> {
  try {
    await request(`/api/rooms/${encodeURIComponent(roomId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${editToken}` },
    });
  } catch (err) {
    // Already gone counts as success.
    if (err instanceof SyncError && err.status === 404) return;
    throw err;
  }
}

/** Recovers the view-only token from an edit token (editors who joined by link). */
export async function fetchViewToken(roomId: string, editToken: string): Promise<string> {
  const res = await request(`/api/rooms/${encodeURIComponent(roomId)}/links`, {
    headers: { Authorization: `Bearer ${editToken}` },
  });
  return ((await res.json()) as { viewToken: string }).viewToken;
}

/** Tokens live in the URL fragment, which browsers never send to the static host. */
export function roomLink(roomId: string, role: ShareRole, token: string): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#/r/${encodeURIComponent(roomId)}/${role}/${encodeURIComponent(token)}`;
}

export function connectRoom(doc: Y.Doc, roomId: string, token: string): WebsocketProvider {
  return new WebsocketProvider(`${syncUrl()}/ws`, roomId, doc, {
    params: { token },
    // Same-browser tabs sync through the server too; keeps the view-only rule in one place.
    disableBc: true,
    maxBackoffTime: 5000,
  });
}
