import { getUser, requireUser } from "@/lib/auth";
import { first } from "@/lib/format";
import { getProgress, getProgressMap, EMPTY_PROGRESS } from "./progress";
import { getEntitySignals } from "./learning";
import { MAP_SELECT, toMapping } from "./mappings";
import { getClock } from "./profile";

export async function getClasses() {
  const { sb } = await getUser();
  const { data, error } = await sb.from("classes").select("id,grade").order("grade");
  if (error) throw error;
  return (data ?? []) as { id: string; grade: number }[];
}

export async function getClassTree(grade: number) {
  const { sb, user } = await getUser();
  const { data, error } = await sb.from("classes")
    .select("id,grade,subjects(id,name,archived,books(id,title,edition,academic_year,archived,chapters(id,number,title,relevance,priority,archived)))")
    .eq("grade", grade).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const pm = user ? await getProgressMap(sb, user.id, "ncert_chapter") : new Map();
  const subjects = ((data as any).subjects ?? []).filter((s: any) => !s.archived).sort((a: any, b: any) => a.name.localeCompare(b.name)).map((s: any) => ({
    id: s.id, name: s.name,
    books: (s.books ?? []).filter((b: any) => !b.archived).map((b: any) => ({
      id: b.id, title: b.title, edition: b.edition, academic_year: b.academic_year,
      chapters: (b.chapters ?? []).filter((c: any) => !c.archived).sort((x: any, y: any) => (x.number ?? 999) - (y.number ?? 999))
        .map((c: any) => ({ ...c, progress: pm.get(c.id) ?? EMPTY_PROGRESS })),
    })),
  }));
  return { grade, subjects };
}

export async function getChapterDetail(id: string) {
  const { sb, user } = await requireUser();
  const { data: ch, error } = await sb.from("chapters")
    .select("id,number,title,relevance,priority,estimated_minutes,source_url,owner_id,books(id,title,edition,academic_year,source_url,subjects(id,name,classes(grade)))")
    .eq("id", id).maybeSingle();
  if (error) throw error;
  if (!ch) return null;
  const [maps, concepts, notes, resources, revisions, progress, signals] = await Promise.all([
    sb.from("ncert_ssc_mappings").select(MAP_SELECT).eq("ncert_chapter_id", id),
    sb.from("concepts").select("id,title,position").eq("chapter_id", id).order("position"),
    sb.from("notes").select("id,title,content,updated_at").eq("user_id", user.id).eq("entity_type", "ncert_chapter").eq("entity_id", id).order("updated_at", { ascending: false }),
    sb.from("resources").select("id,title,url,type,description").eq("entity_type", "ncert_chapter").eq("entity_id", id),
    sb.from("revision_schedule").select("id,due_date,interval_days,done,rating").eq("user_id", user.id).eq("entity_type", "ncert_chapter").eq("entity_id", id).order("due_date"),
    getProgress(sb, user.id, "ncert_chapter", id),
    getEntitySignals("ncert_chapter", id),
  ]);
  for (const r of [maps, concepts, notes, resources, revisions]) if (r.error) throw r.error;
  const mappings = (maps.data ?? []).map(toMapping);
  const topicIds = mappings.map((m) => m.topic.id).filter(Boolean);
  let pyqs: { id: string; exam: string | null; year: number | null; question: string; difficulty: string | null }[] = [];
  if (topicIds.length) {
    const { data, error: e } = await sb.from("pyq_topics").select("pyqs!inner(id,exam,year,question,difficulty,archived)").eq("pyqs.archived", false).in("ssc_topic_id", topicIds).limit(20);
    if (e) throw e;
    const seen = new Set<string>();
    pyqs = (data ?? []).map((r: any) => first<any>(r.pyqs)).filter((y: any) => y && !seen.has(y.id) && seen.add(y.id));
  }
  const bk: any = first((ch as any).books), sj: any = first(bk?.subjects);
  const { today } = await getClock();
  return {
    today,
    id: ch.id, number: ch.number, title: ch.title, relevance: ch.relevance, priority: ch.priority, estimated_minutes: ch.estimated_minutes,
    source_url: ch.source_url ?? bk?.source_url ?? null,
    book: { title: bk?.title ?? "", edition: bk?.edition ?? null, academic_year: bk?.academic_year ?? null },
    subject: sj?.name ?? "", grade: first<any>(sj?.classes)?.grade ?? 0,
    mastery: (signals?.mastery ?? "not_started") as import("@/types/curriculum").Mastery,
    mappings, concepts: concepts.data ?? [], notes: notes.data ?? [], resources: resources.data ?? [], revisions: revisions.data ?? [], pyqs, progress,
  };
}
