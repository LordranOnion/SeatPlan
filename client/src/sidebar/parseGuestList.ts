import type { ImportRow } from "../store/actions";

const HEADER_ALIASES: Record<keyof ImportRow, string[]> = {
  name: ["name", "full name", "guest", "όνομα", "ονοματεπώνυμο", "καλεσμένος"],
  group: ["group", "family", "party", "ομάδα", "οικογένεια", "παρέα"],
  isChild: ["child", "kid", "is child", "παιδί"],
  note: ["note", "notes", "comment", "σημείωση", "σημειώσεις", "σχόλιο"],
};

const TRUTHY = new Set(["1", "y", "yes", "true", "x", "✓", "child", "kid", "ν", "ναι", "παιδί"]);

/** Splits one delimited line, honouring double quotes ("a, b" stays one field; "" is a quote). */
export function splitLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (ch === delimiter) {
      fields.push(field.trim());
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

function detectDelimiter(lines: string[]): string | null {
  for (const d of ["\t", ";", ","]) {
    if (lines.some((l) => l.includes(d))) return d;
  }
  return null;
}

function headerIndex(cells: string[]): Partial<Record<keyof ImportRow, number>> | null {
  const index: Partial<Record<keyof ImportRow, number>> = {};
  cells.forEach((cell, i) => {
    const c = cell.trim().toLocaleLowerCase();
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(c) && index[key as keyof ImportRow] === undefined) index[key as keyof ImportRow] = i;
    }
  });
  return index.name !== undefined ? index : null;
}

/**
 * Parses a pasted guest list or a CSV file.
 * - One name per line, or
 * - Delimited rows (comma, semicolon or tab): name, group, child, note.
 *   A header row with recognised column names (English or Greek) may reorder columns.
 */
export function parseGuestList(text: string): ImportRow[] {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines);
  if (!delimiter) return lines.map((name) => ({ name }));

  const rows = lines.map((l) => splitLine(l, delimiter));
  let columns: Partial<Record<keyof ImportRow, number>> = { name: 0, group: 1, isChild: 2, note: 3 };
  const header = headerIndex(rows[0]);
  if (header) {
    columns = header;
    rows.shift();
  }

  const out: ImportRow[] = [];
  for (const cells of rows) {
    const get = (key: keyof ImportRow) => (columns[key] !== undefined ? (cells[columns[key]!] ?? "") : "");
    const name = get("name").trim();
    if (!name) continue;
    const row: ImportRow = { name };
    if (get("group").trim()) row.group = get("group").trim();
    if (TRUTHY.has(get("isChild").trim().toLocaleLowerCase())) row.isChild = true;
    if (get("note").trim()) row.note = get("note").trim();
    out.push(row);
  }
  return out;
}
