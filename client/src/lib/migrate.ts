import { DEFAULT_ROOM, SCHEMA_VERSION } from "../store/schema";
import type { Fixture, Group, Guest, ID, Plan, SeatRef, Table, TableShape } from "../types";
import { newId } from "./ids";

export class PlanFormatError extends Error {}

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const SHAPES: TableShape[] = ["round", "rect", "banquet"];

/** Accepts either a record keyed by ID (v1) or an array of objects with `id` (v0 drafts). */
function toRecord(v: unknown): Record<ID, Raw> {
  const out: Record<ID, Raw> = {};
  if (Array.isArray(v)) {
    for (const item of v) if (isObj(item)) out[str(item.id) || newId()] = item;
  } else if (isObj(v)) {
    for (const [id, item] of Object.entries(v)) if (isObj(item)) out[id] = item;
  }
  return out;
}

/**
 * Upgrades a parsed plan file of any known version to the current schema and validates it.
 * Unknown fields are dropped; missing ones get defaults. Throws PlanFormatError when the
 * input is not a plan at all, or comes from a newer version of the app.
 */
export function migratePlan(input: unknown): Plan {
  if (!isObj(input)) throw new PlanFormatError("not_an_object");
  const version = num(input.version, 0);
  if (version > SCHEMA_VERSION) throw new PlanFormatError("newer_version");
  if (!("tables" in input) && !("guests" in input)) throw new PlanFormatError("not_a_plan");

  const roomIn = isObj(input.room) ? input.room : {};
  const room = {
    width: Math.max(100, num(roomIn.width, DEFAULT_ROOM.width)),
    height: Math.max(100, num(roomIn.height, DEFAULT_ROOM.height)),
    gridSize: Math.max(0, num(roomIn.gridSize, DEFAULT_ROOM.gridSize)),
    snap: typeof roomIn.snap === "boolean" ? roomIn.snap : DEFAULT_ROOM.snap,
    showGrid: typeof roomIn.showGrid === "boolean" ? roomIn.showGrid : DEFAULT_ROOM.showGrid,
    showOutline: typeof roomIn.showOutline === "boolean" ? roomIn.showOutline : DEFAULT_ROOM.showOutline,
  };

  const tables: Record<ID, Table> = {};
  for (const [id, t] of Object.entries(toRecord(input.tables))) {
    const shape = SHAPES.includes(t.shape as TableShape) ? (t.shape as TableShape) : "round";
    const width = Math.max(20, num(t.width, 120));
    tables[id] = {
      id,
      label: str(t.label, "Table"),
      shape,
      x: num(t.x, 0),
      y: num(t.y, 0),
      rotation: num(t.rotation, 0),
      width,
      height: Math.max(20, num(t.height, shape === "round" ? width : 80)),
      seatCount: Math.max(0, Math.min(60, Math.round(num(t.seatCount, 8)))),
      ...(shape === "banquet" ? { sides: t.sides === 1 ? (1 as const) : (2 as const) } : {}),
    };
  }

  const fixtures: Record<ID, Fixture> = {};
  for (const [id, f] of Object.entries(toRecord(input.fixtures))) {
    fixtures[id] = {
      id,
      label: str(f.label),
      x: num(f.x, 0),
      y: num(f.y, 0),
      width: Math.max(10, num(f.width, 200)),
      height: Math.max(10, num(f.height, 120)),
      rotation: num(f.rotation, 0),
    };
  }

  const groups: Record<ID, Group> = {};
  for (const [id, g] of Object.entries(toRecord(input.groups))) {
    groups[id] = { id, name: str(g.name), color: /^#[0-9a-f]{3,8}$/i.test(str(g.color)) ? str(g.color) : "#cccccc" };
  }

  const guests: Record<ID, Guest> = {};
  for (const [id, g] of Object.entries(toRecord(input.guests))) {
    const name = str(g.name).trim();
    if (!name) continue;
    const guest: Guest = { id, name };
    const groupId = str(g.groupId);
    if (groupId && groups[groupId]) guest.groupId = groupId;
    if (g.isChild === true) guest.isChild = true;
    if (str(g.note).trim()) guest.note = str(g.note).trim();
    guests[id] = guest;
  }

  const assignments: Record<ID, SeatRef> = {};
  if (isObj(input.assignments)) {
    for (const [guestId, seat] of Object.entries(input.assignments)) {
      if (!guests[guestId] || !isObj(seat)) continue;
      const tableId = str(seat.tableId);
      const index = num(seat.index, -1);
      if (tables[tableId] && Number.isInteger(index) && index >= 0) assignments[guestId] = { tableId, index };
    }
  }

  return {
    id: str(input.id) || newId(),
    name: str(input.name),
    date: str(input.date) || undefined,
    room,
    tables,
    fixtures,
    guests,
    groups,
    assignments,
    version: SCHEMA_VERSION,
  };
}

/** Serializes a plan for the JSON export file. */
export function serializePlan(plan: Plan): string {
  return JSON.stringify({ format: "seatplan", ...plan, version: SCHEMA_VERSION }, null, 2);
}
