import { requireAdmin } from "@/lib/auth";
// Official curriculum is ARCHIVED, never hard-deleted (database guard in 005). Status changes go through set_publish_status().
type Row = Record<string, unknown>;
const ok = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

export async function createChapter(v: { book_id: string; title: string; number?: number | null; relevance?: string; priority?: string; estimated_minutes?: number | null; source_url?: string | null }) {
  const { sb } = await requireAdmin(); const { data, error } = await sb.from("chapters").insert(v).select("id").single(); ok(error); return data!.id as string;
}
export async function updateChapter(id: string, v: Row) { const { sb } = await requireAdmin(); ok((await sb.from("chapters").update(v).eq("id", id)).error); }
export async function archiveChapter(id: string) { const { sb } = await requireAdmin(); ok((await sb.from("chapters").update({ archived: true }).eq("id", id)).error); }
export async function createSscTopic(v: { subject_id: string; title: string; priority?: string; estimated_minutes?: number | null }) {
  const { sb } = await requireAdmin(); const { data, error } = await sb.from("ssc_topics").insert(v).select("id").single(); ok(error); return data!.id as string;
}
export async function updateSscTopic(id: string, v: Row) { const { sb } = await requireAdmin(); ok((await sb.from("ssc_topics").update(v).eq("id", id)).error); }
export async function archiveSscTopic(id: string) { const { sb } = await requireAdmin(); ok((await sb.from("ssc_topics").update({ archived: true }).eq("id", id)).error); }

export type PublishStatus = "draft" | "in_review" | "published" | "archived";
export async function setPublishStatus(kind: "book" | "ssc_exam", id: string, to: PublishStatus) {
  const { sb } = await requireAdmin(); const { error } = await sb.rpc("set_publish_status", { p_kind: kind, p_id: id, p_to: to }); ok(error);
}
export async function verifySource(sourceId: string, verified = true) { const { sb } = await requireAdmin(); const { error } = await sb.rpc("verify_source", { p_source: sourceId, p_verified: verified }); ok(error); }
export async function setExamOfficial(examId: string, official = true) { const { sb } = await requireAdmin(); const { error } = await sb.rpc("set_exam_official", { p_exam: examId, p_official: official }); ok(error); }

export interface MappingInput { ncert_chapter_id: string; ssc_topic_id: string; mapping_type: string; relevance: string; reason: string | null; recommended: boolean }
export async function createMapping(v: MappingInput) { const { sb } = await requireAdmin(); ok((await sb.from("ncert_ssc_mappings").insert(v)).error); }
export async function updateMapping(id: string, v: Partial<MappingInput>) { const { sb } = await requireAdmin(); ok((await sb.from("ncert_ssc_mappings").update(v).eq("id", id)).error); }
export async function deleteMapping(id: string) { const { sb } = await requireAdmin(); ok((await sb.from("ncert_ssc_mappings").delete().eq("id", id)).error); }
export async function createOfficialResource(v: { entity_type: string; entity_id: string; title: string; url: string | null; type: string; description: string | null }) {
  if (v.url && !/^https?:\/\//i.test(v.url)) throw new Error("Links must start with http:// or https://");
  const { sb } = await requireAdmin(); ok((await sb.from("resources").insert({ ...v, user_id: null })).error);
}
export async function deleteOfficialResource(id: string) { const { sb } = await requireAdmin(); ok((await sb.from("resources").delete().eq("id", id).is("user_id", null)).error); }
