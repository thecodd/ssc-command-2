/** Timed mock mode: SSC CGL Tier 1 is 100 questions in 60 minutes, so the budget is 36 seconds per question.
 *  The countdown is a display and a trigger to finish the session; grading and the answer key stay on the server. */
export const SECONDS_PER_QUESTION = 36;
export const mockSeconds = (questions: number) => Math.max(1, Math.round(questions)) * SECONDS_PER_QUESTION;
export const parseTimed = (v: string | undefined | null) => v === "1";
/** Seconds left given a stored absolute deadline (ms epoch), never negative. */
export const remainingSeconds = (deadlineMs: number, nowMs: number) => Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
/** Reads or creates the deadline so a refresh keeps counting from the original start. Storage may be unavailable (private mode). */
export function ensureDeadline(sessionId: string, budgetSeconds: number, nowMs: number, store?: Pick<Storage, "getItem" | "setItem">): number {
  const key = `cgl-mock-deadline:${sessionId}`;
  try {
    const s = store ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
    const saved = Number(s?.getItem(key));
    if (Number.isFinite(saved) && saved > 0) return saved;
    const d = nowMs + budgetSeconds * 1000; s?.setItem(key, String(d)); return d;
  } catch { return nowMs + budgetSeconds * 1000; }
}
export const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
