// FIXTURES FOR UI DEVELOPMENT AND TESTS ONLY. Every title says "Fixture" so it can never be mistaken for syllabus data (we never invent curriculum).
// Imported only by tests/** and the dev-only preview route (404 in production). Not a stand-in for the database: nothing here proves Supabase behaviour.
import type { EntitySignals, Progress } from "@/types/curriculum";
import type { StudyContext, StudyLink } from "@/types/study";

const P = (o: Partial<Progress> = {}): Progress => ({ status: "not_started", completion: 0, confidence: null, seconds_spent: 0, sessions: 0, revision_count: 0, last_studied_at: null, ...o });
const sig = (o: Partial<EntitySignals>): EntitySignals => ({ entity_type: "ssc_topic", entity_id: "f0000000-0000-4000-8000-000000000001", title: "Fixture Topic A", priority: "high", estimated_minutes: 60, status: "learning", completion: 40, confidence: 3,
  sessions: 2, seconds_spent: 5400, last_studied_at: null, completed_at: null, pyq_count: 18, pyq_attempts: 12, pyq_recent_accuracy: 67, revision_due_date: null, revision_step: null, last_ratings: [], reviews_done: 0, ladder_complete: false, today: "2026-10-01", mastery: "in_progress", weak_reason: null, ...o });
const link = (o: Partial<StudyLink> & Pick<StudyLink, "type" | "id" | "title">): StudyLink => ({ context: "Fixture context", lifecycle: "not_started", mapping: { id: "m-" + o.id, kind: "foundation", relevance: "high", reason: "Fixture reason: this explains why the link exists.", recommended: true }, ...o });
const ID = (n: number) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const sscEntity = (title: string) => ({ type: "ssc_topic" as const, id: ID(1), title, number: null, subject: "Fixture Subject", context: "Fixture Exam 2099 · Tier I", breadcrumbs: [{ label: "Fixture Exam 2099", href: "/ssc" }, { label: "Fixture Subject", href: "/ssc" }],
  priority: "high", relevance: null, estimatedMinutes: 60, custom: false, parentTopic: null, detailHref: "/ssc", sourceUrl: null });

