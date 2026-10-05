import type { Point } from "../types";

export const COLORS = {
  canvasBg: "#e9edf2",
  room: "#ffffff",
  roomStroke: "#9aa5b4",
  grid: "#e3e7ee",
  tableFill: "#f7f0e3",
  tableStroke: "#b39b77",
  tableText: "#4a3b28",
  selected: "#2f6fe4",
  drop: "#16a34a",
  seatFree: "#ffffff",
  seatFreeStroke: "#9097a3",
  seatTaken: "#dbe5f7",
  seatTakenStroke: "#56606e",
  seatText: "#1f2733",
  seatNumber: "#9aa1ab",
  nameText: "#2b3440",
  child: "#f59e0b",
  fixtureFill: "#eef2f7",
  fixtureStroke: "#8794a8",
  fixtureText: "#3f4b5c",
};

/** Up to two initials, Unicode-aware ("Μαρία Παπαδοπούλου" -> "ΜΠ"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = [...(parts[0] ?? "")][0] ?? "";
  const last = parts.length > 1 ? ([...parts[parts.length - 1]][0] ?? "") : "";
  return (first + last).toLocaleUpperCase();
}

/**
 * Name labels run outward from the seat along its normal (in world space), so neighbouring
 * labels never overlap. Labels on the left half are turned 180° to stay readable.
 */
export function radialLabel(normal: Point, width: number) {
  const angle = (Math.atan2(normal.y, normal.x) * 180) / Math.PI;
  const flipped = normal.x < -0.01;
  return {
    rotation: flipped ? angle - 180 : angle,
    align: flipped ? ("right" as const) : ("left" as const),
    offsetX: flipped ? width : 0,
  };
}
