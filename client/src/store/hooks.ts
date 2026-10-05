import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { deriveSeating, planStats, type Seating } from "../lib/seating";
import type { Plan } from "../types";
import type { PlanSession } from "./session";

export const SessionContext = createContext<PlanSession | null>(null);

export function useSession(): PlanSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside of SessionContext");
  return session;
}

export function usePlan(): Plan {
  const session = useSession();
  return useSyncExternalStore(session.subscribe, session.getPlan);
}

export function useStatus() {
  const session = useSession();
  return useSyncExternalStore(session.subscribe, session.getStatus);
}

export function useSeating(): Seating {
  const plan = usePlan();
  return useMemo(() => deriveSeating(plan), [plan]);
}

export function usePlanStats() {
  const plan = usePlan();
  const seating = useSeating();
  return useMemo(() => planStats(plan, seating), [plan, seating]);
}

export function useAwareness() {
  const session = useSession();
  return useSyncExternalStore(session.subscribe, () => session.awareness);
}
