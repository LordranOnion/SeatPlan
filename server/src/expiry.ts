import type { RoomStore } from "./rooms.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deletes rooms not edited within `ttlDays`; calls `onDeleted` for each so live connections can be closed. */
export function runExpiry(
  store: RoomStore,
  ttlDays: number,
  onDeleted: (roomId: string) => void,
  now: number = Date.now(),
): string[] {
  const deleted = store.deleteOlderThan(now - ttlDays * DAY_MS);
  for (const id of deleted) onDeleted(id);
  return deleted;
}

/** Runs the expiry job now and then every `intervalMs`. Returns a function that stops it. */
export function startExpiryJob(
  store: RoomStore,
  ttlDays: number,
  intervalMs: number,
  onDeleted: (roomId: string) => void,
): () => void {
  const tick = () => {
    try {
      const deleted = runExpiry(store, ttlDays, onDeleted);
      if (deleted.length > 0) console.log(`[expiry] deleted ${deleted.length} room(s)`);
    } catch (err) {
      console.error("[expiry] failed", err);
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
