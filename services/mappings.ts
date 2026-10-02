import { getDb } from "@/lib/auth";
import { first } from "@/lib/format";
import { fetchAll, rangeOf, type Page } from "@/lib/paging";
import type { Mapping } from "@/types/curriculum";
export const MAP_SELECT = "id,mapping_type,relevance,reason,recommended,chapters(id,title,number,books(title,subjects(name,classes(grade)))),ssc_topics(id,title,ssc_subjects(name,ssc_tiers(name,ssc_exams(name,exam_version))))";
export const MAP_SELECT_LIST = MAP_SELECT.replace("chapters(id,title,number,", "chapters(id,title,number,concepts(title,position),");
export function toMapping(r: any): Mapping & { concepts: string[] } {
  const ch = first<any>(r.chapters), bk = first<any>(ch?.books), sj = first<any>(bk?.subjects), cl = first<any>(sj?.classes);
  const tp = first<any>(r.ssc_topics), ss = first<any>(tp?.ssc_subjects), tr = first<any>(ss?.ssc_tiers), ex = first<any>(tr?.ssc_exams);
  return {
    concepts: ((ch?.concepts ?? []) as { title: string; position: number | null }[]).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((c) => c.title),
    id: r.id, type: r.mapping_type, relevance: r.relevance, reason: r.reason, recommended: r.recommended,
    chapter: { id: ch?.id, title: ch?.title ?? "", grade: cl?.grade ?? 0, subject: sj?.name ?? "", book: bk?.title ?? "" },
    topic: { id: tp?.id, title: tp?.title ?? "", subject: ss?.name ?? "", tier: tr?.name ?? "", exam: ex ? `${ex.name} ${ex.exam_version}` : "" },
  };
}
export async function getMappings(f: { chapterId?: string; topicId?: string; type?: string } = {}, page: Page = { limit: 200, offset: 0 }) {
  const sb = getDb();
  let q = sb.from("ncert_ssc_mappings").select(MAP_SELECT_LIST, { count: "exact" }).order("created_at", { ascending: false }).order("id").range(...rangeOf(page));
  if (f.chapterId) q = q.eq("ncert_chapter_id", f.chapterId);
  if (f.topicId) q = q.eq("ssc_topic_id", f.topicId);
  if (f.type) q = q.eq("mapping_type", f.type);
  const { data, error, count } = await q;
  if (error) throw error;
  const mappings = (data ?? []).map(toMapping);
  return { mappings, total: count ?? mappings.length, truncated: mappings.length < (count ?? 0) };
}
export async function getMappingOptions() {
  const sb = getDb();
  const [c, t] = await Promise.all([
    fetchAll<any>((a, b) => sb.from("chapters").select("id,title,books(subjects(name,classes(grade)))").eq("archived", false).order("id").range(a, b)),
    fetchAll<any>((a, b) => sb.from("ssc_topics").select("id,title,ssc_subjects(name,ssc_tiers(name,ssc_exams(exam_version)))").eq("archived", false).order("id").range(a, b)),
  ]);
  const chapters = c.map((r: any) => { const sj = first<any>(first<any>(r.books)?.subjects); return { id: r.id as string, label: `Class ${first<any>(sj?.classes)?.grade ?? "?"} · ${sj?.name ?? ""} · ${r.title}` }; }).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const topics = t.map((r: any) => { const ss = first<any>(r.ssc_subjects), tr = first<any>(ss?.ssc_tiers); return { id: r.id as string, label: `${first<any>(tr?.ssc_exams)?.exam_version ?? ""} ${tr?.name ?? ""} · ${ss?.name ?? ""} → ${r.title}`.trim() }; }).sort((a, b) => a.label.localeCompare(b.label));
  return { chapters, topics };
}
/** Both directions for one mapping: NCERT → SSC (all topics this chapter feeds) and SSC → NCERT (all chapters feeding this topic). */
export async function getMappingDetail(id: string) {
  const sb = getDb();
  const { data, error } = await sb.from("ncert_ssc_mappings").select(MAP_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const m = toMapping(data);
  const [fwd, back, concepts, subs, pyqLinks] = await Promise.all([
    sb.from("ncert_ssc_mappings").select(MAP_SELECT).eq("ncert_chapter_id", m.chapter.id),
    sb.from("ncert_ssc_mappings").select(MAP_SELECT).eq("ssc_topic_id", m.topic.id),
    sb.from("concepts").select("id,title,position").eq("chapter_id", m.chapter.id).order("position"),
    sb.from("ssc_subtopics").select("id,title,position").eq("topic_id", m.topic.id).order("position"),
    sb.rpc("topic_pyq_stats", { p_topic: m.topic.id }),
  ]);
  for (const r of [fwd, back, concepts, subs, pyqLinks]) if (r.error) throw r.error;
  return { mapping: m, ncertToSsc: (fwd.data ?? []).map(toMapping), sscToNcert: (back.data ?? []).map(toMapping), concepts: (concepts.data ?? []).map((c: any) => c.title as string), subtopics: (subs.data ?? []).map((c: any) => c.title as string), pyqCount: ((pyqLinks.data ?? [])[0] as { pyq_count: number } | undefined)?.pyq_count ?? 0 };
}
