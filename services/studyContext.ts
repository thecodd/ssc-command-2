import { requireUser, type Db } from "@/lib/auth";
import { first } from "@/lib/format";
import { diffDaysISO } from "@/lib/time";
import { detailHref, studyHref } from "@/lib/study/routes";
import { getClock } from "./profile";
import { MAP_SELECT, toMapping } from "./mappings";
import { EMPTY_PROGRESS, getProgress, getProgressMany } from "./progress";
import { getDailyFocus, getEntitySignals } from "./learning";
import { getLadder, getRevisionHistory } from "./revision";
import type { EntityType, Lifecycle, Progress } from "@/types/curriculum";
import type { OpenSessionMeta, StudyContext, StudyEntity, StudyLink, StudyMaterial, StudyPyq, StudyPyqRow, StudyRevision, StudySubtopic } from "@/types/study";

// Everything Study Mode needs, assembled from REAL rows and Phase 4 RPCs. Returns null when the item doesn't exist, isn't visible
// (draft containers are hidden by RLS) or is archived: the route turns that into a 404.
// Nothing here is derived/invented: mastery, completion, accuracy, revision dates and counts all come from the database.
// ASSUMPTIONS (unverified against a live database): the embedded selects below, and the RPC row shapes in types/curriculum.ts.

// ---- Row shapes of the embedded PostgREST selects below. The generated client types these as `any`; this is the ONE place the assumption is written down.
type One<T> = T | T[] | null;
interface ExamRow { name: string; exam_version: string }
interface TierRow { name: string; ssc_exams: One<ExamRow> }
interface SscSubjectRow { id: string; name: string; ssc_tiers: One<TierRow> }
interface SubtopicRow { id: string; title: string; position: number | null; archived: boolean | null }
interface TopicRow { id: string; title: string; priority: string | null; estimated_minutes: number | null; owner_id: string | null; archived: boolean | null; ssc_subjects: One<SscSubjectRow>; ssc_subtopics: SubtopicRow[] | null }
interface SubtopicDetailRow { id: string; title: string; topic_id: string; archived: boolean | null; owner_id: string | null; ssc_topics: One<Omit<TopicRow, "ssc_subtopics" | "owner_id">> }
interface ClassRow { grade: number }
interface NcertSubjectRow { id: string; name: string; classes: One<ClassRow> }
interface BookRow { id: string; title: string; edition: string | null; academic_year: string | null; source_url: string | null; subjects: One<NcertSubjectRow> }
interface ChapterRow { id: string; number: number | null; title: string; relevance: string | null; priority: string | null; estimated_minutes: number | null; source_url: string | null; owner_id: string | null; archived: boolean | null; books: One<BookRow> }
interface ConceptRow { title: string; position: number | null; archived: boolean | null }
interface StatsRow { pyq_count?: number; attempts?: number; correct?: number }
interface OpenSessionRow { id: string; entity_type: EntityType; entity_id: string; state: "active" | "paused" }
interface ResourceRow { id: string; title: string; url: string | null; type: string | null; user_id: string | null }
interface NoteRow { id: string; title: string | null; content: string; updated_at: string }
interface SubtopicLite { id: string; title: string; position: number | null; topic_id: string; archived: boolean | null }
const life = (s?: string): Lifecycle => (s === "completed" || s === "strong" ? "completed" : s === "learning" || s === "revision" ? "learning" : "not_started");
const KIND_ORDER: Record<string, number> = { foundation: 0, direct: 1, supporting: 2, background: 3 };
const MAX_LINKS = 12;
const err = (e: unknown): never => { throw e; };

interface Base {
  entity: StudyEntity; concepts: string[]; subtopics: { id: string; title: string; position: number | null }[];
  mapBy: { col: "ncert_chapter_id" | "ssc_topic_id"; id: string }; chapterId: string | null; topicId: string | null;
}

