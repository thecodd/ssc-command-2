// In-memory RevisionApi for the dev preview and Node tests. The scheduling rule here is the SQL-derived Node ORACLE (database/tests/reference/learning_oracle.js,
// which reads its constants out of the migrations): it is a TEST DOUBLE for review_revision(), not production logic and not proof about the database.
import type { ErrorCode } from "@/lib/study/errors";
import { userMessage } from "@/lib/study/errors";
import type { ApiResult } from "@/lib/study/api";
import type { RevisionApi, SubmitReq } from "@/lib/revision/api";
import type { IntervalPreview, Rating, ReviewOutcome, ReviewState } from "@/types/revision";
declare const require: any;
const oracle = require("../../database/tests/reference/learning_oracle.js") as { nextReview(step: number, rating: string, ladder: number[], today: string): { step: number; graduated: boolean; interval: number | null; due: string | null } };

export interface FakeRevOptions { ladder?: number[]; step?: number; today?: string; scheduleId?: string; latencyMs?: number; queueAfter?: string | null }
export function createFakeRevisionApi(o: FakeRevOptions = {}) {
  const ladder = o.ladder ?? [1, 3, 7, 15, 30], today = o.today ?? "2099-01-10", id = o.scheduleId ?? "fixture-schedule";
  let step = o.step ?? 0, done = false, dueDate: string | null = today, reviews = 0, mastery: ReviewOutcome["mastery"] = "needs_revision";
  const submits: SubmitReq[] = []; const failures: ErrorCode[] = []; let applyThenFail: ErrorCode | null = null;
  const delay = () => (o.latencyMs ? new Promise<void>((r) => setTimeout(r, o.latencyMs)) : Promise.resolve());
  const bad = <T,>(code: ErrorCode): ApiResult<T> => ({ ok: false, code, error: userMessage(code) });
  const preview = (): IntervalPreview[] => (["hard", "good", "easy"] as Rating[]).map((r) => { const n = oracle.nextReview(step, r, ladder, today); return { rating: r, step: n.step, graduated: n.graduated, intervalDays: n.interval, dueDate: n.due }; });
  const stateNow = (): ReviewState => ({ scheduleId: id, entityType: "ssc_topic", entityId: "fixture-entity", done, step, dueDate: done ? null : dueDate, bucket: done ? null : "today", daysUntil: done ? null : 0, ladder, preview: done ? [] : preview() });
  const api: RevisionApi = {
    mode: "fixture",
    async submit(req) {
      await delay(); submits.push(req);
      const f = failures.shift(); if (f) return bad(f);
      if (done || req.expectedStep !== step) return bad("conflict");                         // the database's expected_step guard (PT409)
      const n = oracle.nextReview(step, req.rating, ladder, today);
      step = n.step; done = n.graduated; dueDate = n.due; reviews++; mastery = req.rating === "hard" ? "weak" : "learning";
      if (applyThenFail) { const c = applyThenFail; applyThenFail = null; return bad(c); }  // the write LANDED but the response was lost
      return { ok: true, data: { rating: req.rating, graduated: n.graduated, dueDate: n.due, intervalDays: n.interval, step: n.step, mastery, whyHeadline: mastery, whyDetail: "Fixture explanation.", nextScheduleId: o.queueAfter ?? null, dueRemaining: o.queueAfter ? 1 : 0 } };
    },
    async state() { await delay(); return { ok: true, data: stateNow() }; },
  };
  return Object.assign(api, { control: { failNext: (c: ErrorCode) => { failures.push(c); }, landThenFail: (c: ErrorCode) => { applyThenFail = c; }, otherTabReviews(rating: Rating) { const n = oracle.nextReview(step, rating, ladder, today); step = n.step; done = n.graduated; dueDate = n.due; reviews++; },
    submits: () => submits, reviews: () => reviews, current: stateNow } });
}
