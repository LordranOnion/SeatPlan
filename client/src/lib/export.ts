import type { Guest, Plan, Table } from "../types";
import { serializePlan } from "./migrate";
import { compareNames, seatKey, tableStats, type Seating, type TableStats } from "./seating";

export interface AlphaEntry {
  guest: Guest;
  groupName?: string;
  table?: Table;
  seat?: number; // 1-based
}

/** Alphabetical guest list with table, for the entrance board. */
export function alphabeticalList(plan: Plan, seating: Seating, locale?: string): AlphaEntry[] {
  return Object.values(plan.guests)
    .map((guest) => {
      const seat = seating.seatOf.get(guest.id);
      return {
        guest,
        groupName: guest.groupId ? plan.groups[guest.groupId]?.name : undefined,
        table: seat ? plan.tables[seat.tableId] : undefined,
        seat: seat ? seat.index + 1 : undefined,
      };
    })
    .sort((a, b) => compareNames(a.guest, b.guest, locale));
}

/** Groups entries by their first letter (Unicode-aware, accents folded: "Ά" goes under "Α"). */
export function byInitial(entries: AlphaEntry[]): { letter: string; entries: AlphaEntry[] }[] {
  const out: { letter: string; entries: AlphaEntry[] }[] = [];
  for (const e of entries) {
    const first = [...e.guest.name.trim()][0] ?? "#";
    const letter = first.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleUpperCase();
    const last = out[out.length - 1];
    if (last && last.letter === letter) last.entries.push(e);
    else out.push({ letter, entries: [e] });
  }
  return out;
}

export interface TableList {
  table: Table;
  stats: TableStats;
  seats: { index: number; guest?: Guest }[];
}

export function compareLabels(a: string, b: string, locale?: string): number {
  return a.localeCompare(b, locale, { numeric: true, sensitivity: "base" });
}

/** Per-table lists, for the venue staff. */
export function tableLists(plan: Plan, seating: Seating, locale?: string): TableList[] {
  return Object.values(plan.tables)
    .sort((a, b) => compareLabels(a.label, b.label, locale))
    .map((table) => ({
      table,
      stats: tableStats(plan, seating, table.id),
      seats: Array.from({ length: table.seatCount }, (_, index) => {
        const guestId = seating.occupant.get(seatKey({ tableId: table.id, index }));
        return { index, guest: guestId ? plan.guests[guestId] : undefined };
      }),
    }));
}

function csvCell(value: string): string {
  return /[",;\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: string[][]): string {
  // BOM so spreadsheet apps open Greek text as UTF-8.
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function fileSafe(name: string): string {
  return (name.trim() || "seating-plan")
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadPlanJson(plan: Plan): void {
  downloadBlob(new Blob([serializePlan(plan)], { type: "application/json" }), `${fileSafe(plan.name)}.seatplan.json`);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Draws the title block and the plan image onto one canvas. Text is drawn by the browser,
 * so Greek and any other script renders correctly in the PDF.
 */
export async function composeFloorPlan(
  image: { url: string; width: number; height: number },
  title: string,
  subtitle: string,
): Promise<HTMLCanvasElement> {
  const img = await loadImage(image.url);
  const scale = img.width / image.width;
  const header = Math.round(90 * scale);
  const pad = Math.round(24 * scale);
  const canvas = document.createElement("canvas");
  canvas.width = img.width + pad * 2;
  canvas.height = img.height + header + pad;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1f2733";
  ctx.font = `bold ${Math.round(30 * scale)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText(title, pad, Math.round(18 * scale));
  ctx.fillStyle = "#56606e";
  ctx.font = `${Math.round(16 * scale)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.fillText(subtitle, pad, Math.round(58 * scale));
  ctx.drawImage(img, pad, header);
  return canvas;
}

/** Client-side PDF of the floor plan, fitted to one A4 page (or A3 for large rooms). */
export async function downloadFloorPlanPdf(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const landscape = canvas.width >= canvas.height;
  const format = Math.max(canvas.width, canvas.height) > 5000 ? "a3" : "a4";
  const pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const fit = Math.min((pageW - margin * 2) / canvas.width, (pageH - margin * 2) / canvas.height);
  const w = canvas.width * fit;
  const h = canvas.height * fit;
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", (pageW - w) / 2, (pageH - h) / 2, w, h, undefined, "FAST");
  pdf.save(filename);
}
