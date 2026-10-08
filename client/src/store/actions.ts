import type * as Y from "yjs";
import {
  DEFAULT_BAR_WIDTH,
  MAX_SEATS,
  TABLE_DEFAULTS,
  findFreeSpot,
  rectBounds,
  snapTo,
  tableBounds,
  type Bounds,
} from "../lib/geometry";
import { newId, nextGroupColor } from "../lib/ids";
import type { Fixture, Group, Guest, ID, Point, Room, Table, TableShape } from "../types";
import {
  DEFAULT_ROOM,
  INIT_ORIGIN,
  LOCAL_ORIGIN,
  SCHEMA_VERSION,
  isInitialized,
  patchEntity,
  planMaps,
  readPlan,
  setEntity,
} from "./schema";

/** Runs `fn` as one undoable edit by this user. */
export function edit<T>(doc: Y.Doc, fn: () => T): T {
  let result!: T;
  doc.transact(() => {
    result = fn();
  }, LOCAL_ORIGIN);
  return result;
}

/** Writes defaults into an empty document. Not undoable. */
export function initPlan(doc: Y.Doc, name: string): void {
  if (isInitialized(doc)) return;
  doc.transact(() => {
    const m = planMaps(doc);
    m.meta.set("id", newId());
    m.meta.set("name", name);
    m.meta.set("version", SCHEMA_VERSION);
    for (const [key, value] of Object.entries(DEFAULT_ROOM)) {
      if (!m.room.has(key)) m.room.set(key, value);
    }
  }, INIT_ORIGIN);
}

export function setPlanInfo(doc: Y.Doc, info: { name?: string; date?: string }): void {
  edit(doc, () => {
    const { meta } = planMaps(doc);
    if (info.name !== undefined) meta.set("name", info.name);
    if (info.date !== undefined) {
      if (info.date) meta.set("date", info.date);
      else meta.delete("date");
    }
  });
}

export function setRoom(doc: Y.Doc, patch: Partial<Room>): void {
  edit(doc, () => {
    const { room } = planMaps(doc);
    for (const [key, value] of Object.entries(patch)) if (value !== undefined) room.set(key, value);
  });
}

// ---- Tables ----

