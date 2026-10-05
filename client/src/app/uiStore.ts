import type { ID, Point } from "../types";
import { createStore } from "./createStore";

export type Selection = { kind: "table" | "fixture"; id: ID } | null;

export type Dialog =
  | { type: "guest"; guestId?: ID }
  | { type: "import" }
  | { type: "share" }
  | { type: "export" }
  | { type: "settings" }
  | null;

export type PrintJob = { kind: "plan"; image: string } | { kind: "alphabetical" } | { kind: "tables" } | null;

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "warn" | "error";
}

interface UiState {
  selection: Selection;
  /** Guest picked in the list for tap-to-seat (tablet friendly alternative to dragging). */
  pickedGuestId: ID | null;
  sidebarOpen: boolean;
  dialog: Dialog;
  printJob: PrintJob;
  toasts: Toast[];
}

export const ui = createStore<UiState>({
  selection: null,
  pickedGuestId: null,
  sidebarOpen: true,
  dialog: null,
  printJob: null,
  toasts: [],
});

let toastSeq = 0;

export function toast(text: string, tone: Toast["tone"] = "info", ms = 5000): void {
  const id = ++toastSeq;
  ui.set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
  setTimeout(() => ui.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

/** Functions the canvas exposes to the rest of the UI. */
export interface CanvasApi {
  /** World coordinates of the center of the visible area. */
  viewCenter(): Point;
  fitToContent(): void;
  zoomBy(factor: number): void;
  /** PNG data URL of the whole plan, without selection or cursors. */
  renderImage(pixelRatio?: number): { url: string; width: number; height: number } | null;
}

let canvasApi: CanvasApi | null = null;
export const setCanvasApi = (api: CanvasApi | null) => {
  canvasApi = api;
};
export const getCanvasApi = () => canvasApi;
