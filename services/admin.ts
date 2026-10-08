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

import type { PublishStatus } from "@/lib/admin/publish";
export type { PublishStatus };
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

export interface PublishRow {
  kind: "book" | "ssc_exam"; id: string; title: string; subtitle: string | null; status: PublishStatus;
  sourceId: string | null; sourceName: string | null; sourceVerified: boolean; official: boolean; notificationUrl: string | null;
}
/** Every official container with its publishing state, for the admin screen (RLS shows drafts to admins only). */
export async function listPublishing(): Promise<PublishRow[]> {
  const { sb } = await requireAdmin();
  const [books, exams, sources] = await Promise.all([
    sb.from("books").select("id,title,edition,academic_year,status,source_id").order("title").limit(500),
    sb.from("ssc_exams").select("id,name,exam_version,status,is_official,notification_url,source_id").order("exam_version").limit(500),
    sb.from("sources").select("id,name,is_verified").limit(1000),
  ]);
  for (const r of [books, exams, sources]) ok(r.error);
  const src = new Map(((sources.data ?? []) as { id: string; name: string; is_verified: boolean }[]).map((s) => [s.id, s]));
  const of = (id: string | null) => { const s = id ? src.get(id) : undefined; return { sourceId: id, sourceName: s?.name ?? null, sourceVerified: !!s?.is_verified }; };
  const b = ((books.data ?? []) as { id: string; title: string; edition: string | null; academic_year: string | null; status: PublishStatus; source_id: string | null }[]).map((x): PublishRow => ({
    kind: "book", id: x.id, title: x.title, subtitle: [x.edition, x.academic_year].filter(Boolean).join(" · ") || null, status: x.status, ...of(x.source_id), official: false, notificationUrl: null }));
  const e = ((exams.data ?? []) as { id: string; name: string; exam_version: string; status: PublishStatus; is_official: boolean; notification_url: string | null; source_id: string | null }[]).map((x): PublishRow => ({
    kind: "ssc_exam", id: x.id, title: `${x.name} ${x.exam_version}`, subtitle: null, status: x.status, ...of(x.source_id), official: x.is_official, notificationUrl: x.notification_url }));
  return [...b, ...e];
}
