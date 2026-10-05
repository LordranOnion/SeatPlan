import type { ID, SeatRef } from "../types";
import { createStore } from "./createStore";

/**
 * Pointer-based drag and drop between the guest list (HTML) and the canvas (Konva).
 * Works the same for mouse, pen and touch, unlike HTML5 drag and drop.
 */

export type DragPayload = { kind: "guest"; guestId: ID; fromSeat?: SeatRef } | { kind: "group"; groupId: ID };

export type DropTarget =
  | { kind: "seat"; seat: SeatRef }
  | { kind: "table"; tableId: ID }
  | { kind: "list" }
  | { kind: "none" };

export interface DragState {
  payload: DragPayload;
  x: number;
  y: number;
  target: DropTarget;
}

export const dnd = createStore<{ drag: DragState | null }>({ drag: null });

type CanvasResolver = (clientX: number, clientY: number, payload: DragPayload) => DropTarget;
let canvasResolver: CanvasResolver | null = null;
let dropHandler: ((payload: DragPayload, target: DropTarget) => void) | null = null;
let lastDropAt = 0;

export const setCanvasResolver = (fn: CanvasResolver | null) => {
  canvasResolver = fn;
};
export const setDropHandler = (fn: typeof dropHandler) => {
  dropHandler = fn;
};

/** True right after a drop, so the click that follows the release can be ignored. */
export const justDropped = () => Date.now() - lastDropAt < 250;

function resolveTarget(x: number, y: number, payload: DragPayload): DropTarget {
  const el = document.elementFromPoint(x, y);
  if (!el) return { kind: "none" };
  if (el.closest('[data-dropzone="list"]')) return { kind: "list" };
  if (el.closest('[data-dropzone="canvas"]') && canvasResolver) return canvasResolver(x, y, payload);
  return { kind: "none" };
}

/**
 * Starts tracking a potential drag from a pointerdown. The drag becomes active once the
 * pointer moves more than `threshold` pixels, so plain clicks and taps still work.
 */
export function beginDrag(payload: DragPayload, down: PointerEvent, threshold = 5): void {
  const startX = down.clientX;
  const startY = down.clientY;
  let active = false;

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== down.pointerId) return;
    if (!active) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < threshold) return;
      active = true;
      document.body.classList.add("is-dragging");
    }
    ev.preventDefault();
    dnd.set({ drag: { payload, x: ev.clientX, y: ev.clientY, target: resolveTarget(ev.clientX, ev.clientY, payload) } });
  };

  const end = (ev: PointerEvent) => {
    if (ev.pointerId !== down.pointerId) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    document.body.classList.remove("is-dragging");
    if (active) {
      lastDropAt = Date.now();
      if (ev.type === "pointerup") dropHandler?.(payload, resolveTarget(ev.clientX, ev.clientY, payload));
    }
    dnd.set({ drag: null });
  };

  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}
