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
