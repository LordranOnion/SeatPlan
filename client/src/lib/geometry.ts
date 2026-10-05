import type { Point, SeatRef, Table, TableShape } from "../types";

/** Radius of a seat circle, in canvas units. */
export const SEAT_RADIUS = 14;
/** Gap between the table edge and the seat circles. */
export const SEAT_GAP = 6;
const SEAT_OFFSET = SEAT_GAP + SEAT_RADIUS;

export const MAX_SEATS = 60;

/** A seat in table-local coordinates, with the outward unit normal of the edge it sits on. */
export interface SeatPos {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

type SeatLayoutInput = Pick<Table, "shape" | "width" | "height" | "seatCount" | "sides">;

export const TABLE_DEFAULTS: Record<TableShape, { width: number; height: number; seatCount: number }> = {
  round: { width: 120, height: 120, seatCount: 8 },
  rect: { width: 180, height: 90, seatCount: 8 },
  banquet: { width: 300, height: 70, seatCount: 12 },
};

/**
 * Seat positions are derived from the shape and seat count, never stored.
 * Seats are numbered clockwise starting at the top (12 o'clock / top-left).
 */
export function seatPositions(table: SeatLayoutInput): SeatPos[] {
  const n = Math.max(0, Math.floor(table.seatCount));
  if (n === 0) return [];
  switch (table.shape) {
    case "round":
      return roundSeats(n, table.width);
    case "rect":
      return rectSeats(n, table.width, table.height);
    case "banquet":
      return banquetSeats(n, table.width, table.height, table.sides ?? 2);
  }
}

function roundSeats(n: number, diameter: number): SeatPos[] {
  const r = diameter / 2 + SEAT_OFFSET;
  const seats: SeatPos[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    seats.push({ x: r * nx, y: r * ny, nx, ny });
  }
  return seats;
}

/** Splits `n` seats over sides proportionally to their length (largest remainder method). */
export function allocate(n: number, lengths: number[]): number[] {
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= 0) return lengths.map((_, i) => (i === 0 ? n : 0));
  const quotas = lengths.map((l) => (n * l) / total);
  const counts = quotas.map(Math.floor);
  let left = n - counts.reduce((a, b) => a + b, 0);
  const order = quotas
    .map((q, i) => ({ i, rem: q - Math.floor(q) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) counts[order[k].i]++;
  return counts;
}

function rectSeats(n: number, w: number, h: number): SeatPos[] {
  const [top, right, bottom, left] = allocate(n, [w, h, w, h]);
  const seats: SeatPos[] = [];
  const hw = w / 2;
  const hh = h / 2;
  for (let k = 0; k < top; k++) seats.push({ x: -hw + (w * (k + 0.5)) / top, y: -hh - SEAT_OFFSET, nx: 0, ny: -1 });
  for (let k = 0; k < right; k++) seats.push({ x: hw + SEAT_OFFSET, y: -hh + (h * (k + 0.5)) / right, nx: 1, ny: 0 });
  for (let k = 0; k < bottom; k++) seats.push({ x: hw - (w * (k + 0.5)) / bottom, y: hh + SEAT_OFFSET, nx: 0, ny: 1 });
  for (let k = 0; k < left; k++) seats.push({ x: -hw - SEAT_OFFSET, y: hh - (h * (k + 0.5)) / left, nx: -1, ny: 0 });
  return seats;
}

function banquetSeats(n: number, w: number, h: number, sides: 1 | 2): SeatPos[] {
  const top = sides === 1 ? n : Math.ceil(n / 2);
  const bottom = n - top;
  const seats: SeatPos[] = [];
  for (let k = 0; k < top; k++) seats.push({ x: -w / 2 + (w * (k + 0.5)) / top, y: -h / 2 - SEAT_OFFSET, nx: 0, ny: -1 });
  for (let k = 0; k < bottom; k++) seats.push({ x: w / 2 - (w * (k + 0.5)) / bottom, y: h / 2 + SEAT_OFFSET, nx: 0, ny: 1 });
  return seats;
}

export function rotate(p: Point, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Converts a table-local point to world (canvas) coordinates. */
export function toWorld(table: Pick<Table, "x" | "y" | "rotation">, p: Point): Point {
  const r = rotate(p, table.rotation);
  return { x: table.x + r.x, y: table.y + r.y };
}

/** Converts a world point to table-local coordinates. */
export function toLocal(table: Pick<Table, "x" | "y" | "rotation">, p: Point): Point {
  return rotate({ x: p.x - table.x, y: p.y - table.y }, -table.rotation);
}

export function seatWorldPositions(table: Table): (SeatPos & { wx: number; wy: number })[] {
  return seatPositions(table).map((s) => {
    const w = toWorld(table, s);
    return { ...s, wx: w.x, wy: w.y };
  });
}

/** The seat nearest to `p` within `tolerance` canvas units of its edge, if any. */
export function seatAt(tables: Iterable<Table>, p: Point, tolerance = SEAT_RADIUS * 0.6): SeatRef | null {
  let best: SeatRef | null = null;
  let bestDist = SEAT_RADIUS + tolerance;
  for (const table of tables) {
    const local = toLocal(table, p);
    const seats = seatPositions(table);
    for (let i = 0; i < seats.length; i++) {
      const d = Math.hypot(seats[i].x - local.x, seats[i].y - local.y);
      if (d < bestDist) {
        bestDist = d;
        best = { tableId: table.id, index: i };
      }
    }
  }
  return best;
}

/** True when `p` lies on the table surface (or within `margin` of it). */
export function pointInTable(table: Table, p: Point, margin = 0): boolean {
  const local = toLocal(table, p);
  if (table.shape === "round") return Math.hypot(local.x, local.y) <= table.width / 2 + margin;
  return Math.abs(local.x) <= table.width / 2 + margin && Math.abs(local.y) <= table.height / 2 + margin;
}

/** The topmost table under `p`, counting the ring of seats around it as part of the table. */
export function tableAt(tables: Table[], p: Point): Table | null {
  for (let i = tables.length - 1; i >= 0; i--) {
    if (pointInTable(tables[i], p, SEAT_OFFSET + SEAT_RADIUS)) return tables[i];
  }
  return null;
}

export function snapTo(value: number, grid: number): number {
  return grid > 0 ? Math.round(value / grid) * grid : value;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const overlaps = (a: Bounds, b: Bounds, gap: number) =>
  a.minX < b.maxX + gap && b.minX < a.maxX + gap && a.minY < b.maxY + gap && b.minY < a.maxY + gap;

/**
 * The point nearest to `at` (searching outward on a grid) where an item with the given
 * half-extents does not overlap any of `occupied`. Falls back to `at` when the area is crowded.
 */
export function findFreeSpot(at: Point, halfW: number, halfH: number, occupied: Bounds[], step = 40): Point {
  const fits = (p: Point) => {
    const b = { minX: p.x - halfW, minY: p.y - halfH, maxX: p.x + halfW, maxY: p.y + halfH };
    // Leave room between items for the guest names written outside the seats.
    return occupied.every((o) => !overlaps(b, o, 90));
  };
  if (fits(at)) return at;
  for (let ring = 1; ring <= 30; ring++) {
    const candidates: Point[] = [];
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) candidates.push({ x: at.x + dx * step, y: at.y + dy * step });
      }
    }
    candidates.sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y));
    const free = candidates.find(fits);
    if (free) return free;
  }
  return at;
}

export function rectBounds(item: { x: number; y: number; width: number; height: number; rotation: number }): Bounds {
  const corners = [
    { x: -item.width / 2, y: -item.height / 2 },
    { x: item.width / 2, y: -item.height / 2 },
    { x: item.width / 2, y: item.height / 2 },
    { x: -item.width / 2, y: item.height / 2 },
  ].map((c) => toWorld(item, c));
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
  };
}

/** Axis-aligned bounds of a table including its seats, in world coordinates. */
export function tableBounds(table: Table): { minX: number; minY: number; maxX: number; maxY: number } {
  const pad = SEAT_OFFSET + SEAT_RADIUS;
  const hw = table.width / 2 + pad;
  const hh = (table.shape === "round" ? table.width : table.height) / 2 + pad;
  const corners = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((c) => toWorld(table, c));
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
  };
}