export const FIXTURES: Record<string, StudyContext> = {
  "ssc-topic": {
    entity: sscEntity("Fixture Topic A"), progress: P({ status: "learning", completion: 40, confidence: 3, seconds_spent: 5400, sessions: 2 }), signals: sig({}), mastery: "in_progress", completion: 40,
    revision: { state: "none", scheduleId: null, step: null, dueDate: null, daysUntil: null, reason: null }, today: "2026-10-01", concepts: [],
    subtopics: [{ id: ID(11), title: "Fixture Subtopic 1", lifecycle: "completed", current: false }, { id: ID(12), title: "Fixture Subtopic 2", lifecycle: "learning", current: false }, { id: ID(13), title: "Fixture Subtopic 3", lifecycle: "not_started", current: false }],
    foundation: [link({ type: "ncert_chapter", id: ID(21), title: "Fixture NCERT Chapter 1", context: "Class 6 · Fixture Subject", lifecycle: "completed" }), link({ type: "ncert_chapter", id: ID(22), title: "Fixture NCERT Chapter 2", context: "Class 7 · Fixture Subject", lifecycle: "not_started", mapping: { id: "m2", kind: "supporting", relevance: "medium", reason: null, recommended: false } })],
    sscTopics: [], materials: [{ id: "r1", title: "Fixture resource (official)", url: "https://example.test/official", type: "pdf", official: true }, { id: "r2", title: "Fixture resource (mine)", url: "https://example.test/mine", type: "video", official: false }],
    notes: [{ id: ID(31), title: "Fixture note", content: "Fixture note body.", updatedAt: "2026-09-30T10:00:00Z" }],
    pyq: { scope: "topic", total: 18, attempted: 12, accuracyPct: 67, rows: [], practiceScope: { scope: "ssc_topic", id: ID(1) } }, upNext: { entity_type: "ssc_topic", entity_id: ID(2), title: "Fixture Topic B", kind: "continue", reason: "Keep going", overdue_days: 0, estimated_minutes: 45, priority: "medium", rank: 2 }, openSession: null, ladder: [1, 3, 7, 15, 30], revisionHistory: [],
  },
  "ncert-chapter": {
    entity: { type: "ncert_chapter", id: ID(21), title: "Fixture NCERT Chapter 1", number: 1, subject: "Class 6 · Fixture Subject", context: "Fixture Book (2099)", breadcrumbs: [{ label: "NCERT", href: "/ncert" }, { label: "Class 6", href: "/ncert/6" }, { label: "Fixture Subject" }],
      priority: "high", relevance: "high", estimatedMinutes: 40, custom: false, parentTopic: null, detailHref: "/ncert", sourceUrl: "https://example.test/source" },
    progress: P(), signals: null, mastery: "not_started", completion: 0, revision: { state: "none", scheduleId: null, step: null, dueDate: null, daysUntil: null, reason: null }, today: "2026-10-01",
    concepts: ["Fixture concept one", "Fixture concept two", "Fixture concept three"], subtopics: [], foundation: [],
    sscTopics: [link({ type: "ssc_topic", id: ID(1), title: "Fixture Topic A", context: "Fixture Exam 2099 · Fixture Subject", subtopics: [{ id: ID(11), title: "Fixture Subtopic 1" }, { id: ID(12), title: "Fixture Subtopic 2" }] }),
      link({ type: "ssc_topic", id: ID(2), title: "Fixture Topic B", context: "Fixture Exam 2099 · Fixture Subject", subtopics: [] })],
    materials: [], notes: [], pyq: { scope: "mapped_topics", total: 18, attempted: 0, accuracyPct: null, rows: [{ topicId: ID(1), title: "Fixture Topic A", total: 18, attempted: 0, correct: 0 }, { topicId: ID(2), title: "Fixture Topic B", total: 4, attempted: 0, correct: 0 }], practiceScope: { scope: "ssc_topic", id: ID(1) } },
    upNext: null, openSession: null, ladder: [1, 3, 7, 15, 30], revisionHistory: [],
  },
  subtopic: {
    entity: { type: "ssc_subtopic", id: ID(12), title: "Fixture Subtopic 2", number: null, subject: "Fixture Subject", context: "Fixture Exam 2099 · Tier I", breadcrumbs: [{ label: "Fixture Exam 2099", href: "/ssc" }, { label: "Fixture Topic A", href: "/ssc" }],
      priority: null, relevance: null, estimatedMinutes: null, custom: false, parentTopic: { id: ID(1), title: "Fixture Topic A" }, detailHref: "/ssc", sourceUrl: null },
    progress: P({ status: "learning", completion: 20, seconds_spent: 600, sessions: 1 }), signals: sig({ entity_type: "ssc_subtopic", entity_id: ID(12), title: "Fixture Subtopic 2", pyq_count: 3, pyq_attempts: 0, pyq_recent_accuracy: null, completion: 20, seconds_spent: 600, sessions: 1, confidence: null }), mastery: "in_progress", completion: 20,
    revision: { state: "none", scheduleId: null, step: null, dueDate: null, daysUntil: null, reason: null }, today: "2026-10-01", concepts: [],
    subtopics: [{ id: ID(11), title: "Fixture Subtopic 1", lifecycle: "completed", current: false }, { id: ID(12), title: "Fixture Subtopic 2", lifecycle: "learning", current: true }, { id: ID(13), title: "Fixture Subtopic 3", lifecycle: "not_started", current: false }],
    foundation: [link({ type: "ncert_chapter", id: ID(21), title: "Fixture NCERT Chapter 1", context: "Class 6 · Fixture Subject", lifecycle: "completed" })], sscTopics: [], materials: [], notes: [],
    pyq: { scope: "subtopic", total: 3, attempted: 0, accuracyPct: null, rows: [], practiceScope: { scope: "ssc_subtopic", id: ID(12) } }, upNext: null, openSession: null, ladder: [1, 3, 7, 15, 30], revisionHistory: [],
  },
  "weak-due": {
    entity: sscEntity("Fixture Topic W"), progress: P({ status: "completed", completion: 100, confidence: 2, seconds_spent: 12000, sessions: 5, revision_count: 1 }),
    signals: sig({ title: "Fixture Topic W", status: "completed", completion: 100, confidence: 2, pyq_count: 20, pyq_attempts: 10, pyq_recent_accuracy: 30, revision_due_date: "2026-09-29", revision_step: 1, mastery: "weak", weak_reason: "low_accuracy" }), mastery: "weak", completion: 100,
    revision: { state: "overdue", scheduleId: ID(41), step: 1, dueDate: "2026-09-29", daysUntil: -2, reason: "weakness" }, today: "2026-10-01", concepts: [], subtopics: [], foundation: [], sscTopics: [], materials: [], notes: [],
    pyq: { scope: "topic", total: 20, attempted: 10, accuracyPct: 30, rows: [], practiceScope: { scope: "ssc_topic", id: ID(1) } }, upNext: null, openSession: null, ladder: [1, 3, 7, 15, 30], revisionHistory: [],
  },
  empty: {
    entity: sscEntity("Fixture Topic Empty"), progress: P(), signals: null, mastery: "not_started", completion: 0, revision: { state: "none", scheduleId: null, step: null, dueDate: null, daysUntil: null, reason: null }, today: "2026-10-01",
    concepts: [], subtopics: [], foundation: [], sscTopics: [], materials: [], notes: [], pyq: { scope: "topic", total: 0, attempted: 0, accuracyPct: null, rows: [], practiceScope: null }, upNext: null, openSession: null, ladder: [1, 3, 7, 15, 30], revisionHistory: [],
  },
};
// Variants that change only the open-session situation
FIXTURES["other-session"] = { ...FIXTURES["empty"], openSession: { id: ID(51), type: "ssc_topic", entityId: ID(2), state: "active", title: "Fixture Topic B" } };
FIXTURES["resume"] = { ...FIXTURES["ssc-topic"], openSession: { id: ID(52), type: "ssc_topic", entityId: ID(1), state: "active", title: "Fixture Topic A" } };
export const SCENARIOS = Object.keys(FIXTURES);
