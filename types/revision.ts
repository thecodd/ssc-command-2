import type { EntityType, Mastery } from "./curriculum";
// Revision contracts (migrations 008 + 013). Dates are YYYY-MM-DD in the learner's own time zone. Every number below is computed by the database.
export type Rating = "easy" | "good" | "hard";
export type Bucket = "overdue" | "today" | "upcoming";
export type RevisionReason = "completion" | "manual" | "weakness";
/** One row of revision_queue(). Order = the server's `rank`. */
export interface QueueRow {
  schedule_id: string; entity_type: EntityType; entity_id: string; title: string; due_date: string; step: number; reason: RevisionReason | null;
  bucket: Bucket; days_overdue: number; days_until: number; mastery: Mastery; weak_reason: string | null; confidence: number | null; completion: number;
  last_studied_at: string | null; pyq_count: number; pyq_attempts: number; pyq_recent_accuracy: number | null; reviews_done: number; last_ratings: string[];
  ladder: number[]; today: string; rank: number;
}
export interface QueueItem extends QueueRow { subject: string; kind: string }
export interface GraduatedItem { entity_type: EntityType; entity_id: string; title: string; reviewed_on: string }
export interface HistoryRow { id: string; reviewed_on: string; rating: Rating; step_before: number | null; step_after: number | null; interval_days_after: number | null; graduated: boolean; confidence: number | null; source: "app" | "legacy" }
/** What each rating WOULD do, straight from revision_next() on the user's own ladder (never computed in the client). */
export interface IntervalPreview { rating: Rating; step: number; graduated: boolean; intervalDays: number | null; dueDate: string | null }
export interface ReviewResult { review_id: string; schedule_id: string; rating: Rating; step: number; graduated: boolean; due_date: string | null; interval_days: number | null }
/** Result of a submitted review plus the server-derived state AFTER it. */
export interface ReviewOutcome {
  rating: Rating; graduated: boolean; dueDate: string | null; intervalDays: number | null; step: number;
  mastery: Mastery; whyHeadline: string; whyDetail: string;
  nextScheduleId: string | null; dueRemaining: number;
}
/** Current truth about one schedule row (used after a stale/duplicate submit and for the page itself). */
export interface ReviewState { scheduleId: string; entityType: EntityType; entityId: string; done: boolean; step: number; dueDate: string | null; bucket: Bucket | null; daysUntil: number | null; ladder: number[]; preview: IntervalPreview[] }
