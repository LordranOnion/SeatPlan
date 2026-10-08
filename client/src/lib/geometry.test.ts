import { describe, expect, it } from "vitest";
import type { Table } from "../types";
import { SEAT_RADIUS, allocate, pointInTable, seatAt, seatPositions, tableAt, toLocal, toWorld } from "./geometry";

const table = (patch: Partial<Table>): Table => ({
  id: "t1",
  label: "Table 1",
  shape: "round",
  x: 0,
  y: 0,
  rotation: 0,
  width: 120,
  height: 120,
  seatCount: 8,
  ...patch,
});

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

describe("seatPositions", () => {
  it("returns one position per seat for every shape", () => {
    for (const shape of ["round", "rect", "banquet"] as const) {
      for (const n of [0, 1, 2, 5, 8, 13, 24]) {
        expect(seatPositions(table({ shape, seatCount: n, width: 200, height: 80 }))).toHaveLength(n);
      }
    }
  });

  it("places round seats evenly on a circle, first seat at the top", () => {
    const seats = seatPositions(table({ seatCount: 4 }));
    const r = Math.hypot(seats[0].x, seats[0].y);
    for (const s of seats) expect(close(Math.hypot(s.x, s.y), r)).toBe(true);
    expect(close(seats[0].x, 0)).toBe(true);
    expect(seats[0].y).toBeLessThan(0);
    expect(r).toBeGreaterThan(60 + SEAT_RADIUS);
  });

  it("puts every rect seat outside the table edge, without overlaps", () => {
    const t = table({ shape: "rect", width: 180, height: 90, seatCount: 10 });
    const seats = seatPositions(t);
    for (const s of seats) expect(Math.abs(s.x) > 90 || Math.abs(s.y) > 45).toBe(true);
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        expect(Math.hypot(seats[i].x - seats[j].x, seats[i].y - seats[j].y)).toBeGreaterThan(SEAT_RADIUS);
      }
    }
  });

  it("gives the long sides of a rect table more seats", () => {
    expect(allocate(10, [200, 80, 200, 80])).toEqual([4, 1, 4, 1]);
    expect(allocate(2, [200, 80, 200, 80])).toEqual([1, 0, 1, 0]);
    expect(allocate(7, [1, 1, 1, 1]).reduce((a, b) => a + b)).toBe(7);
  });

  it("seats banquet tables on both long sides, or one side only", () => {
    const both = seatPositions(table({ shape: "banquet", width: 300, height: 70, seatCount: 7 }));
    expect(both.filter((s) => s.y < 0)).toHaveLength(4);
    expect(both.filter((s) => s.y > 0)).toHaveLength(3);
    const one = seatPositions(table({ shape: "banquet", width: 300, height: 70, seatCount: 7, sides: 1 }));
    expect(one.every((s) => s.y < 0)).toBe(true);
  });

  it("seats a Π-shaped table outside only, or also inside, without touching the table or each other", () => {
    const base = { shape: "u" as const, width: 420, height: 320, barWidth: 70, seatCount: 24 };
    const onTable = (s: { x: number; y: number }) => pointInTable(table({ ...base, x: 0, y: 0 }), s, SEAT_RADIUS - 1);
    for (const sides of [1, 2] as const) {
      const seats = seatPositions(table({ ...base, sides }));
      expect(seats).toHaveLength(24);
      for (const s of seats) expect(onTable(s)).toBe(false);
      for (let i = 0; i < seats.length; i++) {
        for (let j = i + 1; j < seats.length; j++) {
          expect(Math.hypot(seats[i].x - seats[j].x, seats[i].y - seats[j].y)).toBeGreaterThan(SEAT_RADIUS * 2);
        }
      }
    }
    // Outside only: every seat is outside the table's bounding box.
    const outside = seatPositions(table({ ...base, sides: 1 }));
    expect(outside.every((s) => Math.abs(s.x) > 210 || s.y < -160)).toBe(true);
    // Outside and inside: some seats sit in the gap between the arms.
    const both = seatPositions(table({ ...base, sides: 2 }));
    expect(both.some((s) => Math.abs(s.x) < 210 - 70 && s.y > -160 + 70)).toBe(true);
  });

  it("keeps a narrow Π's inside free of seats along the arms", () => {
    const seats = seatPositions(table({ shape: "u", width: 200, height: 300, barWidth: 70, seatCount: 20, sides: 2 }));
    expect(seats).toHaveLength(20);
    expect(seats.some((s) => s.nx !== 0 && Math.abs(s.x) < 100)).toBe(false);
  });

  it("re-flows seats when the seat count changes (positions are derived, not stored)", () => {
    const six = seatPositions(table({ seatCount: 6 }));
    const eight = seatPositions(table({ seatCount: 8 }));
    expect(six[1].x).not.toBeCloseTo(eight[1].x);
  });
});

describe("coordinates and hit testing", () => {
  it("round-trips world and local coordinates with rotation", () => {
    const t = table({ x: 300, y: 200, rotation: 37 });
    const p = { x: 12, y: -40 };
    const back = toLocal(t, toWorld(t, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });

  it("finds the seat under a point on a rotated table", () => {
    const t = table({ x: 500, y: 400, rotation: 90, seatCount: 8 });
    const seats = seatPositions(t);
    const world = toWorld(t, seats[3]);
    expect(seatAt([t], { x: world.x + 3, y: world.y - 2 })).toEqual({ tableId: "t1", index: 3 });
    expect(seatAt([t], { x: 0, y: 0 })).toBeNull();
  });

  it("detects points on a table and picks the topmost one", () => {
    const a = table({ id: "a", x: 100, y: 100 });
    const b = table({ id: "b", x: 140, y: 100 });
    expect(pointInTable(a, { x: 100, y: 150 })).toBe(true);
    expect(pointInTable(a, { x: 100, y: 170 })).toBe(false);
    expect(tableAt([a, b], { x: 120, y: 100 })?.id).toBe("b");
    expect(tableAt([a, b], { x: 900, y: 900 })).toBeNull();
  });

  it("treats the open gap of a Π-shaped table as empty floor", () => {
    const u = table({ shape: "u", width: 420, height: 320, barWidth: 70 });
    expect(pointInTable(u, { x: 0, y: -140 })).toBe(true); // head bar
    expect(pointInTable(u, { x: -180, y: 100 })).toBe(true); // left arm
    expect(pointInTable(u, { x: 0, y: 60 })).toBe(false); // the gap
  });
});
