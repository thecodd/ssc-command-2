import { dbConfigured, getUser } from "@/lib/auth";
import { DEFAULT_TZ, greetingFor } from "@/lib/time";
import { getClock } from "./profile";
import { getRevisionQueue } from "./revision";
import { queueCounts, startHere } from "@/lib/revision/queue";
import { getDailyFocus, getDashboardSummary, getEntitySignals } from "./learning";
import { studyHref } from "@/lib/study/routes";
import type { EntityType } from "@/types/curriculum";
import type { DashboardData } from "@/types";

const empty: DashboardData = { greeting: greetingFor(DEFAULT_TZ), name: "there", streak: 0, todayMinutes: 0, dailyGoalMinutes: 45,
  progress: { overall: 0, ncert: 0, ssc: 0, pyq: 0, revision: 0 }, focus: null, dueRevisions: 0, pendingTasks: 0, weakCount: 0, focusKind: null, revision: null };
const hrefFor = (t: string, id: string) => studyHref(t as EntityType, id);   // Study Mode is the destination for "continue"

/** No arithmetic here: the numbers come from dashboard_summary() / daily_focus() so every screen agrees. */
export async function getDashboard(): Promise<DashboardData> {
  if (!dbConfigured()) return empty;
  const { sb, user } = await getUser();
  if (!user) return empty;
  const [{ tz }, profile, sum, focus, queue] = await Promise.all([
    getClock(), sb.from("profiles").select("display_name,daily_goal_minutes").eq("id", user.id).maybeSingle(), getDashboardSummary(), getDailyFocus(1),
    getRevisionQueue().catch(() => null),
  ]);
  if (profile.error) throw profile.error;
  const top = focus[0];
  const sig = top ? await getEntitySignals(top.entity_type, top.entity_id) : null;
  return {
    greeting: greetingFor(tz), name: profile.data?.display_name ?? "there", streak: sum?.streak ?? 0, todayMinutes: Math.round((sum?.today_seconds ?? 0) / 60),
    dailyGoalMinutes: profile.data?.daily_goal_minutes ?? 45,
    progress: { overall: sum?.overall_percent ?? 0, ncert: sum?.ncert_percent ?? 0, ssc: sum?.ssc_percent ?? 0, pyq: sum?.pyq_percent ?? 0, revision: sum?.revision_percent ?? 0 },
    focus: top ? { id: top.entity_id, title: top.title, subject: top.reason, percent: sig?.completion ?? 0, href: hrefFor(top.entity_type, top.entity_id) } : null,
    dueRevisions: sum?.revisions_due ?? 0, pendingTasks: sum?.tasks_open ?? 0, weakCount: sum?.weak_count ?? 0, focusKind: top?.kind ?? null,
    revision: queue ? { ...(({ overdue, today, upcoming }) => ({ overdue, today, upcoming }))(queueCounts(queue)), startId: startHere(queue)?.schedule_id ?? null, nextDue: queue.find((r) => r.bucket === "upcoming")?.due_date ?? null } : null,
  };
}
