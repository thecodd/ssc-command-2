import { requireUser } from "@/lib/auth";
import { getClock } from "./profile";
import { getAllSignals } from "./learning";
import type { EntitySignals } from "@/types/curriculum";

// Analytics from the learner's REAL rows only. Every number is either counted by the database or summed from bounded row sets; nothing is estimated.
export interface Analytics {
  tz: string; days: { date: string; seconds: number }[]; totalSeconds: number; sessions14: number;
  attempts: number; correct: number; accuracy: number | null;
  mastery: Record<string, number>; weak: EntitySignals[]; topicAccuracy: { title: string; href: string; attempts: number; accuracy: number }[];
  reviews30: { easy: number; good: number; hard: number }; streak: number; goalMinutes: number; started: number; completed: number;
}
const dayIn = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
export async function getAnalytics(): Promise<Analytics> {
  const { sb, user } = await requireUser(); const { tz, today } = await getClock();
  const since = new Date(Date.now() - 14 * 86400000).toISOString(), reviewSince = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [prof, sess, all, ok, rev, signals] = await Promise.all([
    sb.from("profiles").select("streak_count,daily_goal_minutes").eq("id", user.id).maybeSingle(),
    sb.from("study_sessions").select("started_at,seconds").eq("user_id", user.id).in("state", ["completed", "abandoned"]).gte("started_at", since).limit(2000),
    sb.from("pyq_attempts").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    sb.from("pyq_attempts").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_correct", true),
    sb.from("revision_reviews").select("rating").eq("user_id", user.id).gte("reviewed_on", reviewSince).limit(5000),
    getAllSignals(),
  ]);
  for (const r of [prof, sess, all, ok, rev]) if (r.error) throw r.error;
  const days: { date: string; seconds: number }[] = []; const base = new Date(`${today}T12:00:00Z`);
  for (let i = 13; i >= 0; i--) days.push({ date: new Date(base.getTime() - i * 86400000).toISOString().slice(0, 10), seconds: 0 });
  const idx = new Map(days.map((d, i) => [d.date, i]));
  let sessions14 = 0; for (const s of (sess.data ?? []) as { started_at: string; seconds: number }[]) { const i = idx.get(dayIn(s.started_at, tz)); if (i !== undefined) { days[i].seconds += s.seconds ?? 0; if ((s.seconds ?? 0) > 0) sessions14++; } }
  const attempts = all.count ?? 0, correct = ok.count ?? 0;
  const mastery: Record<string, number> = {}; for (const s of signals) mastery[s.mastery] = (mastery[s.mastery] ?? 0) + 1;
  const reviews30 = { easy: 0, good: 0, hard: 0 }; for (const r of (rev.data ?? []) as { rating: "easy" | "good" | "hard" }[]) reviews30[r.rating]++;
  const href = (s: EntitySignals) => `/study/${s.entity_type}/${s.entity_id}`;
  const topicAccuracy = signals.filter((s) => s.pyq_attempts >= 5 && s.pyq_recent_accuracy !== null).map((s) => ({ title: s.title, href: href(s), attempts: s.pyq_attempts, accuracy: Math.round(Number(s.pyq_recent_accuracy)) })).sort((a, b) => a.accuracy - b.accuracy).slice(0, 12);
  const p = prof.data as { streak_count: number | null; daily_goal_minutes: number | null } | null;
  return { tz, days, totalSeconds: signals.reduce((a, s) => a + (s.seconds_spent ?? 0), 0), sessions14, attempts, correct, accuracy: attempts ? Math.round((100 * correct) / attempts) : null,
    mastery, weak: signals.filter((s) => s.mastery === "weak").slice(0, 8), topicAccuracy, reviews30, streak: p?.streak_count ?? 0, goalMinutes: p?.daily_goal_minutes ?? 60,
    started: signals.length, completed: signals.filter((s) => ["learning", "strong", "mastered", "needs_revision"].includes(s.mastery) || s.completion >= 100).length };
}
