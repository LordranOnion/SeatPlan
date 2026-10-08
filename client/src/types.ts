// Logical shape of a plan. In the app it is stored as a Yjs document
// (maps keyed by ID, see store/schema.ts), not as plain objects.

export type ID = string;

export interface Plan {
  id: ID;
  name: string; // "Baptism reception"
  date?: string; // ISO date
  room: Room;
  tables: Record<ID, Table>;
  fixtures: Record<ID, Fixture>;
  guests: Record<ID, Guest>;
  groups: Record<ID, Group>;
  assignments: Record<ID, SeatRef>; // guestId -> seat
  version: number; // schema version, for migrations
}

export interface Room {
  width: number; // canvas units
  height: number;
  gridSize: number;
  snap: boolean;
  showGrid: boolean;
  showOutline: boolean;
}

/** "u" is the Π-shaped table: a head bar with two arms. */
export type TableShape = "round" | "rect" | "banquet" | "u";

export interface Table {
  id: ID;
  label: string; // "Table 4"
  shape: TableShape;
  x: number;
  y: number;
  rotation: number; // degrees
  width: number; // diameter for round
  height: number;
  seatCount: number;
  /** Banquet: seats on one long side or both. Π-shaped: seats outside only, or outside and inside. */
  sides?: 1 | 2;
  /** Π-shaped tables only: depth of the head bar and the arms. */
  barWidth?: number;
}

export interface SeatRef {
  tableId: ID;
  index: number; // position around the table
}

export interface Guest {
  id: ID;
  name: string;
  groupId?: ID;
  isChild?: boolean;
  note?: string;
}

export interface Group {
  id: ID;
  name: string; // "Papadopoulos family"
  color: string;
}

export interface Fixture {
  id: ID;
  label: string; // "Dance floor"
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface Point {
  x: number;
  y: number;
}
