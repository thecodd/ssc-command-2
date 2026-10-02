import { formatDate } from "@/lib/time";
import { LEARNING } from "@/lib/learning/config";
import type { Bucket, HistoryRow, IntervalPreview, QueueRow, Rating } from "@/types/revision";

// PRESENTATION helpers for the revision queue. Nothing here orders, schedules or computes an interval: the order is the server's `rank`
// (revision_queue()), the intervals come from revision_next() on the user's own ladder.
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
export const isDue = (b: Bucket) => b === "overdue" || b === "today";

/** Splits into buckets WITHOUT re-sorting (the server's order is kept inside each bucket). */
export function groupQueue<T extends { bucket: Bucket }>(rows: T[]) {
  return { overdue: rows.filter((r) => r.bucket === "overdue"), today: rows.filter((r) => r.bucket === "today"), upcoming: rows.filter((r) => r.bucket === "upcoming") };
}
export const queueCounts = (rows: { bucket: Bucket }[]) => { const g = groupQueue(rows); return { overdue: g.overdue.length, today: g.today.length, upcoming: g.upcoming.length, due: g.overdue.length + g.today.length }; };
/** "What should I revise right now?" = the first due row in the server's order. */
export const startHere = <T extends { bucket: Bucket }>(rows: T[]): T | null => rows.find((r) => isDue(r.bucket)) ?? null;
export const nextDueAfter = <T extends { bucket: Bucket; schedule_id: string }>(rows: T[], currentId: string): T | null => rows.find((r) => isDue(r.bucket) && r.schedule_id !== currentId) ?? null;

export function dueText(r: Pick<QueueRow, "bucket" | "days_overdue" | "days_until" | "due_date">): string {
  if (r.bucket === "overdue") return `Overdue by ${plural(r.days_overdue, "day")}`;
  if (r.bucket === "today") return "Due today";
  return r.days_until === 1 ? "Due tomorrow" : `Due ${formatDate(r.due_date)}`;
}
/** "Why it is here", from the server's reason / mastery / weak_reason. */
export function whyText(r: Pick<QueueRow, "reason" | "mastery" | "weak_reason" | "pyq_attempts" | "pyq_recent_accuracy" | "reviews_done">): string {
  if (r.mastery === "weak") {
    if (r.weak_reason === "hard_streak") return `Hard review ${LEARNING.hardStreakForWeak === 2 ? "twice" : `${LEARNING.hardStreakForWeak} times`} in a row`;
    if (r.weak_reason === "low_accuracy") return r.pyq_recent_accuracy !== null && r.pyq_attempts >= LEARNING.minAttemptsForAccuracy ? `Weak PYQ performance (${Math.round(r.pyq_recent_accuracy)}% recent accuracy)` : "Weak PYQ performance";
    return "You rated your confidence low";
  }
  if (r.reason === "weakness") return "Weak PYQ performance";
  if (r.reason === "manual") return "You asked to revise this";
  return r.reviews_done === 0 ? "First review after completing it" : "Scheduled review";
}
export const intervalText = (days: number) => (days === 1 ? "tomorrow" : `in ${plural(days, "day")}`);
export function nextReviewText(p: { graduated: boolean; intervalDays: number | null; dueDate: string | null }): string {
  if (p.graduated || p.dueDate === null) return "ladder complete";
  return p.intervalDays !== null ? `${intervalText(p.intervalDays)} (${formatDate(p.dueDate)})` : formatDate(p.dueDate);
}

export const RATING_COPY: Record<Rating, { label: string; meaning: string; consequence: string }> = {
  hard: { label: "Hard", meaning: "I struggled or couldn't recall", consequence: "Let's bring this back sooner." },
  good: { label: "Good", meaning: "I remembered with some effort", consequence: "On track. The next review is further out." },
  easy: { label: "Easy", meaning: "I recalled this confidently", consequence: "Strong recall. The next review is further out, or the ladder is complete." },
};
export const RATING_ORDER: readonly Rating[] = ["hard", "good", "easy"];
export const previewFor = (previews: IntervalPreview[], r: Rating) => previews.find((p) => p.rating === r) ?? null;
export function previewLine(p: IntervalPreview | null): string { return p ? `Next review: ${nextReviewText(p)}` : "Next review: unavailable"; }

export interface LadderStep { days: number; state: "done" | "current" | "todo" }
/** The user's OWN ladder with the current step marked. `step` is the open schedule's step (>= ladder length is shown as fully done). */
export function ladderView(ladder: number[], step: number | null): LadderStep[] {
  return ladder.map((days, i) => ({ days, state: step === null ? "todo" : i < step ? "done" : i === step ? "current" : "todo" }));
}
export const ladderLabel = (steps: LadderStep[]) => steps.map((s) => `${s.days} ${s.days === 1 ? "day" : "days"}${s.state === "done" ? " done" : s.state === "current" ? " current" : ""}`).join(", ");
export function historyLine(h: Pick<HistoryRow, "reviewed_on" | "rating" | "interval_days_after" | "graduated">): string {
  return `${formatDate(h.reviewed_on)}: ${RATING_COPY[h.rating].label}${h.graduated ? " (ladder complete)" : h.interval_days_after ? `, next in ${h.interval_days_after}d` : ""}`;
}
