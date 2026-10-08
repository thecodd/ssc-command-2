"use server";
import { revalidatePath } from "next/cache";
import { safe, str, type ActionState } from "@/lib/actions";
import * as A from "@/services/admin";

const fields = (fd: FormData) => ({ mapping_type: str(fd, "mapping_type") ?? "foundation", relevance: str(fd, "relevance") ?? "medium", reason: str(fd, "reason"), recommended: fd.get("recommended") === "on" });
const done = (r: { ok: true } | { ok: false; error: string }, message: string): ActionState => { revalidatePath("/mapping"); return r.ok ? { ok: true, message } : { error: r.error }; };

export async function createMappingAction(_: ActionState, fd: FormData) {
  return done(await safe(async () => {
    const c = str(fd, "ncert_chapter_id"), t = str(fd, "ssc_topic_id"); if (!c || !t) throw new Error("Choose both a chapter and an SSC topic.");
    await A.createMapping({ ncert_chapter_id: c, ssc_topic_id: t, ...fields(fd) });
  }), "Mapping created");
}
export async function updateMappingAction(_: ActionState, fd: FormData) {
  return done(await safe(async () => { await A.updateMapping(str(fd, "id")!, fields(fd)); }), "Mapping updated");
}
export async function deleteMappingAction(_: ActionState, fd: FormData) {
  return done(await safe(async () => { await A.deleteMapping(str(fd, "id")!); }), "Mapping deleted");
}

// ---- Publishing workflow (admin only; the database re-checks every rule: admin, transition order, source/content gates).
import { isUuid } from "@/lib/filters";
import { canMove, isPublishKind, isPublishStatus } from "@/lib/admin/publish";
type R = { ok: true } | { ok: false; error: string };
const after = (r: R): R => { if (r.ok) revalidatePath("/", "layout"); return r; };
export async function setPublishStatusAction(kind: string, id: string, from: string, to: string): Promise<R> {
  return after(await safe(async () => {
    if (!isPublishKind(kind) || !isUuid(id) || !isPublishStatus(from) || !isPublishStatus(to) || !canMove(from, to)) throw new Error("That status change is not allowed.");
    await A.setPublishStatus(kind, id, to);
  }));
}
export async function verifySourceAction(sourceId: string, verified: boolean): Promise<R> {
  return after(await safe(async () => { if (!isUuid(sourceId)) throw new Error("Unknown source."); await A.verifySource(sourceId, !!verified); }));
}
export async function setExamOfficialAction(examId: string, official: boolean): Promise<R> {
  return after(await safe(async () => { if (!isUuid(examId)) throw new Error("Unknown exam version."); await A.setExamOfficial(examId, !!official); }));
}
