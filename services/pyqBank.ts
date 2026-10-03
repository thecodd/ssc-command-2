import { requireUser } from "@/lib/auth";
import { first } from "@/lib/format";
import { getAllSignals } from "./learning";
// The question bank as the learner sees it: SSC topics that have PRACTISABLE questions (counts from subject_pyq_counts(), which excludes archived and keyless questions),
// with the learner's own attempts and recent accuracy from the learning engine.
export interface BankTopic { id: string; title: string; subject: string; count: number; attempts: number; accuracy: number | null; mastery: string | null }
export async function getPyqBank(): Promise<{ topics: BankTopic[]; total: number }> {
  const { sb } = await requireUser();
  const { data: subjects, error } = await sb.from("ssc_subjects").select("id,name").limit(40); if (error) throw error;
  const counts = await Promise.all(((subjects ?? []) as { id: string; name: string }[]).map(async (s) => { const r = await sb.rpc("subject_pyq_counts", { p_subject: s.id }); if (r.error) throw r.error; return ((r.data ?? []) as { ssc_topic_id: string; n: number }[]).map((x) => ({ ...x, subject: s.name })); }));
  const flat = counts.flat().filter((x) => x.n > 0);
  if (!flat.length) return { topics: [], total: 0 };
  const [tp, signals] = await Promise.all([sb.from("ssc_topics").select("id,title,archived").in("id", flat.map((x) => x.ssc_topic_id).slice(0, 500)), getAllSignals("ssc_topic")]);
  if (tp.error) throw tp.error;
  const titles = new Map(((tp.data ?? []) as { id: string; title: string; archived: boolean | null }[]).filter((t) => !t.archived).map((t) => [t.id, t.title]));
  const sig = new Map(signals.map((s) => [s.entity_id, s]));
  const topics = flat.filter((x) => titles.has(x.ssc_topic_id)).map((x) => { const s = sig.get(x.ssc_topic_id); return { id: x.ssc_topic_id, title: titles.get(x.ssc_topic_id)!, subject: x.subject, count: Number(x.n), attempts: s?.pyq_attempts ?? 0, accuracy: s && s.pyq_attempts >= 5 && s.pyq_recent_accuracy !== null ? Math.round(Number(s.pyq_recent_accuracy)) : null, mastery: s?.mastery ?? null }; })
    .sort((a, b) => a.subject.localeCompare(b.subject) || b.count - a.count || a.title.localeCompare(b.title));
  return { topics, total: topics.reduce((a, t) => a + t.count, 0) };
}
export { first };