async function loadSscTopic(sb: Db, id: string): Promise<Base | null> {
  const { data, error } = await sb.from("ssc_topics").select("id,title,priority,estimated_minutes,owner_id,archived,ssc_subjects(id,name,ssc_tiers(name,ssc_exams(name,exam_version))),ssc_subtopics(id,title,position,archived)").eq("id", id).maybeSingle();
  if (error) return err(error);
  const d = data as unknown as TopicRow | null;
  if (!d || d.archived) return null;
  const ss = first(d.ssc_subjects), tr = first(ss?.ssc_tiers), ex = first(tr?.ssc_exams);
  const exam = ex ? `${ex.name} ${ex.exam_version}` : "SSC";
  return {
    entity: { type: "ssc_topic", id, title: d.title, number: null, subject: ss?.name ?? "", context: [exam, tr?.name].filter(Boolean).join(" · "),
      breadcrumbs: [{ label: exam, href: "/ssc" }, ...(ss?.id ? [{ label: ss.name as string, href: `/ssc/subject/${ss.id}` }] : [])],
      priority: d.priority ?? null, relevance: null, estimatedMinutes: d.estimated_minutes ?? null, custom: !!d.owner_id, parentTopic: null, detailHref: detailHref("ssc_topic", id), sourceUrl: null },
    concepts: [], subtopics: (d.ssc_subtopics ?? []).filter((x) => !x.archived), mapBy: { col: "ssc_topic_id", id }, chapterId: null, topicId: id,
  };
}

async function loadSscSubtopic(sb: Db, id: string): Promise<Base | null> {
  const { data, error } = await sb.from("ssc_subtopics").select("id,title,topic_id,archived,owner_id,ssc_topics(id,title,priority,estimated_minutes,archived,ssc_subjects(id,name,ssc_tiers(name,ssc_exams(name,exam_version))))").eq("id", id).maybeSingle();
  if (error) return err(error);
  const d = data as unknown as SubtopicDetailRow | null;
  if (!d || d.archived) return null;
  const tp = first(d.ssc_topics);
  if (!tp || tp.archived) return null;
  const ss = first(tp.ssc_subjects), tr = first(ss?.ssc_tiers), ex = first(tr?.ssc_exams);
  const exam = ex ? `${ex.name} ${ex.exam_version}` : "SSC";
  const sib = await sb.from("ssc_subtopics").select("id,title,position,archived").eq("topic_id", tp.id).order("position");
  if (sib.error) return err(sib.error);
  return {
    entity: { type: "ssc_subtopic", id, title: d.title, number: null, subject: ss?.name ?? "", context: [exam, tr?.name].filter(Boolean).join(" · "),
      breadcrumbs: [{ label: exam, href: "/ssc" }, ...(ss?.id ? [{ label: ss.name as string, href: `/ssc/subject/${ss.id}` }] : []), { label: tp.title as string, href: `/ssc/topic/${tp.id}` }],
      priority: null, relevance: null, estimatedMinutes: null, custom: !!d.owner_id, parentTopic: { id: tp.id, title: tp.title }, detailHref: detailHref("ssc_subtopic", id, tp.id), sourceUrl: null },
    concepts: [], subtopics: ((sib.data ?? []) as SubtopicRow[]).filter((x) => !x.archived), mapBy: { col: "ssc_topic_id", id: tp.id }, chapterId: null, topicId: tp.id,
  };
}

