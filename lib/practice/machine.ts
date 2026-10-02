import type { ErrorCode } from "@/lib/study/errors";
import type { PracticeQuestion, PracticeSession, PracticeSummary, SubmitResult } from "@/types/practice";

// Pure state machine for one practice session. The server owns: question order (pyq_ids snapshot), grading, the answer key, accuracy.
// The client only remembers WHICH option the learner has picked (not yet submitted) and where it is in the server's order.
export type PPhase = "loading" | "ready" | "submitting" | "answered" | "finishing" | "summary" | "error";
export interface PState {
  phase: PPhase; session: PracticeSession; index: number; question: PracticeQuestion | null; picked: string | null;
  result: SubmitResult | null; summary: PracticeSummary | null; error: { code: ErrorCode; message: string; retry: "load" | "submit" | "finish" } | null; shownAt: number;
}
export type PAction =
  | { t: "enriched"; q: PracticeQuestion } | { t: "load"; index: number } | { t: "loaded"; q: PracticeQuestion; at: number } | { t: "pick"; key: string }
  | { t: "submitting" } | { t: "submitted"; r: SubmitResult; pyq: string; time: number | null }
  | { t: "finishing" } | { t: "summary"; s: PracticeSummary } | { t: "fail"; code: ErrorCode; message: string; retry: "load" | "submit" | "finish" } | { t: "dismiss" };

/** Resume point: first question, in the SERVER's order, that has no attempt yet. -1 when every question is answered. */
export function firstUnanswered(s: Pick<PracticeSession, "pyq_ids" | "answered">): number {
  const done = new Set(s.answered.map((a) => a.pyq_id));
  return s.pyq_ids.findIndex((id) => !done.has(id));
}
export const answeredCount = (s: Pick<PracticeSession, "answered">) => s.answered.length;
export function initialPState(session: PracticeSession): PState {
  const i = firstUnanswered(session);
  const finished = session.state !== "active";
  return { phase: finished || i === -1 ? "finishing" : "loading", session, index: Math.max(0, i), question: null, picked: null, result: null, summary: null, error: null, shownAt: 0 };
}
export function reduce(s: PState, a: PAction): PState {
  switch (a.t) {
    case "load": return { ...s, phase: "loading", index: a.index, question: null, picked: null, result: null, error: null };
    case "loaded": {
      if (s.phase === "summary") return s;
      const ans = a.q.answer;                                            // a refresh landed on an already-answered question: show it as answered
      return { ...s, question: a.q, shownAt: a.at, error: null, phase: ans ? "answered" : "ready", picked: ans ? ans.selected : null,
        result: ans ? { is_correct: ans.is_correct, selected: ans.selected, correct_answer: ans.correct_answer, explanation: ans.explanation, duplicate: true, answered: answeredCount(s.session), total: a.q.total } : null };
    }
    case "enriched": return s.phase === "answered" && s.question && s.question.pyq_id === a.q.pyq_id && a.q.answer ? { ...s, question: a.q } : s;   // adds topics/concept; never touches result or session
    case "pick": return s.phase === "ready" ? { ...s, picked: a.key } : s;           // nothing can change once submitted
    case "submitting": return s.phase === "ready" && s.picked ? { ...s, phase: "submitting", error: null } : s;
    case "submitted": {
      const has = s.session.answered.some((x) => x.pyq_id === a.pyq);
      const answered = has ? s.session.answered : [...s.session.answered, { pyq_id: a.pyq, selected: a.r.selected, is_correct: a.r.is_correct, time_taken_seconds: a.time }];
      return { ...s, phase: "answered", picked: a.r.selected, result: a.r, session: { ...s.session, answered }, error: null };
    }
    case "finishing": return { ...s, phase: "finishing", error: null };
    case "summary": return { ...s, phase: "summary", summary: a.s, error: null, session: { ...s.session, state: a.s.state } };
    case "fail": return { ...s, phase: "error", error: { code: a.code, message: a.message, retry: a.retry } };
    case "dismiss": return { ...s, error: null, phase: s.question ? (s.result ? "answered" : "ready") : "loading" };
  }
}
export const isLast = (s: PState) => firstUnanswered(s.session) === -1;
