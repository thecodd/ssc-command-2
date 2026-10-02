"use server";
import { revalidatePath } from "next/cache";
import { safe } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import * as P from "@/services/progress";
import * as S from "@/services/study";
import { scheduleRevision } from "@/services/revision";
import type { EntityType } from "@/types/curriculum";

// Thin wrappers. Business rules (status/completion coupling, revision seeding, durations, counters, streaks) live in the database.
const TYPES = ["ncert_chapter", "ssc_topic", "ssc_subtopic"];
const guard = (t: string) => { if (!TYPES.includes(t)) throw new Error("Invalid item."); };
const refresh = (path: string) => { revalidatePath(path); revalidatePath("/dashboard"); revalidatePath("/syllabus"); };

export async function setProgressAction(type: EntityType, id: string, patch: { status?: "not_started" | "learning" | "completed"; completion?: number; confidence?: number }, path: string) {
  return safe(async () => { guard(type); const { sb } = await requireUser(); await P.setProgress(sb, type, id, patch); refresh(path); });
}
export async function completeAction(type: EntityType, id: string, path: string) { return setProgressAction(type, id, { status: "completed" }, path); }
export async function scheduleRevisionAction(type: EntityType, id: string, path: string) {
  return safe(async () => { guard(type); await scheduleRevision(type, id); refresh(path); });
}
export async function studyStartAction(type: EntityType, id: string) { return safe(async () => { guard(type); return S.studyStart(type, id); }); }
export async function studyPauseAction(session: string) { return safe(() => S.studyPause(session)); }
export async function studyResumeAction(session: string) { return safe(() => S.studyResume(session)); }
export async function studyHeartbeatAction(session: string) { return safe(() => S.studyHeartbeat(session)); }
export async function studyRecoverAction() { return safe(() => S.studyRecover()); }
export async function studyFinishAction(session: string, path: string, confidence?: number) {
  return safe(async () => { const r = await S.studyFinish(session, confidence); refresh(path); return r; });
}
