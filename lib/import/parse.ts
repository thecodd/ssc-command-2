// Parses CSV/JSON curriculum files into one normalized structure.
export interface ImportRow { [k: string]: unknown }
export interface ImportData { source?: ImportRow; ncert: ImportRow[]; ssc: ImportRow[]; mappings: ImportRow[] }

export function parseCsv(text: string): ImportRow[] {
  const rows: string[][] = []; let cur: string[] = [], f = "", q = false;
  const t = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { cur.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; cur.push(f); f = ""; if (cur.some((x) => x.trim())) rows.push(cur); cur = []; }
    else f += c;
  }
  cur.push(f); if (cur.some((x) => x.trim())) rows.push(cur);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const clean = (r: ImportRow): ImportRow => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== "" && v !== null && v !== undefined));

export function toImportData(kind: "json" | "csv", text: string): ImportData {
  if (kind === "json") {
    const j = JSON.parse(text);
    return { source: j.source, ncert: (j.ncert ?? []).map(clean), ssc: (j.ssc ?? []).map(clean), mappings: (j.mappings ?? []).map(clean) };
  }
  const d: ImportData = { ncert: [], ssc: [], mappings: [] };
  for (const raw of parseCsv(text)) {
    const r = clean(raw); const type = String(r.type ?? "").toLowerCase();
    if (type === "ncert") d.ncert.push(r); else if (type === "ssc") d.ssc.push(r); else if (type === "mapping") d.mappings.push(r);
    else throw new Error(`Unknown row type "${r.type ?? ""}". Use ncert, ssc or mapping.`);
  }
  return d;
}
export const parseConcepts = (v: unknown): string[] => Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === "string" ? v.split("|").map((s) => s.trim()).filter(Boolean) : [];
export const parseBool = (v: unknown, d = true) => v === undefined ? d : ["true", "yes", "1", "y"].includes(String(v).toLowerCase());
