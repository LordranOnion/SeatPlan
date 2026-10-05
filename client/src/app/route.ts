import { useEffect, useState } from "react";
import { sharingEnabled } from "../lib/sync";
import type { SessionTarget } from "../store/session";

/**
 * Hash routes (the static host never sees tokens):
 *   #/                         the browser's own plan
 *   #/r/<roomId>/edit/<token>  shared plan, can edit
 *   #/r/<roomId>/view/<token>  shared plan, view only
 */
export function isRoomHash(hash: string): boolean {
  return /^#\/?r\//.test(hash);
}

export function parseRoute(hash: string): SessionTarget {
  const parts = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  // Without a sync server, shared links fall back to the browser's own plan.
  if (!sharingEnabled()) return { kind: "local" };
  if (parts[0] === "r" && parts[1] && (parts[2] === "edit" || parts[2] === "view") && parts[3]) {
    return { kind: "room", roomId: parts[1], role: parts[2], token: parts[3] };
  }
  return { kind: "local" };
}

export function routeKey(target: SessionTarget): string {
  return target.kind === "local" ? "local" : `${target.roomId}/${target.role}/${target.token}`;
}

export function useRoute(): SessionTarget {
  const [target, setTarget] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onHash = () => {
      const next = parseRoute(location.hash);
      setTarget((prev) => (routeKey(prev) === routeKey(next) ? prev : next));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return target;
}