async function loadChapter(sb: Db, id: string): Promise<Base | null> {
  const { data, error } = await sb.from("chapters").select("id,number,title,relevance,priority,estimated_minutes,source_url,owner_id,archived,books(id,title,edition,academic_year,source_url,subjects(id,name,classes(grade)))").eq("id", id).maybeSingle();
  if (error) return err(error);
  const d = data as unknown as ChapterRow | null;
  if (!d || d.archived) return null;
  const bk = first(d.books), sj = first(bk?.subjects), grade: number = first(sj?.classes)?.grade ?? 0;
  const con = await sb.from("concepts").select("title,position,archived").eq("chapter_id", id).order("position");
  if (con.error) return err(con.error);
  const edition = [bk?.edition, bk?.academic_year].filter(Boolean).join(", ");
  return {
    entity: { type: "ncert_chapter", id, title: d.title, number: d.number ?? null, subject: grade ? `Class ${grade} · ${sj?.name ?? ""}` : (sj?.name ?? ""),
      context: [bk?.title, edition ? `(${edition})` : null].filter(Boolean).join(" "),
      breadcrumbs: [{ label: "NCERT", href: "/ncert" }, ...(grade ? [{ label: `Class ${grade}`, href: `/ncert/${grade}` }] : []), ...(sj?.name ? [{ label: sj.name as string }] : [])],
      priority: d.priority ?? null, relevance: d.relevance ?? null, estimatedMinutes: d.estimated_minutes ?? null, custom: !!d.owner_id, parentTopic: null, detailHref: detailHref("ncert_chapter", id),
      sourceUrl: d.source_url ?? bk?.source_url ?? null },
    concepts: ((con.data ?? []) as ConceptRow[]).filter((c) => !c.archived).map((c) => c.title), subtopics: [], mapBy: { col: "ncert_chapter_id", id }, chapterId: id, topicId: null,
  };
}

async function topicStats(sb: Db, topicId: string): Promise<{ total: number; attempts: number; correct: number }> {
  const { data, error } = await sb.rpc("topic_pyq_stats", { p_topic: topicId });
  if (error) return err(error);
  const r = (((data ?? []) as StatsRow[])[0] ?? {}) as StatsRow;
  return { total: Number(r.pyq_count ?? 0), attempts: Number(r.attempts ?? 0), correct: Number(r.correct ?? 0) };
}
const pctOf = (ok: number, n: number) => (n > 0 ? Math.round((100 * ok) / n) : null);

async function loadPyq(sb: Db, uid: string, base: Base, links: StudyLink[]): Promise<StudyPyq> {
  const t = base.entity.type;
  if (t === "ssc_topic") {
    const s = await topicStats(sb, base.entity.id);
    return { scope: "topic", total: s.total, attempted: s.attempts, accuracyPct: pctOf(s.correct, s.attempts), rows: [], practiceScope: s.total > 0 ? { scope: "ssc_topic", id: base.entity.id } : null };
  }
  if (t === "ssc_subtopic") {
    const q = await sb.from("pyq_subtopics").select("pyq_id,pyqs!inner(archived,has_valid_key)").eq("ssc_subtopic_id", base.entity.id).eq("pyqs.archived", false).eq("pyqs.has_valid_key", true).limit(200);
    if (q.error) return err(q.error);
    const ids = ((q.data ?? []) as { pyq_id: string }[]).map((r) => r.pyq_id);
    let attempts = 0, correct = 0;
    if (ids.length) {
      const a = await sb.from("pyq_attempts").select("is_correct").eq("user_id", uid).in("pyq_id", ids).limit(1000);
      if (a.error) return err(a.error);
      const rows = (a.data ?? []) as { is_correct: boolean }[]; attempts = rows.length; correct = rows.filter((r) => r.is_correct).length;
    }
    return { scope: "subtopic", total: ids.length, attempted: attempts, accuracyPct: pctOf(correct, attempts), rows: [], practiceScope: ids.length ? { scope: "ssc_subtopic", id: base.entity.id } : null };
  }
  // NCERT chapter: PYQs hang off the SSC topics it supports. Per-topic rows (counts are NOT summed: one question can be tagged to several topics).
  const topics = links.slice(0, 8);
  const stats = await Promise.all(topics.map((l) => topicStats(sb, l.id)));
  const rows: StudyPyqRow[] = topics.map((l, i) => ({ topicId: l.id, title: l.title, total: stats[i].total, attempted: stats[i].attempts, correct: stats[i].correct })).filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));
  const primary = rows[0];
  return { scope: "mapped_topics", total: primary?.total ?? 0, attempted: primary?.attempted ?? 0, accuracyPct: primary ? pctOf(primary.correct, primary.attempted) : null, rows, practiceScope: primary ? { scope: "ssc_topic", id: primary.topicId } : null };
}

