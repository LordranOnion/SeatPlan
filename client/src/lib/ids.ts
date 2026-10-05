const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Random 12-character ID (about 62 bits), safe to compare as strings. */
export function newId(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let id = "";
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
  return id;
}

/** Group colors: distinct, readable with dark text, and friendly on paper. */
export const GROUP_COLORS = [
  "#f4a261",
  "#8ecae6",
  "#b5e48c",
  "#f6bd60",
  "#cdb4db",
  "#ffafcc",
  "#90dbf4",
  "#e9c46a",
  "#a3c4f3",
  "#98f5e1",
  "#f28482",
  "#c9ada7",
];

export function nextGroupColor(used: string[]): string {
  const counts = new Map(GROUP_COLORS.map((c) => [c, 0]));
  for (const c of used) if (counts.has(c)) counts.set(c, counts.get(c)! + 1);
  let best = GROUP_COLORS[0];
  for (const c of GROUP_COLORS) if (counts.get(c)! < counts.get(best)!) best = c;
  return best;
}

/** Colors for collaborators' cursors and highlights. */
export const PRESENCE_COLORS = ["#e63946", "#2a9d8f", "#7b2cbf", "#f77f00", "#1d4ed8", "#d6336c", "#2b9348", "#9c6644"];
