"use server";
import { revalidatePath } from "next/cache";
import { classifyError, userMessage, type ErrorCode } from "@/lib/study/errors";
import type { ApiResult } from "@/lib/study/api";
import { isUuid } from "@/lib/filters";
import { parseStudyType } from "@/lib/study/routes";
import * as S from "@/services/study";
import * as R from "@/services/revision";
import * as P from "@/services/progress";
import { requireUser } from "@/lib/auth";
import { addFocusTask } from "@/services/content";
import type { EntityType } from "@/types/curriculum";

// Study Mode server actions. Every result is typed {ok, code, error}; the `error` text is OUR copy, never a raw database message.
type Overrides = Partial<Record<ErrorCode, string>>;
async function run<T>(fn: () => Promise<T>, revalidate: string[] = [], over: Overrides = {}): Promise<ApiResult<T>> {
  try { const data = await fn(); revalidate.forEach((p) => revalidatePath(p)); return { ok: true, data }; }
  catch (e) { const code = classifyError(e); return { ok: false, code, error: over[code] ?? userMessage(code) }; }
}
const bad = (): never => { throw Object.assign(new Error("invalid"), { code: "22023" }); };
const entity = (type: string, id: string): EntityType => { const t = parseStudyType(type); if (!t || !isUuid(id)) bad(); return t as EntityType; };
const sess = (id: string) => { if (!isUuid(id)) bad(); return id; };
const after = (type: string, id: string) => (parseStudyType(type) && isUuid(id) ? ["/dashboard", `/study/${type}/${id}`] : ["/dashboard"]);   // never revalidate a caller-supplied path

export async function studyRecoverAction() { return run(() => S.studyRecover()); }
export async function studyStartAction(type: string, id: string) { return run(() => S.studyStart(entity(type, id), id), ["/study"]); }
export async function studyPauseAction(session: string) { return run(() => S.studyPause(sess(session))); }
export async function studyResumeAction(session: string) { return run(() => S.studyResume(sess(session))); }
export async function studyHeartbeatAction(session: string) { return run(() => S.studyHeartbeat(sess(session))); }
export async function studyFinishAction(session: string, type: string, id: string, confidence?: number) {
  return run(() => S.studyFinish(sess(session), confidence), [...after(type, id), "/study", "/syllabus"]);
}
export async function studySetProgressAction(type: string, id: string, patch: { status?: string; completion?: number; confidence?: number }) {
  return run(async () => {
    const t = entity(type, id);
    const ok = (v: unknown, lo: number, hi: number) => v === undefined || (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi);
    if (!ok(patch.completion, 0, 100) || !ok(patch.confidence, 1, 5) || (patch.status !== undefined && !["not_started", "learning", "completed"].includes(patch.status))) bad();
    const { sb } = await requireUser();
    await P.setProgress(sb, t, id, patch as { status?: "not_started" | "learning" | "completed"; completion?: number; confidence?: number });
    return null;
  }, [...after(type, id), "/syllabus", "/ncert", "/ssc"]);
}
export async function studyScheduleRevisionAction(type: string, id: string) {
  return run(async () => { const r = await R.scheduleRevision(entity(type, id), id); return { dueDate: r.due_date }; }, [...after(type, id), "/revision"],
    { ended: "Start studying this first, then schedule a revision." });
}
export async function studyAddFocusAction(type: string, id: string, title: string) {
  return run(() => addFocusTask(entity(type, id), id, String(title).slice(0, 160)), ["/dashboard", "/study"]);
}
