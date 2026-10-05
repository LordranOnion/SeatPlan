import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type Role = "edit" | "view";

/** Random, unguessable, URL-safe string. */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function randomRoomId(): string {
  return randomBytes(12).toString("base64url");
}

/**
 * The view token is derived from the edit token, so whoever holds the edit link
 * can recover the view link while the server stores only hashes of both.
 */
export function deriveViewToken(editToken: string): string {
  return createHmac("sha256", editToken).update("seatplan:view").digest("base64url").slice(0, 32);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface TokenHashes {
  editHash: string;
  viewHash: string;
}

/** Returns the role a token grants for a room, or null when it grants nothing. */
export function roleForToken(room: TokenHashes, token: string | null | undefined): Role | null {
  if (!token || token.length > 256) return null;
  const hash = hashToken(token);
  if (sameHash(hash, room.editHash)) return "edit";
  if (sameHash(hash, room.viewHash)) return "view";
  return null;
}

/** Extracts the token from an "Authorization: Bearer <token>" header. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
