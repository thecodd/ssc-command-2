export type Status = "not_started" | "learning" | "completed" | "strong" | "revision";
export type Relevance = "very_high" | "high" | "medium" | "low" | "not_mapped";
export type Priority = "very_high" | "high" | "medium" | "low";
export type MappingType = "foundation" | "direct" | "supporting" | "background";
export interface DashboardData {
  greeting: string; name: string; streak: number; todayMinutes: number; dailyGoalMinutes: number;
  progress: { overall: number; ncert: number; ssc: number; pyq: number; revision: number };
  focus: { id: string; title: string; subject: string; percent: number; href: string } | null;
  dueRevisions: number; pendingTasks: number; weakCount: number; focusKind: string | null;
  /** From revision_queue(); null when it could not be loaded (nothing is shown rather than a made-up number). */
  revision: { overdue: number; today: number; upcoming: number; startId: string | null; nextDue: string | null } | null;
}
