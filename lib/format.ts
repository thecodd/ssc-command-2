// Stored lifecycle only. "Strong", "Weak", "Needs revision", "Mastered" are DERIVED (lib/learning/rules.ts MASTERY_LABEL).
export const STATUS_LABEL: Record<string, string> = { not_started: "Not started", learning: "In progress", completed: "Completed" };
export const RELEVANCE_LABEL: Record<string, string> = { very_high: "Very High", high: "High", medium: "Medium", low: "Low", not_mapped: "Not mapped" };
export const PRIORITY_LABEL: Record<string, string> = { very_high: "Very High", high: "High", medium: "Medium", low: "Low" };
export const MAPPING_LABEL: Record<string, string> = { foundation: "Foundation", direct: "Direct", supporting: "Supporting", background: "Background" };
export const RESOURCE_TYPES = ["pdf", "video", "website", "book", "notes", "other"] as const;
export const pad2 = (n: number) => String(n).padStart(2, "0");
export const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
export const fmtDuration = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };
export const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
export const escLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
