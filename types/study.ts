import type { HistoryRow } from "./revision";
import type { EntityType, EntitySignals, FocusItem, Lifecycle, Mastery, Progress } from "./curriculum";

export interface StudyCrumb { label: string; href?: string }
export interface StudyEntity {
  type: EntityType; id: string; title: string; number: number | null;
  /** e.g. "General Awareness" or "Class 6 · Geography" */
  subject: string;
  /** e.g. "SSC CGL 2026 · Tier I" or "NCERT Geography Class 6 (2023)" */
  context: string;
  breadcrumbs: StudyCrumb[];
  priority: string | null; relevance: string | null; estimatedMinutes: number | null; custom: boolean;
  parentTopic: { id: string; title: string } | null;     // set for subtopics
  detailHref: string; sourceUrl: string | null;
}
/** One node of the NCERT <-> SSC relationship, from either direction. */
export interface StudyLink {
  type: EntityType; id: string; title: string; context: string; lifecycle: Lifecycle;
  mapping: { id: string; kind: string; relevance: string; reason: string | null; recommended: boolean } | null;
  subtopics?: { id: string; title: string }[];   // set on the SSC topics shown from an NCERT chapter
}
export interface StudySubtopic { id: string; title: string; lifecycle: Lifecycle; current: boolean }
export interface StudyMaterial { id: string; title: string; url: string | null; type: string; official: boolean }
export interface StudyNote { id: string; title: string | null; content: string; updatedAt: string }
export interface StudyPyqRow { topicId: string; title: string; total: number; attempted: number; correct: number }
export interface StudyPyq {
  scope: "topic" | "subtopic" | "mapped_topics";
  total: number; attempted: number; accuracyPct: number | null;
  rows: StudyPyqRow[];            // per SSC topic (NCERT chapters) so counts are never double counted
  practiceScope: { scope: "ssc_topic" | "ssc_subtopic"; id: string } | null;   // what Practice opens (null = nothing to practise)
}
export type RevisionState = "none" | "scheduled" | "due" | "overdue" | "graduated";
export interface StudyRevision { state: RevisionState; scheduleId: string | null; step: number | null; dueDate: string | null; daysUntil: number | null; reason: string | null }
export interface OpenSessionMeta { id: string; type: EntityType; entityId: string; state: "active" | "paused"; title: string | null }

export interface StudyContext {
  entity: StudyEntity;
  progress: Progress;
  signals: EntitySignals | null;          // null until the user has any progress on the item
  mastery: Mastery;                        // server-derived (user_entity_signals); "not_started" only when there are no signals
  completion: number;                      // server-derived effective completion
  revision: StudyRevision;
  today: string;
  concepts: string[];
  subtopics: StudySubtopic[];
  foundation: StudyLink[];                 // for SSC items: NCERT chapters that support them
  sscTopics: StudyLink[];                  // for NCERT chapters: SSC topics they help with
  materials: StudyMaterial[];
  notes: StudyNote[];
  pyq: StudyPyq;
  upNext: FocusItem | null;                // first daily-focus item that is not this one
  openSession: OpenSessionMeta | null;
  ladder: number[];                        // the learner's own revision ladder (profiles.revision_intervals, or the database default)
  revisionHistory: HistoryRow[];           // newest first, from revision_reviews (append-only)     // the user's open session, if any (may be on a different item)
}
