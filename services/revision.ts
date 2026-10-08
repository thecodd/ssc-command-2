import { requireUser, type Db } from "@/lib/auth";
import { first } from "@/lib/format";
import { diffDaysISO } from "@/lib/time";
import { toAppError } from "@/lib/study/errors";
import { getClock } from "./profile";
import { getAllSignals } from "./learning";
import type { EntityType } from "@/types/curriculum";
import type { Bucket, GraduatedItem, HistoryRow, IntervalPreview, QueueItem, QueueRow, Rating, ReviewResult, ReviewState } from "@/types/revision";

// Thin wrappers over the Phase 4 / 013 revision RPCs. NOTHING here schedules, orders or grades: ordering is revision_queue(), the ladder rule is
// revision_next(), the review itself is review_revision(). Errors become coded AppErrors (no raw database text reaches the UI).
export async function scheduleRevision(type: EntityType, id: string) {
  const { sb } = await requireUser();
  const { data, error } = await sb.rpc("schedule_revision", { p_type: type, p_id: id });
  if (error) throw toAppError(error);
  return data as { schedule_id: string; step: number; due_date: string; reason: string };
}
/** expectedStep = the step the learner SAW; a stale or double submit is rejected by the database (PT409 -> "conflict"). */
export async function reviewRevision(scheduleId: string, rating: Rating, expectedStep: number, confidence?: number | null) {
  const { sb } = await requireUser();
  const { data, error } = await sb.rpc("review_revision", { p_schedule: scheduleId, p_rating: rating, p_expected_step: expectedStep, p_confidence: confidence ?? null });
  if (error) throw toAppError(error);
  return data as ReviewResult;
}

// ---- queue --------------------------------------------------------------------------------------------------------------------------------
interface SubjName { name: string }
type One<T> = T | T[] | null;
const KIND: Record<EntityType, string> = { ncert_chapter: "NCERT chapter", ssc_topic: "SSC topic", ssc_subtopic: "SSC subtopic" };
async function subjectsFor(sb: Db, rows: { entity_type: EntityType; entity_id: string }[]): Promise<Map<string, string>> {
  const ids = (t: EntityType) => Array.from(new Set(rows.filter((r) => r.entity_type === t).map((r) => r.entity_id)));
  const out = new Map<string, string>();
  const [tp, st, ch] = await Promise.all([
    ids("ssc_topic").length ? sb.from("ssc_topics").select("id,ssc_subjects(name)").in("id", ids("ssc_topic")) : null,
    ids("ssc_subtopic").length ? sb.from("ssc_subtopics").select("id,ssc_topics(title,ssc_subjects(name))").in("id", ids("ssc_subtopic")) : null,
    ids("ncert_chapter").length ? sb.from("chapters").select("id,books(subjects(name,classes(grade)))").in("id", ids("ncert_chapter")) : null,
  ]);
  for (const r of [tp, st, ch]) if (r?.error) throw r.error;
  for (const x of (tp?.data ?? []) as unknown as { id: string; ssc_subjects: One<SubjName> }[]) out.set(x.id, first(x.ssc_subjects)?.name ?? "");
  for (const x of (st?.data ?? []) as unknown as { id: string; ssc_topics: One<{ title: string; ssc_subjects: One<SubjName> }> }[]) { const t = first(x.ssc_topics); out.set(x.id, [first(t?.ssc_subjects)?.name, t?.title].filter(Boolean).join(" · ")); }
  for (const x of (ch?.data ?? []) as unknown as { id: string; books: One<{ subjects: One<SubjName & { classes: One<{ grade: number }> }> }> }[]) { const s = first(first(x.books)?.subjects); const g = first(s?.classes)?.grade; out.set(x.id, [g ? `Class ${g}` : null, s?.name].filter(Boolean).join(" · ")); }
  return out;
}
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
export async function getRevisionQueue(): Promise<QueueItem[]> {
  const { sb } = await requireUser();
  const { data, error } = await sb.rpc("revision_queue");
  if (error) throw toAppError(error);
  const rows = ((data ?? []) as QueueRow[]).map((r) => ({ ...r, pyq_recent_accuracy: num(r.pyq_recent_accuracy), ladder: r.ladder ?? [] }));
  const subj = await subjectsFor(sb, rows);
  return rows.map((r) => ({ ...r, subject: subj.get(r.entity_id) ?? "", kind: KIND[r.entity_type] }));       // order = the server's rank
}
/** Items that finished the ladder and have no open revision now (a later weakness can reopen them). */
export async function getGraduated(openEntityIds: Set<string>, limit = 10): Promise<GraduatedItem[]> {
  const { sb, user } = await requireUser();
  const { data, error } = await sb.from("revision_reviews").select("entity_type,entity_id,reviewed_on").eq("user_id", user.id).eq("graduated", true).order("reviewed_at", { ascending: false }).limit(60);
  if (error) throw toAppError(error);
  const titles = new Map((await getAllSignals()).map((s) => [s.entity_id, s.title]));
  const seen = new Set<string>(), out: GraduatedItem[] = [];
  for (const r of (data ?? []) as { entity_type: EntityType; entity_id: string; reviewed_on: string }[]) {
    if (seen.has(r.entity_id) || openEntityIds.has(r.entity_id) || !titles.has(r.entity_id)) continue;
    seen.add(r.entity_id); out.push({ entity_type: r.entity_type, entity_id: r.entity_id, title: titles.get(r.entity_id)!, reviewed_on: r.reviewed_on });
    if (out.length >= limit) break;
  }
  return out;
}

