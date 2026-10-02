// Single home for "what day is it for this user". Storage stays UTC (timestamptz); only bucketing/presentation uses a zone.
export const DEFAULT_TZ = "Asia/Kolkata";
const pad = (n: number) => String(n).padStart(2, "0");

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
function parts(tz: string, ts: number) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(ts)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o;
}
/** Calendar date (YYYY-MM-DD) in `tz` at instant `now`. */
export function todayIn(tz: string, now: Date = new Date()): string {
  const p = parts(tz, now.getTime());
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
/** Pure calendar arithmetic on YYYY-MM-DD strings (no zone involved). */
export function addDaysISO(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const offsetMs = (tz: string, ts: number) => { const p = parts(tz, ts); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000; };
/** The UTC instant at which local midnight of `date` occurs in `tz` (two passes handle DST shifts). */
export function localMidnightUtc(tz: string, date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetMs(tz, guess);
  return new Date(guess - offsetMs(tz, first));
}
/** [start, end) of a local calendar day, as UTC ISO strings for timestamptz queries. */
export function dayBoundsUtc(tz: string, date: string) {
  return { start: localMidnightUtc(tz, date).toISOString(), end: localMidnightUtc(tz, addDaysISO(date, 1)).toISOString() };
}
export function greetingFor(tz: string, now: Date = new Date()): string {
  const h = parts(tz, now.getTime()).hour;
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
/** Formats a YYYY-MM-DD date without any time-zone shift. */
export const formatDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** Whole days from `b` to `a` (a - b) for YYYY-MM-DD strings. Pure calendar arithmetic. */
export function diffDaysISO(a: string, b: string): number {
  const t = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((t(a) - t(b)) / 86400000);
}
