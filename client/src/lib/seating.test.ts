import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addGroup, addGuest, addTable, deleteGuests, deleteTable, initPlan, updateTable } from "../store/actions";
import { LOCAL_ORIGIN, planMaps, readPlan } from "../store/schema";
import { assignGuest, deriveSeating, fillGroup, planStats, resolveConflicts, seatAtTable, tableStats, unassignGuest } from "./seating";

function setup() {
  const doc = new Y.Doc();
  initPlan(doc, "Test");
  return doc;
}

const seatOf = (doc: Y.Doc, guestId: string) => deriveSeating(readPlan(doc)).seatOf.get(guestId);

/** Syncs two documents both ways, like a reconnect would. */
function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describe("seating", () => {
  let doc: Y.Doc;
  let table: string;
  let ann: string;
  let bob: string;

  beforeEach(() => {
    doc = setup();
    table = addTable(doc, "round", { x: 0, y: 0 }, "Table");
    ann = addGuest(doc, { name: "Ann" })!;
    bob = addGuest(doc, { name: "Bob" })!;
  });

  it("assigns a guest to a seat", () => {
    assignGuest(doc, ann, { tableId: table, index: 2 });
    expect(seatOf(doc, ann)).toEqual({ tableId: table, index: 2 });
  });

  it("moves a guest seat to seat: a guest can only ever have one seat", () => {
    assignGuest(doc, ann, { tableId: table, index: 0 });
    assignGuest(doc, ann, { tableId: table, index: 5 });
    const s = deriveSeating(readPlan(doc));
    expect(s.seatOf.get(ann)).toEqual({ tableId: table, index: 5 });
    expect(s.occupant.get(`${table}:0`)).toBeUndefined();
    expect(s.seatOf.size).toBe(1);
  });

  it("swaps when a seated guest is dropped on an occupied seat", () => {
    assignGuest(doc, ann, { tableId: table, index: 0 });
    assignGuest(doc, bob, { tableId: table, index: 1 });
    assignGuest(doc, ann, { tableId: table, index: 1 });
    expect(seatOf(doc, ann)?.index).toBe(1);
    expect(seatOf(doc, bob)?.index).toBe(0);
  });

  it("returns the occupant to Unseated when an unseated guest takes the seat", () => {
    assignGuest(doc, bob, { tableId: table, index: 1 });
    assignGuest(doc, ann, { tableId: table, index: 1 });
    expect(seatOf(doc, ann)?.index).toBe(1);
    expect(seatOf(doc, bob)).toBeUndefined();
  });

  it("ignores seats that do not exist", () => {
    assignGuest(doc, ann, { tableId: table, index: 99 });
    assignGuest(doc, ann, { tableId: "nope", index: 0 });
    expect(seatOf(doc, ann)).toBeUndefined();
  });

  it("unseats a guest", () => {
    assignGuest(doc, ann, { tableId: table, index: 0 });
    unassignGuest(doc, ann);
    expect(seatOf(doc, ann)).toBeUndefined();
  });

  it("seats a guest on the first free seat of a table, and reports a full table", () => {
    updateTable(doc, table, { seatCount: 1 });
    expect(seatAtTable(doc, ann, table)).toBe(true);
    expect(seatOf(doc, ann)?.index).toBe(0);
    expect(seatAtTable(doc, bob, table)).toBe(false);
  });

  it("fills a table's free seats with a group in one action", () => {
    const fam = addGroup(doc, "Papadopoulos");
    const members = ["Maria", "Nikos", "Eleni"].map((name) => addGuest(doc, { name, groupId: fam })!);
    assignGuest(doc, ann, { tableId: table, index: 0 });
    updateTable(doc, table, { seatCount: 3 });
    const result = fillGroup(doc, fam, table);
    expect(result.placed).toHaveLength(2);
    expect(result.notPlaced).toHaveLength(1);
    const s = deriveSeating(readPlan(doc));
    expect(s.seatOf.get(ann)?.index).toBe(0);
    expect(members.filter((m) => s.seatOf.has(m))).toHaveLength(2);
  });

  it("fill-group is a single undo step", () => {
    const fam = addGroup(doc, "Fam");
    addGuest(doc, { name: "A", groupId: fam });
    addGuest(doc, { name: "B", groupId: fam });
    const m = planMaps(doc);
    const undo = new Y.UndoManager([m.assignments], { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    fillGroup(doc, fam, table);
    expect(deriveSeating(readPlan(doc)).seatOf.size).toBe(2);
    undo.undo();
    expect(deriveSeating(readPlan(doc)).seatOf.size).toBe(0);
  });

  it("treats assignments to deleted tables and removed seats as unseated", () => {
    assignGuest(doc, ann, { tableId: table, index: 7 });
    assignGuest(doc, bob, { tableId: table, index: 1 });
    updateTable(doc, table, { seatCount: 4 });
    expect(seatOf(doc, ann)).toBeUndefined();
    expect(seatOf(doc, bob)?.index).toBe(1);
    deleteTable(doc, table);
    expect(deriveSeating(readPlan(doc)).seatOf.size).toBe(0);
  });

  it("removes a deleted guest's seat", () => {
    assignGuest(doc, ann, { tableId: table, index: 0 });
    deleteGuests(doc, [ann]);
    expect(deriveSeating(readPlan(doc)).occupant.size).toBe(0);
  });

  it("counts seated, free, adults and children", () => {
    const kid = addGuest(doc, { name: "Kid", isChild: true })!;
    assignGuest(doc, ann, { tableId: table, index: 0 });
    assignGuest(doc, kid, { tableId: table, index: 1 });
    const plan = readPlan(doc);
    const seating = deriveSeating(plan);
    expect(tableStats(plan, seating, table)).toEqual({ seated: 2, free: 6, adults: 1, children: 1 });
    expect(planStats(plan, seating)).toMatchObject({ guests: 3, seated: 2, unseated: 1, seats: 8, freeSeats: 6 });
  });
});

describe("concurrent edits", () => {
  it("never puts one guest in two seats when two people move the same guest (last write wins)", () => {
    const a = setup();
    const t = addTable(a, "round", { x: 0, y: 0 }, "Table");
    const g = addGuest(a, { name: "Ann" })!;
    const b = new Y.Doc();
    sync(a, b);

    assignGuest(a, g, { tableId: t, index: 0 });
    assignGuest(b, g, { tableId: t, index: 4 });
    sync(a, b);

    const sa = deriveSeating(readPlan(a));
    const sb = deriveSeating(readPlan(b));
    expect(sa.seatOf.size).toBe(1);
    expect(sa.seatOf.get(g)).toEqual(sb.seatOf.get(g));
  });

  it("resolves two guests dropped on one seat: the lower ID keeps it, on both sides", () => {
    const a = setup();
    const t = addTable(a, "round", { x: 0, y: 0 }, "Table");
    const g1 = addGuest(a, { name: "One" })!;
    const g2 = addGuest(a, { name: "Two" })!;
    const [low, high] = [g1, g2].sort();
    const b = new Y.Doc();
    sync(a, b);

    assignGuest(a, low, { tableId: t, index: 3 });
    assignGuest(b, high, { tableId: t, index: 3 });
    sync(a, b);

    // Before cleanup, both documents already show the same winner.
    expect(deriveSeating(readPlan(a)).occupant.get(`${t}:3`)).toBe(low);
    expect(deriveSeating(readPlan(b)).occupant.get(`${t}:3`)).toBe(low);

    const ca = resolveConflicts(a);
    const cb = resolveConflicts(b);
    expect(ca).toEqual([{ seat: { tableId: t, index: 3 }, winner: low, losers: [high] }]);
    expect(cb).toEqual(ca);
    sync(a, b);

    for (const d of [a, b]) {
      const s = deriveSeating(readPlan(d));
      expect(s.seatOf.get(low)).toEqual({ tableId: t, index: 3 });
      expect(s.seatOf.has(high)).toBe(false);
      expect(s.conflicts).toHaveLength(0);
    }
    expect(resolveConflicts(a)).toEqual([]);
  });

  it("merges offline edits of different fields on the same table", () => {
    const a = setup();
    const t = addTable(a, "round", { x: 0, y: 0 }, "Table");
    const b = new Y.Doc();
    sync(a, b);
    updateTable(a, t, { label: "Head table" });
    updateTable(b, t, { x: 400, y: 300 });
    sync(a, b);
    for (const d of [a, b]) expect(readPlan(d).tables[t]).toMatchObject({ label: "Head table", x: 400, y: 300 });
  });
});
