import { getUser, requireUser } from "@/lib/auth";
import { first, pct } from "@/lib/format";
import { getProgress, getProgressMap, EMPTY_PROGRESS } from "./progress";
import { getEntitySignals } from "./learning";
import { MAP_SELECT, toMapping } from "./mappings";
import { getClock } from "./profile";

const isDone = (s?: string) => s === "completed";

export async function getExams() {
  const { sb } = await getUser();
  const { data, error } = await sb.from("ssc_exams").select("id,name,exam_version,is_official,notification_url").order("exam_version", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getExamOverview(examId: string, tierId?: string) {
  const { sb, user } = await getUser();
  const { data, error } = await sb.from("ssc_tiers").select("id,name,position,ssc_subjects(id,name,position,archived,ssc_topics(id,archived))").eq("exam_id", examId).order("position");
  if (error) throw error;
  const tiers = data ?? [];
  const tier: any = tiers.find((t: any) => t.id === tierId) ?? tiers[0] ?? null;
  const pm = user ? await getProgressMap(sb, user.id, "ssc_topic") : new Map();
  const subjects = (tier?.ssc_subjects ?? []).filter((s: any) => !s.archived).sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)).map((s: any) => {
    const topics = (s.ssc_topics ?? []).filter((t: any) => !t.archived);
    return { id: s.id, name: s.name, topicCount: topics.length, percent: pct(topics.filter((t: any) => isDone(pm.get(t.id)?.status)).length, topics.length) };
  });
  return { tiers: tiers.map((t: any) => ({ id: t.id, name: t.name })), tierId: tier?.id as string | undefined, subjects };
}

export async function getSubjectDetail(id: string) {
  const { sb, user } = await getUser();
  const { data, error } = await sb.from("ssc_subjects").select("id,name,ssc_tiers(id,name,exam_id,ssc_exams(name,exam_version)),ssc_topics(id,title,priority,estimated_minutes,archived,position,ssc_subtopics(id,title,position))").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const pm = user ? await getProgressMap(sb, user.id, "ssc_topic") : new Map();
  const tr: any = first((data as any).ssc_tiers), ex: any = first(tr?.ssc_exams);
  const topics = ((data as any).ssc_topics ?? []).filter((t: any) => !t.archived).sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0) || a.title.localeCompare(b.title))
    .map((t: any) => ({ ...t, subtopics: (t.ssc_subtopics ?? []).sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)), progress: pm.get(t.id) ?? EMPTY_PROGRESS }));
  const pyqCounts = new Map<string, number>();
  const { data: pq, error: e2 } = await sb.rpc("subject_pyq_counts", { p_subject: id });
  if (e2) throw e2;
  (pq ?? []).forEach((r: any) => pyqCounts.set(r.ssc_topic_id, r.n));
  topics.forEach((t: any) => (t.pyqCount = pyqCounts.get(t.id) ?? 0));
  return { id: data.id, name: data.name, tier: tr?.name ?? "", examId: tr?.exam_id as string | undefined, tierId: tr?.id as string | undefined, exam: ex ? `${ex.name} ${ex.exam_version}` : "", topics };
}

export interface PyqPreview { id: string; exam: string | null; year: number | null; question: string; difficulty: string | null }
export async function getTopicDetail(id: string) {
  const { sb, user } = await requireUser();
  const uid = user.id, { today } = await getClock();
  const { data, error } = await sb.from("ssc_topics").select("id,title,priority,estimated_minutes,owner_id,ssc_subjects(id,name,ssc_tiers(name,ssc_exams(name,exam_version))),ssc_subtopics(id,title,position)").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const ss: any = first((data as any).ssc_subjects), tr: any = first(ss?.ssc_tiers), ex: any = first(tr?.ssc_exams);
  const [maps, progress, pyqStats, notes, res, rev, subProg, related, chProg, signals] = await Promise.all([
    sb.from("ncert_ssc_mappings").select(MAP_SELECT).eq("ssc_topic_id", id),
    getProgress(sb, uid, "ssc_topic", id),
    sb.rpc("topic_pyq_stats", { p_topic: id }),
    sb.from("notes").select("id,title,content,updated_at").eq("user_id", uid).eq("entity_type", "ssc_topic").eq("entity_id", id).order("updated_at", { ascending: false }),
    sb.from("resources").select("id,title,url,type").eq("entity_type", "ssc_topic").eq("entity_id", id),
    sb.from("revision_schedule").select("due_date,done").eq("user_id", uid).eq("entity_type", "ssc_topic").eq("entity_id", id).order("due_date"),
    getProgressMap(sb, uid, "ssc_subtopic"),
    ss?.id ? sb.from("ssc_topics").select("id,title").eq("subject_id", ss.id).neq("id", id).eq("archived", false).limit(6) : Promise.resolve({ data: [], error: null } as any),
    getProgressMap(sb, uid, "ncert_chapter"),
    getEntitySignals("ssc_topic", id),
  ]);
  for (const r of [maps, pyqStats, notes, res, rev, related]) if ((r as any).error) throw (r as any).error;
  const stats: any = (pyqStats.data ?? [])[0] ?? { pyq_count: 0, attempts: 0, correct: 0 };
  const attempts: number = stats.attempts, correct: number = stats.correct;
  let pyqs: PyqPreview[] = [];
  if (stats.pyq_count > 0) { const q = await sb.rpc("topic_pyqs", { p_topic: id, lim: 5 }); if (q.error) throw q.error; pyqs = (q.data ?? []) as PyqPreview[]; }
  const mappings = (maps.data ?? []).map(toMapping);
  const pending = (rev.data ?? []).filter((r: any) => !r.done);
  const foundationGap = mappings.filter((m) => (m.type === "foundation" || m.type === "direct") && !isDone(chProg.get(m.chapter.id)?.status)).length;
  return {
    id: data.id, title: data.title, priority: data.priority, estimated_minutes: data.estimated_minutes, custom: !!data.owner_id,
    subjectId: ss?.id as string | undefined, subject: ss?.name ?? "", tier: tr?.name ?? "", exam: ex ? `${ex.name} ${ex.exam_version}` : "",
    subtopics: ((data as any).ssc_subtopics ?? []).sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)).map((t: any) => ({ ...t, status: subProg.get(t.id)?.status ?? "not_started" })),
    mastery: (signals?.mastery ?? "not_started") as import("@/types/curriculum").Mastery, mappings, progress, notes: notes.data ?? [], resources: res.data ?? [], pyqs, pyqCount: stats.pyq_count as number, attempts,
    accuracy: attempts ? Math.round((correct / attempts) * 100) : null,
    nextRevision: (pending[0]?.due_date as string | undefined) ?? null, revisionDue: pending.some((r: any) => r.due_date <= today), hasRevision: pending.length > 0,
    foundationGap, related: (related.data ?? []) as { id: string; title: string }[],
  };
}
