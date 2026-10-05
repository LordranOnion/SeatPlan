import * as Y from "yjs";
import type { Fixture, Group, Guest, ID, Plan, Room, SeatRef, Table } from "../types";

export const SCHEMA_VERSION = 1;

/** Origin of every transaction made by this user. Only these are undoable (per-user undo). */
export const LOCAL_ORIGIN = { name: "local" };
/** Origin of automatic conflict cleanups, which are never undoable. */
export const CONFLICT_ORIGIN = { name: "conflict" };
/** Origin of writing the defaults into a brand-new plan. */
export const INIT_ORIGIN = { name: "init" };

export type EntityMap = Y.Map<Y.Map<unknown>>;

/**
 * Yjs layout of a plan:
 * - meta: id, name, date, version
 * - room: width, height, gridSize, snap, showGrid, showOutline
 * - tables / fixtures / guests / groups: id -> Y.Map of fields (concurrent edits of different fields merge)
 * - assignments: guestId -> SeatRef (a plain value: last write wins per guest)
 */
export function planMaps(doc: Y.Doc) {
  return {
    meta: doc.getMap<unknown>("meta"),
    room: doc.getMap<unknown>("room"),
    tables: doc.getMap<Y.Map<unknown>>("tables"),
    fixtures: doc.getMap<Y.Map<unknown>>("fixtures"),
    guests: doc.getMap<Y.Map<unknown>>("guests"),
    groups: doc.getMap<Y.Map<unknown>>("groups"),
    assignments: doc.getMap<SeatRef>("assignments"),
  };
}

export type PlanMaps = ReturnType<typeof planMaps>;

export const DEFAULT_ROOM: Room = {
  width: 1600,
  height: 1000,
  gridSize: 20,
  snap: true,
  showGrid: true,
  showOutline: true,
};

export function isInitialized(doc: Y.Doc): boolean {
  return typeof planMaps(doc).meta.get("id") === "string";
}

export function entityToObject<T>(map: Y.Map<unknown>): T {
  return map.toJSON() as T;
}

/** Writes all defined fields of `obj` into a new nested Y.Map under `id`. */
export function setEntity(map: EntityMap, id: ID, obj: object): void {
  const entity = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) entity.set(key, value);
  }
  map.set(id, entity);
}

/** Updates only the given fields; `undefined` removes a field. */
export function patchEntity(map: EntityMap, id: ID, patch: object): void {
  const entity = map.get(id);
  if (!entity) return;
  for (const [key, value] of Object.entries(patch)) {
    if (key === "id") continue;
    if (value === undefined) {
      if (entity.has(key)) entity.delete(key);
    } else if (entity.get(key) !== value) {
      entity.set(key, value);
    }
  }
}

function readEntities<T>(map: EntityMap): Record<ID, T> {
  const out: Record<ID, T> = {};
  map.forEach((entity, id) => {
    if (entity instanceof Y.Map) out[id] = { ...(entity.toJSON() as T), id };
  });
  return out;
}

export function readRoom(doc: Y.Doc): Room {
  const room = planMaps(doc).room.toJSON() as Partial<Room>;
  return { ...DEFAULT_ROOM, ...room };
}

/** Builds a plain, immutable snapshot of the plan. */
export function readPlan(doc: Y.Doc): Plan {
  const m = planMaps(doc);
  const assignments: Record<ID, SeatRef> = {};
  m.assignments.forEach((seat, guestId) => {
    if (seat && typeof seat.tableId === "string" && typeof seat.index === "number") assignments[guestId] = seat;
  });
  return {
    id: (m.meta.get("id") as string) ?? "",
    name: (m.meta.get("name") as string) ?? "",
    date: (m.meta.get("date") as string | undefined) || undefined,
    version: (m.meta.get("version") as number) ?? SCHEMA_VERSION,
    room: readRoom(doc),
    tables: readEntities<Table>(m.tables),
    fixtures: readEntities<Fixture>(m.fixtures),
    guests: readEntities<Guest>(m.guests),
    groups: readEntities<Group>(m.groups),
    assignments,
  };
}

/** Replaces the entire content of the document with `plan`, in the given transaction origin. */
export function writePlan(doc: Y.Doc, plan: Plan, origin: unknown = LOCAL_ORIGIN): void {
  doc.transact(() => {
    const m = planMaps(doc);
    for (const map of [m.tables, m.fixtures, m.guests, m.groups, m.assignments, m.room, m.meta] as Y.Map<unknown>[]) {
      for (const key of [...map.keys()]) map.delete(key);
    }
    m.meta.set("id", plan.id);
    m.meta.set("name", plan.name);
    if (plan.date) m.meta.set("date", plan.date);
    m.meta.set("version", SCHEMA_VERSION);
    for (const [key, value] of Object.entries({ ...DEFAULT_ROOM, ...plan.room })) m.room.set(key, value);
    for (const t of Object.values(plan.tables)) setEntity(m.tables, t.id, t);
    for (const f of Object.values(plan.fixtures)) setEntity(m.fixtures, f.id, f);
    for (const g of Object.values(plan.groups)) setEntity(m.groups, g.id, g);
    for (const g of Object.values(plan.guests)) setEntity(m.guests, g.id, g);
    for (const [guestId, seat] of Object.entries(plan.assignments)) {
      if (plan.guests[guestId]) m.assignments.set(guestId, { tableId: seat.tableId, index: seat.index });
    }
  }, origin);
}
