// In-memory PracticeApi that mimics the CONTRACT of start_practice / practice_question / submit_pyq_answer / finish_practice (server-side grading,
// answer key held ONLY inside this closure, ownership, one attempt per question per session). It is NOT the database and proves nothing about it.
import { userMessage, type ErrorCode } from "@/lib/study/errors";
import type { ApiResult } from "@/lib/study/api";
import type { PracticeApi } from "@/lib/practice/api";
import type { Difficulty, PracticeQuestion, PracticeSession, PracticeSummary, StartRequest, SubmitResult } from "@/types/practice";

export interface FakeQuestion { id: string; question: string; options: Record<string, string>; correct: string; explanation: string | null; difficulty: Difficulty | null; paper: string | null; exam: string; year: number; topicId: string; topicTitle: string }
interface S { id: string; owner: string; req: StartRequest; ids: string[]; state: "active" | "completed" | "abandoned"; at: Map<string, { selected: string; ok: boolean; t: number | null }> }
export function createFakePracticeApi(questions: FakeQuestion[], opts: { user?: string } = {}) {
  let user = opts.user ?? "A", n = 0, networkDown = false, submits = 0;
  const sessions = new Map<string, S>(), failures: { method: string | null; code: ErrorCode }[] = [], pastAttempts = new Map<string, boolean>();
  const bad = <T,>(code: ErrorCode): ApiResult<T> => ({ ok: false, code, error: userMessage(code) });
  async function gate<T>(m: string, fn: () => ApiResult<T>): Promise<ApiResult<T>> {
    if (networkDown) return bad("network");
    const i = failures.findIndex((f) => f.method === null || f.method === m);
    if (i >= 0) { const [f] = failures.splice(i, 1); return bad(f.code); }
    return fn();
  }
  const json = (s: S): PracticeSession => ({ id: s.id, scope_type: s.req.scope, scope_id: s.req.scopeId, state: s.state, pyq_ids: [...s.ids], total: s.ids.length, started_at: "2099-01-01T00:00:00Z", ended_at: s.state === "active" ? null : "2099-01-01T01:00:00Z",
    answered: [...s.at.entries()].map(([pyq_id, a]) => ({ pyq_id, selected: a.selected, is_correct: a.ok, time_taken_seconds: a.t })) });
  const mine = (id: string) => { const s = sessions.get(id); return s && s.owner === user ? s : null; };
  const same = (a: StartRequest, b: StartRequest) => a.scope === b.scope && a.scopeId === b.scopeId && a.difficulty === b.difficulty && a.paper === b.paper;

  const api: PracticeApi = {
    mode: "fixture",
    start: (req) => gate("start", () => {
      for (const s of sessions.values()) if (s.owner === user && s.state === "active") { if (same(s.req, req)) return { ok: true, data: json(s) }; s.state = "abandoned"; }
      const pool = questions.filter((q) => (!req.difficulty || q.difficulty === req.difficulty) && (!req.paper || q.paper === req.paper))
        .sort((a, b) => Number(pastAttempts.has(a.id)) - Number(pastAttempts.has(b.id)) || a.id.localeCompare(b.id)).slice(0, req.count);   // never-attempted first, then id (deterministic)
      if (!pool.length) return bad("not_found");
      const s: S = { id: `fixture-session-${++n}`, owner: user, req, ids: pool.map((q) => q.id), state: "active", at: new Map() };
      sessions.set(s.id, s); return { ok: true, data: json(s) };
    }),
    state: (id) => gate("state", () => { const s = mine(id); return s ? { ok: true, data: json(s) } : bad("not_found"); }),
    question: (id, pyq) => gate("question", () => {
      const s = mine(id); if (!s) return bad("not_found");
      const pos = s.ids.indexOf(pyq); if (pos < 0) return bad("invalid");
      const q = questions.find((x) => x.id === pyq)!, a = s.at.get(pyq);
      const out: PracticeQuestion = { pyq_id: q.id, position: pos + 1, total: s.ids.length, session_state: s.state, question: q.question, options: q.options, source_ref: null, difficulty: q.difficulty, exam: q.exam, year: q.year, tier: null, shift: null,
        answer: a ? { selected: a.selected, is_correct: a.ok, correct_answer: q.correct, explanation: q.explanation, time_taken_seconds: a.t } : null,
        topics: a ? [{ id: q.topicId, title: q.topicTitle }] : null, foundation: null };
      return { ok: true, data: out };
    }),
    submit: (id, pyq, selected, seconds) => gate("submit", () => {
      submits++;
      const s = mine(id); if (!s) return bad("not_found");
      if (s.state !== "active") return bad("ended");
      if (!s.ids.includes(pyq)) return bad("invalid");
      const q = questions.find((x) => x.id === pyq)!;
      const prev = s.at.get(pyq);
      const res = (dup: boolean, sel: string, ok: boolean): ApiResult<SubmitResult> => ({ ok: true, data: { is_correct: ok, selected: sel, correct_answer: q.correct, explanation: q.explanation, duplicate: dup, answered: s.at.size, total: s.ids.length } });
      if (prev) return res(true, prev.selected, prev.ok);                          // duplicate: ORIGINAL result, nothing changes
      if (!(selected in q.options)) return bad("invalid");
      const ok = selected === q.correct; s.at.set(pyq, { selected, ok, t: seconds }); pastAttempts.set(pyq, ok);
      return res(false, selected, ok);
    }),
    finish: (id, abandon) => gate("finish", () => {
      const s = mine(id); if (!s) return bad("not_found");
      if (s.state === "active") s.state = abandon ? "abandoned" : "completed";
      const att = [...s.at.values()], ok = att.filter((a) => a.ok).length, byTopic = new Map<string, { t: string; ok: number; n: number }>();
      for (const [pyq, a] of s.at) { const q = questions.find((x) => x.id === pyq)!; const e = byTopic.get(q.topicId) ?? { t: q.topicTitle, ok: 0, n: 0 }; e.n++; if (a.ok) e.ok++; byTopic.set(q.topicId, e); }
      const weak = s.state === "completed" ? [...byTopic.entries()].filter(([, e]) => e.n >= 3 && e.ok / e.n < 0.5).map(([topic_id, e]) => ({ topic_id, title: e.t, weak_reason: "low_accuracy", recent_accuracy: Math.round((100 * e.ok) / e.n) })) : [];
      const sum: PracticeSummary = { session_id: s.id, state: s.state as "completed" | "abandoned", scope_type: s.req.scope, scope_id: s.req.scopeId, planned: s.ids.length, attempted: att.length, correct: ok, incorrect: att.length - ok, skipped: s.ids.length - att.length,
        accuracy: att.length ? Math.round((100 * ok) / att.length) : null, total_seconds: att.reduce((x, a) => x + (a.t ?? 0), 0), avg_seconds: att.length ? Math.round(att.reduce((x, a) => x + (a.t ?? 0), 0) / att.length) : null, weak_topics: weak };
      return { ok: true, data: sum };
    }),
    options: (scope, scopeId) => gate("options", () => {
      const by: Partial<Record<Difficulty, number>> = {}; for (const q of questions) if (q.difficulty) by[q.difficulty] = (by[q.difficulty] ?? 0) + 1;
      void scope; void scopeId; return { ok: true, data: { total: questions.length, by_difficulty: by, papers: [] } };
    }),
  };
  return Object.assign(api, { control: {
    asUser: (u: string) => { user = u; }, failNext: (code: ErrorCode, method: string | null = null) => { failures.push({ method, code }); }, setNetworkDown: (v: boolean) => { networkDown = v; },
    submitCalls: () => submits, session: (id: string) => sessions.get(id) ? json(sessions.get(id)!) : null,
  } });
}
export const SAMPLE_QUESTIONS: FakeQuestion[] = ["a", "b", "c", "d"].map((k, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i + 1}`, question: `Fixture question ${k}`, options: { A: `Fixture ${k}1`, B: `Fixture ${k}2`, C: `Fixture ${k}3`, D: `Fixture ${k}4` },
  correct: ["B", "A", "D", "C"][i], explanation: i === 3 ? null : `Fixture explanation ${k}`, difficulty: (["easy", "medium", "hard", "medium"] as Difficulty[])[i], paper: null, exam: "Fixture Exam", year: 2099 - i, topicId: "00000000-0000-4000-8000-0000000000f1", topicTitle: "Fixture Topic" }));
