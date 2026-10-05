import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import { PRESENCE_COLORS } from "../lib/ids";
import type { ID, Point } from "../types";

/** What each participant publishes on the Yjs awareness channel. Never persisted. */
export interface PresenceState {
  user?: { name: string; color: string };
  /** Pointer position in canvas (world) coordinates. */
  cursor?: Point | null;
  /** What the participant is dragging right now. */
  dragging?: { tableId?: ID; fixtureId?: ID; guestId?: ID; groupId?: ID } | null;
}

export interface RemoteParticipant extends PresenceState {
  clientId: number;
  user: { name: string; color: string };
}

const USER_KEY = "seatplan.user";

export interface LocalUser {
  name: string;
  color: string;
}

export function loadLocalUser(): LocalUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    const user = raw ? (JSON.parse(raw) as LocalUser) : null;
    return user?.name ? user : null;
  } catch {
    return null;
  }
}

export function saveLocalUser(name: string): LocalUser {
  const existing = loadLocalUser();
  const user = {
    name: name.trim().slice(0, 40),
    color: existing?.color ?? PRESENCE_COLORS[Math.floor(Math.random() * PRESENCE_COLORS.length)],
  };
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // Not persisted; fine for this visit.
  }
  return user;
}

/** Other participants currently connected to the room (excluding this tab). */
export function useRemoteParticipants(awareness: Awareness | null): RemoteParticipant[] {
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  useEffect(() => {
    if (!awareness) {
      setParticipants([]);
      return;
    }
    const update = () => {
      const list: RemoteParticipant[] = [];
      awareness.getStates().forEach((state, clientId) => {
        const s = state as PresenceState;
        if (clientId !== awareness.clientID && s.user?.name) list.push({ ...s, clientId, user: s.user });
      });
      list.sort((a, b) => a.clientId - b.clientId);
      setParticipants(list);
    };
    update();
    awareness.on("change", update);
    return () => awareness.off("change", update);
  }, [awareness]);
  return participants;
}

export function setPresence(awareness: Awareness | null, patch: Partial<PresenceState>): void {
  if (!awareness) return;
  for (const [key, value] of Object.entries(patch)) awareness.setLocalStateField(key, value);
}
