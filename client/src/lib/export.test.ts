import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addGuest, addTable, initPlan, updateTable } from "../store/actions";
import { readPlan } from "../store/schema";
import { alphabeticalList, byInitial, fileSafe, tableLists, toCsv } from "./export";
import { assignGuest, deriveSeating } from "./seating";

function fixture() {
  const doc = new Y.Doc();
  initPlan(doc, "Γάμος");
  const t2 = addTable(doc, "round", { x: 0, y: 0 }, "Τραπέζι");
  const t10 = addTable(doc, "round", { x: 300, y: 0 }, "Τραπέζι");
  updateTable(doc, t2, { label: "Τραπέζι 2", seatCount: 3 });
  updateTable(doc, t10, { label: "Τραπέζι 10", seatCount: 2 });
  const ids = ["Ωραιόπουλος", "Άννα", "αλέξης", "Βασίλης"].map((name) => addGuest(doc, { name })!);
  assignGuest(doc, ids[0], { tableId: t10, index: 1 });
  assignGuest(doc, ids[1], { tableId: t2, index: 0 });
  const plan = readPlan(doc);
  return { plan, seating: deriveSeating(plan), t2, t10 };
}

describe("lists", () => {
  it("sorts guests alphabetically in Greek, ignoring accents and case, with their table", () => {
    const { plan, seating } = fixture();
    const list = alphabeticalList(plan, seating, "el");
    expect(list.map((e) => e.guest.name)).toEqual(["αλέξης", "Άννα", "Βασίλης", "Ωραιόπουλος"]);
    expect(list[1].table?.label).toBe("Τραπέζι 2");
    expect(list[1].seat).toBe(1);
    expect(list[0].table).toBeUndefined();
    expect(byInitial(list).map((s) => s.letter)).toEqual(["Α", "Β", "Ω"]);
  });

  it("orders tables by number, not by text, and lists every seat", () => {
    const { plan, seating } = fixture();
    const lists = tableLists(plan, seating, "el");
    expect(lists.map((l) => l.table.label)).toEqual(["Τραπέζι 2", "Τραπέζι 10"]);
    expect(lists[0].seats.map((s) => s.guest?.name ?? null)).toEqual(["Άννα", null, null]);
    expect(lists[1].stats).toMatchObject({ seated: 1, free: 1 });
  });

  it("writes CSV with a BOM and proper quoting", () => {
    expect(toCsv([["a", "b, c"], ['say "hi"', "x"]])).toBe('﻿a,"b, c"\r\n"say ""hi""",x\r\n');
    expect(fileSafe("Γάμος: Μαρία/Νίκος")).toBe("Γάμος-Μαρία-Νίκος");
  });
});
