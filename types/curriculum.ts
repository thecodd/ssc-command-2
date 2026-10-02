import type { Status } from "./index";
export type EntityType = "ncert_chapter" | "ssc_topic" | "ssc_subtopic";
export interface Progress { status: Status; completion: number; confidence: number | null; seconds_spent: number; sessions: number; revision_count: number; last_studied_at: string | null }
export interface SyllabusItem {
  kind: "ncert" | "ssc"; id: string; href: string; title: string; meta: string; group: string; sortKey: string;
  source: string; book?: string; relevance?: string; priority: string; estimated_minutes: number | null;
  status: Status; completion: number; connections: string[];
}
export interface SyllabusFilters { q?: string; source?: "ncert" | "ssc"; cls?: number; subject?: string; topic?: string; relevance?: string; priority?: string; status?: string }
export interface Mapping {
  id: string; type: string; relevance: string; reason: string | null; recommended: boolean;
  chapter: { id: string; title: string; grade: number; subject: string; book: string };
  topic: { id: string; title: string; subject: string; tier: string; exam: string };
}

import type { Mastery, FocusKind } from "@/lib/learning/rules";
export type { Mastery, FocusKind };
export type Lifecycle = "not_started" | "learning" | "completed";
export interface StudySession { id: string; entity_type: EntityType; entity_id: string; state: "active" | "paused" | "completed" | "abandoned"; started_at: string; ended_at: string | null; seconds: number; elapsed_seconds: number; server_now: string }
export interface EntitySignals {
  entity_type: EntityType; entity_id: string; title: string; priority: string | null; estimated_minutes: number | null; status: string; completion: number; confidence: number | null;
  sessions: number; seconds_spent: number; last_studied_at: string | null; completed_at: string | null; pyq_count: number; pyq_attempts: number; pyq_recent_accuracy: number | null;
  revision_due_date: string | null; revision_step: number | null; last_ratings: string[]; reviews_done: number; ladder_complete: boolean; today: string; mastery: Mastery; weak_reason: string | null;
}
export interface FocusItem { entity_type: EntityType; entity_id: string; title: string; kind: FocusKind; reason: string; overdue_days: number; estimated_minutes: number | null; priority: string | null; rank: number }
export interface DashboardSummary {
  ncert_total: number; ncert_done: number; ssc_total: number; ssc_done: number; ncert_percent: number; ssc_percent: number; overall_percent: number;
  pyq_attempts: number; pyq_correct: number; pyq_percent: number; revision_percent: number; revisions_due: number; tasks_open: number; today_seconds: number; streak: number; weak_count: number;
}