/** "Table N" with N one higher than the highest number in use. */
export function nextTableLabel(tables: Table[], word: string): string {
  let max = 0;
  for (const t of tables) {
    const m = /(\d+)\s*$/.exec(t.label);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${word} ${max + 1}`;
}

function occupiedBounds(plan: ReturnType<typeof readPlan>): Bounds[] {
  return [...Object.values(plan.tables).map(tableBounds), ...Object.values(plan.fixtures).map(rectBounds)];
}

/** Snapped position near `at` that does not overlap existing tables or objects. */
function placeNear(plan: ReturnType<typeof readPlan>, at: Point, halfW: number, halfH: number): Point {
  const g = plan.room.snap ? plan.room.gridSize : 1;
  const start = { x: snapTo(at.x, g), y: snapTo(at.y, g) };
  const p = findFreeSpot(start, halfW, halfH, occupiedBounds(plan), Math.max(g, 20) * 2);
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

export function addTable(doc: Y.Doc, shape: TableShape, at: Point, labelWord: string): ID {
  return edit(doc, () => {
    const plan = readPlan(doc);
    const d = TABLE_DEFAULTS[shape];
    const id = newId();
    const probe = tableBounds({ id, label: "", shape, x: 0, y: 0, rotation: 0, width: d.width, height: d.height, seatCount: d.seatCount });
    const pos = placeNear(plan, at, probe.maxX, probe.maxY);
    const table: Table = {
      id,
      label: nextTableLabel(Object.values(plan.tables), labelWord),
      shape,
      x: pos.x,
      y: pos.y,
      rotation: 0,
      width: d.width,
      height: d.height,
      seatCount: d.seatCount,
      ...(shape === "banquet" || shape === "u" ? { sides: 2 as const } : {}),
      ...(shape === "u" ? { barWidth: DEFAULT_BAR_WIDTH } : {}),
    };
    setEntity(planMaps(doc).tables, id, table);
    return id;
  });
}

/** Updates table fields. Lowering the seat count unseats guests on removed seats. */
export function updateTable(doc: Y.Doc, id: ID, patch: Partial<Omit<Table, "id">>): void {
  edit(doc, () => {
    const m = planMaps(doc);
    if (!m.tables.has(id)) return;
    const next = { ...patch };
    if (next.seatCount !== undefined) {
      next.seatCount = Math.max(0, Math.min(MAX_SEATS, Math.round(next.seatCount)));
      m.assignments.forEach((seat, guestId) => {
        if (seat.tableId === id && seat.index >= next.seatCount!) m.assignments.delete(guestId);
      });
    }
    const current = m.tables.get(id)!;
    if ((next.shape === "banquet" || next.shape === "u") && !current.has("sides")) next.sides = 2;
    if (next.shape === "u" && !current.has("barWidth")) next.barWidth = DEFAULT_BAR_WIDTH;
    patchEntity(m.tables, id, next);
  });
}

export function duplicateTable(doc: Y.Doc, id: ID, labelWord: string): ID | null {
  return edit(doc, () => {
    const plan = readPlan(doc);
    const source = plan.tables[id];
    if (!source) return null;
    const copyId = newId();
    setEntity(planMaps(doc).tables, copyId, {
      ...source,
      id: copyId,
      label: nextTableLabel(Object.values(plan.tables), labelWord),
      x: source.x + 40,
      y: source.y + 40,
    });
    return copyId;
  });
}

/** Deletes a table; its guests return to "Unseated" (undo restores both). */
export function deleteTable(doc: Y.Doc, id: ID): void {
  edit(doc, () => {
    const m = planMaps(doc);
    m.tables.delete(id);
    m.assignments.forEach((seat, guestId) => {
      if (seat.tableId === id) m.assignments.delete(guestId);
    });
  });
}

// ---- Fixtures ----

export function addFixture(doc: Y.Doc, label: string, at: Point, size = { width: 200, height: 120 }): ID {
  return edit(doc, () => {
    const id = newId();
    const pos = placeNear(readPlan(doc), at, size.width / 2, size.height / 2);
    const fixture: Fixture = {
      id,
      label,
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
      rotation: 0,
    };
    setEntity(planMaps(doc).fixtures, id, fixture);
    return id;
  });
}

export function updateFixture(doc: Y.Doc, id: ID, patch: Partial<Omit<Fixture, "id">>): void {
  edit(doc, () => patchEntity(planMaps(doc).fixtures, id, patch));
}

export function duplicateFixture(doc: Y.Doc, id: ID): ID | null {
  return edit(doc, () => {
    const source = readPlan(doc).fixtures[id];
    if (!source) return null;
    const copyId = newId();
    setEntity(planMaps(doc).fixtures, copyId, { ...source, id: copyId, x: source.x + 40, y: source.y + 40 });
    return copyId;
  });
}

export function deleteFixture(doc: Y.Doc, id: ID): void {
  edit(doc, () => planMaps(doc).fixtures.delete(id));
}

// ---- Guests and groups ----

export type GuestInput = Omit<Guest, "id">;

function cleanGuest(input: Partial<GuestInput>): Partial<GuestInput> {
  const out: Partial<GuestInput> = { ...input };
  if (out.name !== undefined) out.name = out.name.trim();
  if (out.note !== undefined) out.note = out.note.trim() || undefined;
  if (out.isChild === false) out.isChild = undefined;
  if (out.groupId === "") out.groupId = undefined;
  return out;
}

export function addGuest(doc: Y.Doc, input: GuestInput): ID | null {
  const guest = cleanGuest(input);
  if (!guest.name) return null;
  return edit(doc, () => {
    const id = newId();
    setEntity(planMaps(doc).guests, id, { ...guest, id });
    return id;
  });
}

export function updateGuest(doc: Y.Doc, id: ID, patch: Partial<GuestInput>): void {
  const clean = cleanGuest(patch);
  if (clean.name === "") delete clean.name;
  edit(doc, () => patchEntity(planMaps(doc).guests, id, clean));
}

export function deleteGuests(doc: Y.Doc, ids: ID[]): void {
  edit(doc, () => {
    const m = planMaps(doc);
    for (const id of ids) {
      m.guests.delete(id);
      m.assignments.delete(id);
    }
  });
}

export function addGroup(doc: Y.Doc, name: string, color?: string): ID {
  return edit(doc, () => {
    const plan = readPlan(doc);
    const id = newId();
    const group: Group = {
      id,
      name: name.trim(),
      color: color ?? nextGroupColor(Object.values(plan.groups).map((g) => g.color)),
    };
    setEntity(planMaps(doc).groups, id, group);
    return id;
  });
}

export function updateGroup(doc: Y.Doc, id: ID, patch: Partial<Omit<Group, "id">>): void {
  edit(doc, () => patchEntity(planMaps(doc).groups, id, patch));
}

/** Deletes a group; its members stay in the guest list without a group. */
export function deleteGroup(doc: Y.Doc, id: ID): void {
  edit(doc, () => {
    const m = planMaps(doc);
    m.groups.delete(id);
    m.guests.forEach((guest) => {
      if (guest.get("groupId") === id) guest.delete("groupId");
    });
  });
}

export interface ImportRow {
  name: string;
  group?: string;
  isChild?: boolean;
  note?: string;
}

/** Adds many guests in one undoable step, creating groups by name (case-insensitive). */
export function importGuests(doc: Y.Doc, rows: ImportRow[]): { added: number; groupsCreated: number } {
  return edit(doc, () => {
    const m = planMaps(doc);
    const plan = readPlan(doc);
    const byName = new Map(Object.values(plan.groups).map((g) => [g.name.trim().toLocaleLowerCase(), g.id]));
    const colors = Object.values(plan.groups).map((g) => g.color);
    let added = 0;
    let groupsCreated = 0;
    for (const row of rows) {
      const name = row.name.trim();
      if (!name) continue;
      let groupId: ID | undefined;
      const groupName = row.group?.trim();
      if (groupName) {
        const key = groupName.toLocaleLowerCase();
        groupId = byName.get(key);
        if (!groupId) {
          groupId = newId();
          const color = nextGroupColor(colors);
          colors.push(color);
          setEntity(m.groups, groupId, { id: groupId, name: groupName, color });
          byName.set(key, groupId);
          groupsCreated++;
        }
      }
      const id = newId();
      setEntity(m.guests, id, {
        id,
        name,
        groupId,
        isChild: row.isChild || undefined,
        note: row.note?.trim() || undefined,
      });
      added++;
    }
    return { added, groupsCreated };
  });
}
