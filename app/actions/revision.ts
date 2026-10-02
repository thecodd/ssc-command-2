"use server";
import { revalidatePath } from "next/cache";
import { classifyError, userMessage, type ErrorCode } from "@/lib/study/errors";
import type { ApiResult } from "@/lib/study/api";
import { isUuid } from "@/lib/filters";
import { parseStudyType } from "@/lib/study/routes";
import { nextDueAfter, queueCounts } from "@/lib/revision/queue";
import { explainMastery } from "@/lib/learning/rules";
import * as R from "@/services/revision";
import { getEntitySignals } from "@/services/learning";
import type { Rating, ReviewOutcome, ReviewState } from "@/types/revision";

// Typed {ok, code, error}; `error` is OUR copy, never a database message. Inputs are validated before they reach an RPC.
const COPY: Partial<Record<ErrorCode, string>> = { conflict: "This revision was already updated elsewhere.", ended: "This revision was already completed elsewhere.", not_found: "That revision no longer exists." };
async function run<T>(fn: () => Promise<T>): Promise<ApiResult<T>> {
  try { return { ok: true, data: await fn() }; } catch (e) { const code = classifyError(e); return { ok: false, code, error: COPY[code] ?? userMessage(code) }; }
}
const bad = (): never => { throw Object.assign(new Error("invalid"), { code: "22023" }); };

export async function revisionReviewAction(scheduleId: string, rating: string, expectedStep: number, confidence: number | null, type: string, id: string): Promise<ApiResult<ReviewOutcome>> {
  return run(async () => {
    const t = parseStudyType(type);
    if (!isUuid(scheduleId) || !isUuid(id) || !t || !["easy", "good", "hard"].includes(rating) || !Number.isInteger(expectedStep) || expectedStep < 0) bad();
    if (confidence !== null && (!Number.isInteger(confidence) || confidence < 1 || confidence > 5)) bad();
    const r = await R.reviewRevision(scheduleId, rating as Rating, expectedStep, confidence);
    // everything below is READ from the server after the review: mastery/why from the learning engine, "what next" from revision_queue()
    const [sig, queue] = await Promise.all([getEntitySignals(t!, id).catch(() => null), R.getRevisionQueue().catch(() => null)]);
    const why = explainMastery(sig);
    const next = queue ? nextDueAfter(queue, scheduleId) : null;
    for (const p of ["/revision", "/dashboard", "/study", `/study/${type}/${id}`]) revalidatePath(p);
    return { rating: r.rating, graduated: r.graduated, dueDate: r.due_date, intervalDays: r.interval_days, step: r.step, mastery: sig?.mastery ?? "not_started", whyHeadline: why.headline, whyDetail: why.detail,
      nextScheduleId: next?.schedule_id ?? null, dueRemaining: queue ? queueCounts(queue).due : 0 };
  });
}
export async function revisionStateAction(scheduleId: string): Promise<ApiResult<ReviewState>> {
  return run(async () => { if (!isUuid(scheduleId)) bad(); const s = await R.getReviewState(scheduleId); if (!s) throw Object.assign(new Error("nf"), { code: "P0002" }); return s; });
}