async function loadRevision(sb: Db, uid: string, type: EntityType, id: string, today: string): Promise<StudyRevision> {
  const { data, error } = await sb.from("revision_schedule").select("id,due_date,step,reason,done").eq("user_id", uid).eq("entity_type", type).eq("entity_id", id).order("due_date", { ascending: false }).limit(20);
  if (error) return err(error);
  const rows = (data ?? []) as { id: string; due_date: string; step: number; reason: string | null; done: boolean }[];
  const open = rows.find((r) => !r.done);
  if (!open) return { state: rows.length ? "graduated" : "none", scheduleId: null, step: null, dueDate: null, daysUntil: null, reason: null };
  const d = diffDaysISO(open.due_date, today);
  return { state: d < 0 ? "overdue" : d === 0 ? "due" : "scheduled", scheduleId: open.id, step: open.step, dueDate: open.due_date, daysUntil: d, reason: open.reason };
}

async function titleOf(sb: Db, type: EntityType, id: string): Promise<string | null> {
  const table = type === "ncert_chapter" ? "chapters" : type === "ssc_topic" ? "ssc_topics" : "ssc_subtopics";
  const { data } = await sb.from(table).select("title").eq("id", id).maybeSingle();
  return (data as { title?: string } | null)?.title ?? null;
}
async function loadOpenSession(sb: Db, uid: string, here: { type: EntityType; id: string; title: string }): Promise<OpenSessionMeta | null> {
  const { data, error } = await sb.from("study_sessions").select("id,entity_type,entity_id,state").eq("user_id", uid).in("state", ["active", "paused"]).limit(1);
  if (error) return err(error);
  const r = ((data ?? []) as OpenSessionRow[])[0];
  if (!r) return null;
  const same = r.entity_type === here.type && r.entity_id === here.id;
  return { id: r.id, type: r.entity_type, entityId: r.entity_id, state: r.state, title: same ? here.title : await titleOf(sb, r.entity_type, r.entity_id) };
}

