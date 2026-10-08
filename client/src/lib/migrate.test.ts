import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addGroup, addGuest, addTable, initPlan } from "../store/actions";
import { readPlan, SCHEMA_VERSION, writePlan } from "../store/schema";
import { migratePlan, PlanFormatError, serializePlan } from "./migrate";
import { assignGuest } from "./seating";

describe("migratePlan", () => {
  it("round-trips an exported plan through JSON and back into a document", () => {
    const doc = new Y.Doc();
    initPlan(doc, "Βάπτιση");
    const t = addTable(doc, "banquet", { x: 100, y: 80 }, "Table");
    addTable(doc, "u", { x: 600, y: 400 }, "Table");
    const fam = addGroup(doc, "Οικογένεια Παπαδόπουλου");
    const g = addGuest(doc, { name: "Μαρία", groupId: fam, isChild: true, note: "καρεκλάκι" })!;
    assignGuest(doc, g, { tableId: t, index: 2 });
    const original = readPlan(doc);

    const parsed = migratePlan(JSON.parse(serializePlan(original)));
    expect(parsed).toEqual(original);

    const copy = new Y.Doc();
    writePlan(copy, parsed);
    expect(readPlan(copy)).toEqual(original);
  });

  it("upgrades a v0 draft that used arrays and fills defaults", () => {
    const plan = migratePlan({
      name: "Old",
      tables: [{ id: "t1", label: "T1", shape: "weird", x: 10, y: 20, seatCount: 6 }],
      guests: [{ id: "g1", name: " Ann " }, { id: "g2", name: "" }],
      assignments: { g1: { tableId: "t1", index: 1 }, g2: { tableId: "t1", index: 0 }, ghost: { tableId: "t1", index: 3 } },
    });
    expect(plan.version).toBe(SCHEMA_VERSION);
    expect(plan.tables.t1).toMatchObject({ shape: "round", rotation: 0, seatCount: 6 });
    expect(Object.keys(plan.guests)).toEqual(["g1"]);
    expect(plan.guests.g1.name).toBe("Ann");
    expect(plan.assignments).toEqual({ g1: { tableId: "t1", index: 1 } });
    expect(plan.room.gridSize).toBeGreaterThan(0);
  });

  it("rejects files that are not plans or come from a newer version", () => {
    expect(() => migratePlan("hello")).toThrow(PlanFormatError);
    expect(() => migratePlan({ foo: 1 })).toThrow(PlanFormatError);
    expect(() => migratePlan({ tables: {}, version: SCHEMA_VERSION + 1 })).toThrow("newer_version");
  });
});
