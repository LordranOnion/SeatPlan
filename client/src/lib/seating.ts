import type * as Y from "yjs";
import { CONFLICT_ORIGIN, LOCAL_ORIGIN, planMaps, readPlan } from "../store/schema";
import type { Guest, ID, Plan, SeatRef } from "../types";

export const seatKey = (seat: SeatRef) => `${seat.tableId}:${seat.index}`;

export interface SeatConflict {
  seat: SeatRef;
  /** Keeps the seat: the lowest guest ID. */
  winner: ID;
  /** Return to "Unseated". */
  losers: ID[];
}

export interface Seating {
  /** Effective seat of every seated guest. */
  seatOf: Map<ID, SeatRef>;
  /** seatKey -> guest sitting there. */
  occupant: Map<string, ID>;
  conflicts: SeatConflict[];
}

type SeatingInput = Pick<Plan, "tables" | "guests" | "assignments">;

/**
 * Resolves raw assignments into who effectively sits where.
 * - Assignments to a deleted table, a removed seat index, or a deleted guest count as unseated.
 * - When several guests point at one seat (concurrent drops), the lowest guest ID keeps it.
 * Every client computes the same result from the same data.
 */
export function deriveSeating(plan: SeatingInput): Seating {
  const seatOf = new Map<ID, SeatRef>();
  const occupant = new Map<string, ID>();
  const conflicts = new Map<string, SeatConflict>();
  const guestIds = Object.keys(plan.assignments).sort();
  for (const guestId of guestIds) {
    const seat = plan.assignments[guestId];
    if (!plan.guests[guestId]) continue;
    const table = plan.tables[seat.tableId];
    if (!table || !Number.isInteger(seat.index) || seat.index < 0 || seat.index >= table.seatCount) continue;
    const key = seatKey(seat);
    const holder = occupant.get(key);
    if (holder === undefined) {
      occupant.set(key, guestId);
      seatOf.set(guestId, seat);
    } else {
      const conflict = conflicts.get(key) ?? { seat, winner: holder, losers: [] };
      conflict.losers.push(guestId);
      conflicts.set(key, conflict);
    }
  }
  return { seatOf, occupant, conflicts: [...conflicts.values()] };
}

function edit(doc: Y.Doc, fn: () => void): void {
  doc.transact(fn, LOCAL_ORIGIN);
}

function seatExists(plan: Plan, seat: SeatRef): boolean {
  const table = plan.tables[seat.tableId];
  return !!table && seat.index >= 0 && seat.index < table.seatCount;
}

/**
 * Puts a guest on a seat. If the seat is taken, the two swap: the occupant moves to the
 * guest's previous seat, or becomes unseated when the guest came from the list.
 */
export function assignGuest(doc: Y.Doc, guestId: ID, seat: SeatRef): void {
  edit(doc, () => {
    const plan = readPlan(doc);
    if (!plan.guests[guestId] || !seatExists(plan, seat)) return;
    const { seatOf, occupant } = deriveSeating(plan);
    const from = seatOf.get(guestId);
    if (from && seatKey(from) === seatKey(seat)) return;
    const { assignments } = planMaps(doc);
    const other = occupant.get(seatKey(seat));
    if (other && other !== guestId) {
      if (from) assignments.set(other, { tableId: from.tableId, index: from.index });
      else assignments.delete(other);
    }
    assignments.set(guestId, { tableId: seat.tableId, index: seat.index });
  });
}

export function unassignGuest(doc: Y.Doc, guestId: ID): void {
  edit(doc, () => {
    planMaps(doc).assignments.delete(guestId);
  });
}

export function freeSeats(plan: Plan, seating: Seating, tableId: ID): number[] {
  const table = plan.tables[tableId];
  if (!table) return [];
  const free: number[] = [];
  for (let i = 0; i < table.seatCount; i++) {
    if (!seating.occupant.has(seatKey({ tableId, index: i }))) free.push(i);
  }
  return free;
}