export async function getStudyContext(type: EntityType, id: string): Promise<StudyContext | null> {
  const { sb, user } = await requireUser();
  const base = type === "ssc_topic" ? await loadSscTopic(sb, id) : type === "ssc_subtopic" ? await loadSscSubtopic(sb, id) : type === "ncert_chapter" ? await loadChapter(sb, id) : null;
  if (!base) return null;
  const { today } = await getClock();

  const [maps, progress, signals, notes, res, revision, subProg, open, focus, ladder, revisionHistory] = await Promise.all([
    sb.from("ncert_ssc_mappings").select(MAP_SELECT).eq(base.mapBy.col, base.mapBy.id),
    getProgress(sb, user.id, type, id),
    getEntitySignals(type, id),
    sb.from("notes").select("id,title,content,updated_at").eq("user_id", user.id).eq("entity_type", type).eq("entity_id", id).order("updated_at", { ascending: false }).limit(50),
    sb.from("resources").select("id,title,url,type,user_id").eq("entity_type", type).eq("entity_id", id).limit(50),
    loadRevision(sb, user.id, type, id, today),
    getProgressMany(sb, user.id, "ssc_subtopic", base.subtopics.map((s) => s.id)),
    loadOpenSession(sb, user.id, { type, id, title: base.entity.title }),
    getDailyFocus(4).catch(() => []),     // optional garnish: Study Mode must still work if the focus RPC is unavailable
    getLadder().catch(() => [] as number[]),                // display only: empty = the ladder strip is simply not shown
    getRevisionHistory(type, id).catch(() => []),
  ]);
  for (const r of [maps, notes, res]) if (r.error) return err(r.error);

  const mappings = (maps.data ?? []).map(toMapping);
  const sorted = [...mappings].sort((a, b) => Number(b.recommended) - Number(a.recommended) || (KIND_ORDER[a.type] ?? 9) - (KIND_ORDER[b.type] ?? 9) || a.chapter.title.localeCompare(b.chapter.title));
  const forLink = (m: (typeof mappings)[number]) => ({ id: m.id, kind: m.type, relevance: m.relevance, reason: m.reason, recommended: m.recommended });

  let foundation: StudyLink[] = [], sscTopics: StudyLink[] = [];
  if (type === "ncert_chapter") {
    const seen = new Set<string>();
    const rows = sorted.filter((m) => m.topic.id && !seen.has(m.topic.id) && seen.add(m.topic.id)).slice(0, MAX_LINKS);
    const pm = await getProgressMany(sb, user.id, "ssc_topic", rows.map((m) => m.topic.id));
    const subs = rows.length ? await sb.from("ssc_subtopics").select("id,title,position,topic_id,archived").in("topic_id", rows.map((m) => m.topic.id)).order("position") : { data: [], error: null };
    if (subs.error) return err(subs.error);
    const byTopic = new Map<string, { id: string; title: string }[]>();
    for (const x of (subs.data ?? []) as SubtopicLite[]) if (!x.archived) byTopic.set(x.topic_id, [...(byTopic.get(x.topic_id) ?? []), { id: x.id, title: x.title }]);
    sscTopics = rows.map((m) => ({ type: "ssc_topic", id: m.topic.id, title: m.topic.title, context: [m.topic.exam, m.topic.subject].filter(Boolean).join(" · "), lifecycle: life(pm.get(m.topic.id)?.status), mapping: forLink(m), subtopics: byTopic.get(m.topic.id) ?? [] }));
  } else {
    const seen = new Set<string>();
    const rows = sorted.filter((m) => m.chapter.id && !seen.has(m.chapter.id) && seen.add(m.chapter.id)).slice(0, MAX_LINKS);
    const pm = await getProgressMany(sb, user.id, "ncert_chapter", rows.map((m) => m.chapter.id));
    foundation = rows.map((m) => ({ type: "ncert_chapter", id: m.chapter.id, title: m.chapter.title, context: [m.chapter.grade ? `Class ${m.chapter.grade}` : null, m.chapter.subject].filter(Boolean).join(" · "), lifecycle: life(pm.get(m.chapter.id)?.status), mapping: forLink(m) }));
  }

  const pyq = await loadPyq(sb, user.id, base, sscTopics);
  const subtopics: StudySubtopic[] = [...base.subtopics].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.title.localeCompare(b.title))
    .map((s) => ({ id: s.id, title: s.title, lifecycle: life(subProg.get(s.id)?.status), current: s.id === id }));
  const materials: StudyMaterial[] = ((res.data ?? []) as ResourceRow[]).map((r) => ({ id: r.id, title: r.title, url: r.url ?? null, type: r.type ?? "other", official: r.user_id === null }));
  const upNext = (focus ?? []).find((f) => !(f.entity_type === type && f.entity_id === id)) ?? null;
  const prog: Progress = progress ?? EMPTY_PROGRESS;

  return {
    entity: base.entity, progress: prog, signals, mastery: signals?.mastery ?? "not_started", completion: signals?.completion ?? prog.completion, revision, today,
    concepts: base.concepts, subtopics, foundation, sscTopics, materials,
    notes: ((notes.data ?? []) as NoteRow[]).map((n) => ({ id: n.id, title: n.title ?? null, content: n.content, updatedAt: n.updated_at })), pyq, upNext, openSession: open, ladder, revisionHistory,
  };
}
export const studyLinkHref = (l: { type: EntityType; id: string }) => studyHref(l.type, l.id);
