/** Exam-style mock: answers are kept as a DRAFT on this device while the test runs (free navigation, changing and flagging answers),
 *  then sent once, in question order, through the existing server-graded submit. The server still derives every is_correct;
 *  nothing here ever holds an answer key. */
export interface Draft { sel: Record<string, string>; flagged: string[] }
export type Status = "answered" | "flagged" | "unanswered";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const key = (sessionId: string) => `cgl-mock-draft:${sessionId}`;
const defaultStore = (): Store | undefined => { try { return typeof localStorage !== "undefined" ? localStorage : undefined; } catch { return undefined; } };
export const emptyDraft = (): Draft => ({ sel: {}, flagged: [] });

/** Keeps only ids that belong to the session and options that exist, so a tampered or stale draft can never submit anything else. */
export function sanitizeDraft(raw: unknown, ids: string[]): Draft {
  const ok = new Set(ids), d = emptyDraft();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as { sel?: Record<string, unknown>; flagged?: unknown };
  for (const [id, v] of Object.entries(r.sel ?? {})) if (ok.has(id) && typeof v === "string" && v.length > 0 && v.length <= 8) d.sel[id] = v;
  if (Array.isArray(r.flagged)) d.flagged = [...new Set(r.flagged.filter((x): x is string => typeof x === "string" && ok.has(x)))];
  return d;
}
export function loadDraft(sessionId: string, ids: string[], store: Store | undefined = defaultStore()): Draft {
  try { const t = store?.getItem(key(sessionId)); return t ? sanitizeDraft(JSON.parse(t), ids) : emptyDraft(); } catch { return emptyDraft(); }
}
export function saveDraft(sessionId: string, d: Draft, store: Store | undefined = defaultStore()) { try { store?.setItem(key(sessionId), JSON.stringify(d)); } catch { /* storage unavailable: the test still works, just without refresh recovery */ } }
export function clearDraft(sessionId: string, store: Store | undefined = defaultStore()) { try { store?.removeItem(key(sessionId)); } catch { /* ignore */ } }

export function setAnswer(d: Draft, id: string, option: string | null): Draft {
  const sel = { ...d.sel }; if (option === null) delete sel[id]; else sel[id] = option; return { ...d, sel };
}
export const toggleFlag = (d: Draft, id: string): Draft => ({ ...d, flagged: d.flagged.includes(id) ? d.flagged.filter((x) => x !== id) : [...d.flagged, id] });
export const statusOf = (d: Draft, id: string): Status => (d.flagged.includes(id) ? "flagged" : d.sel[id] ? "answered" : "unanswered");
export function counts(d: Draft, ids: string[]) {
  const answered = ids.filter((i) => d.sel[i]).length;
  return { answered, unanswered: ids.length - answered, flagged: ids.filter((i) => d.flagged.includes(i)).length };
}
/** What still has to be sent: drafted answers, in question order, minus anything the server already holds. */
export const pendingSubmissions = (ids: string[], d: Draft, alreadyAnswered: Iterable<string>): { id: string; selected: string }[] => {
  const done = new Set(alreadyAnswered);
  return ids.filter((i) => d.sel[i] && !done.has(i)).map((i) => ({ id: i, selected: d.sel[i] }));
};