// ---- ladder, history, preview ---------------------------------------------------------------------------------------------------------
/** The user's own ladder (profiles.revision_intervals); when unset the database default, via lc_default_ladder(). Never a constant in the client. */
export async function getLadder(): Promise<number[]> {
  const { sb, user } = await requireUser();
  const { data, error } = await sb.from("profiles").select("revision_intervals").eq("id", user.id).maybeSingle();
  if (error) throw toAppError(error);
  const own = (data as { revision_intervals: number[] | null } | null)?.revision_intervals;
  if (own && own.length) return own;
  const d = await sb.rpc("lc_default_ladder");
  if (d.error) throw toAppError(d.error);
  return (d.data ?? []) as number[];
}
export async function getRevisionHistory(type: EntityType, id: string, limit = 8): Promise<HistoryRow[]> {
  const { sb, user } = await requireUser();
  const { data, error } = await sb.from("revision_reviews").select("id,reviewed_on,rating,step_before,step_after,interval_days_after,graduated,confidence,source")
    .eq("user_id", user.id).eq("entity_type", type).eq("entity_id", id).order("reviewed_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (error) throw toAppError(error);
  return (data ?? []) as HistoryRow[];
}
/** What Hard / Good / Easy would do from `step`: revision_next() (the single implementation of the rule) on the user's ladder. */
export async function getIntervalPreview(step: number, ladder: number[]): Promise<IntervalPreview[]> {
  const { sb } = await requireUser();
  const { today } = await getClock();
  const ratings: Rating[] = ["hard", "good", "easy"];
  const res = await Promise.all(ratings.map((r) => sb.rpc("revision_next", { p_step: step, p_rating: r, p_ladder: ladder, p_today: today })));
  return res.map((x, i) => {
    if (x.error) throw toAppError(x.error);
    const row = ((x.data ?? []) as { step: number; graduated: boolean; interval_days: number | null; due_date: string | null }[])[0];
    return { rating: ratings[i], step: row.step, graduated: row.graduated, intervalDays: row.interval_days, dueDate: row.due_date };
  });
}
/** Current truth about one schedule row (own row via RLS; another user's id is simply "not found"). */
export async function getReviewState(scheduleId: string): Promise<ReviewState | null> {
  const { sb } = await requireUser();
  const { data, error } = await sb.from("revision_schedule").select("id,entity_type,entity_id,due_date,step,done").eq("id", scheduleId).maybeSingle();
  if (error) throw toAppError(error);
  const r = data as { id: string; entity_type: EntityType; entity_id: string; due_date: string; step: number; done: boolean } | null;
  if (!r) return null;
  const ladder = await getLadder();
  const { today } = await getClock();
  const d = diffDaysISO(r.due_date, today);
  const bucket: Bucket | null = r.done ? null : d < 0 ? "overdue" : d === 0 ? "today" : "upcoming";
  return { scheduleId: r.id, entityType: r.entity_type, entityId: r.entity_id, done: r.done, step: r.step, dueDate: r.done ? null : r.due_date, bucket, daysUntil: r.done ? null : d, ladder, preview: r.done ? [] : await getIntervalPreview(r.step, ladder) };
}

/** The learner's single OPEN revision for an item (revision_schedule_one_open guarantees at most one), or null. */
export async function getOpenRevision(type: EntityType, id: string): Promise<{ scheduleId: string; step: number; dueDate: string; daysUntil: number } | null> {
  const { sb, user } = await requireUser();
  const { data, error } = await sb.from("revision_schedule").select("id,due_date,step").eq("user_id", user.id).eq("entity_type", type).eq("entity_id", id).eq("done", false).maybeSingle();
  if (error) throw toAppError(error);
  const r = data as { id: string; due_date: string; step: number } | null;
  if (!r) return null;
  const { today } = await getClock();
  return { scheduleId: r.id, step: r.step, dueDate: r.due_date, daysUntil: diffDaysISO(r.due_date, today) };
}
