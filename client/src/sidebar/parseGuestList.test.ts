import { describe, expect, it } from "vitest";
import { parseGuestList, splitLine } from "./parseGuestList";

describe("parseGuestList", () => {
  it("reads one name per line, skipping blanks", () => {
    expect(parseGuestList("Μαρία Παπαδοπούλου\n\n  Nikos  \r\nJohn Smith\n")).toEqual([
      { name: "Μαρία Παπαδοπούλου" },
      { name: "Nikos" },
      { name: "John Smith" },
    ]);
  });

  it("reads CSV columns name, group, child, note", () => {
    expect(parseGuestList("Maria, Papadopoulos, , vegetarian\nNikos, Papadopoulos, yes, high chair")).toEqual([
      { name: "Maria", group: "Papadopoulos", note: "vegetarian" },
      { name: "Nikos", group: "Papadopoulos", isChild: true, note: "high chair" },
    ]);
  });

  it("uses a header row (English or Greek) to map columns in any order", () => {
    const csv = "Σημείωση;Όνομα;Παιδί;Οικογένεια\nκαρεκλάκι;Ελένη;ναι;Γεωργίου\n;Κώστας;;Γεωργίου";
    expect(parseGuestList(csv)).toEqual([
      { name: "Ελένη", group: "Γεωργίου", isChild: true, note: "καρεκλάκι" },
      { name: "Κώστας", group: "Γεωργίου" },
    ]);
  });

  it("handles tabs, quotes and a BOM", () => {
    expect(parseGuestList('﻿name\tgroup\n"Smith, John"\t"The ""Smiths"""')).toEqual([
      { name: "Smith, John", group: 'The "Smiths"' },
    ]);
    expect(splitLine('"a, b",c', ",")).toEqual(["a, b", "c"]);
  });
});