/** Seats a guest on the first free seat of a table. Returns false when the table is full. */
export function seatAtTable(doc: Y.Doc, guestId: ID, tableId: ID): boolean {
  let ok = false;
  edit(doc, () => {
    const plan = readPlan(doc);
    const seating = deriveSeating(plan);
    const current = seating.seatOf.get(guestId);
    if (current?.tableId === tableId) {
      ok = true;
      return;
    }
    const [index] = freeSeats(plan, seating, tableId);
    if (index === undefined || !plan.guests[guestId]) return;
    planMaps(doc).assignments.set(guestId, { tableId, index });
    ok = true;
  });
  return ok;
}

export interface FillResult {
  placed: ID[];
  /** Members that did not fit and stay where they were. */
  notPlaced: ID[];
}

/**
 * Fills a table's free seats with the members of a group, in one action.
 * Unseated members go first, then members seated elsewhere; members already
 * at the table stay put. Members that do not fit keep their current seat.
 */
export function fillGroup(doc: Y.Doc, groupId: ID, tableId: ID): FillResult {
  const result: FillResult = { placed: [], notPlaced: [] };
  edit(doc, () => {
    const plan = readPlan(doc);
    if (!plan.tables[tableId]) return;
    const seating = deriveSeating(plan);
    const members = Object.values(plan.guests)
      .filter((g) => g.groupId === groupId && seating.seatOf.get(g.id)?.tableId !== tableId)
      .sort((a, b) => Number(seating.seatOf.has(a.id)) - Number(seating.seatOf.has(b.id)) || compareNames(a, b));
    const free = freeSeats(plan, seating, tableId);
    const { assignments } = planMaps(doc);
    members.forEach((guest, i) => {
      if (i < free.length) {
        assignments.set(guest.id, { tableId, index: free[i] });
        result.placed.push(guest.id);
      } else {
        result.notPlaced.push(guest.id);
      }
    });
  });
  return result;
}

/**
 * Applies the deterministic conflict rule after a merge: when two guests landed on the same
 * seat, the guest with the lower ID keeps it and the others return to "Unseated".
 * Also drops assignments that point to deleted tables, removed seats, or deleted guests.
 */
export function resolveConflicts(doc: Y.Doc): SeatConflict[] {
  const plan = readPlan(doc);
  const seating = deriveSeating(plan);
  const { assignments } = planMaps(doc);
  const stale = [...assignments.keys()].filter((guestId) => {
    const seat = plan.assignments[guestId];
    return !seat || !plan.guests[guestId] || !seatExists(plan, seat);
  });
  if (seating.conflicts.length === 0 && stale.length === 0) return [];
  doc.transact(() => {
    for (const c of seating.conflicts) for (const loser of c.losers) assignments.delete(loser);
    for (const guestId of stale) assignments.delete(guestId);
  }, CONFLICT_ORIGIN);
  return seating.conflicts;
}

export function compareNames(a: Pick<Guest, "name">, b: Pick<Guest, "name">, locale?: string): number {
  return a.name.localeCompare(b.name, locale, { sensitivity: "base", numeric: true });
}

export interface TableStats {
  seated: number;
  free: number;
  adults: number;
  children: number;
}

export function tableStats(plan: Plan, seating: Seating, tableId: ID): TableStats {
  const table = plan.tables[tableId];
  const stats: TableStats = { seated: 0, free: 0, adults: 0, children: 0 };
  if (!table) return stats;
  for (let i = 0; i < table.seatCount; i++) {
    const guestId = seating.occupant.get(seatKey({ tableId, index: i }));
    if (!guestId) continue;
    stats.seated++;
    if (plan.guests[guestId]?.isChild) stats.children++;
    else stats.adults++;
  }
  stats.free = table.seatCount - stats.seated;
  return stats;
}

export interface PlanStats {
  guests: number;
  seated: number;
  unseated: number;
  seats: number;
  freeSeats: number;
  children: number;
}

export function planStats(plan: Plan, seating: Seating): PlanStats {
  const guests = Object.values(plan.guests);
  const seats = Object.values(plan.tables).reduce((sum, t) => sum + t.seatCount, 0);
  const seated = seating.seatOf.size;
  return {
    guests: guests.length,
    seated,
    unseated: guests.length - seated,
    seats,
    freeSeats: seats - seated,
    children: guests.filter((g) => g.isChild).length,
  };
}
