import { fmtDuration } from "@/lib/format";
import { studyHref } from "@/lib/study/routes";
import { practiceNewHref } from "./routes";
import type { PracticeSummary } from "@/types/practice";

// Presentation of the SERVER's summary. Nothing is computed here: accuracy, correct/incorrect, time and weak topics all arrive from finish_practice().
export interface SummaryView {
  stats: { label: string; value: string }[];
  weak: { topicId: string; title: string; note: string; href: string }[];
  revisionNote: string | null;
  primary: { label: string; href: string };
  secondary: { label: string; href: string }[];
  incomplete: string | null;
}
export function summaryView(s: PracticeSummary, back: { href: string; label: string }, returnToReview = false): SummaryView {
  const weak = s.weak_topics.map((w) => ({ topicId: w.topic_id, title: w.title, href: studyHref("ssc_topic", w.topic_id),
    note: w.recent_accuracy !== null ? `${Math.round(w.recent_accuracy)}% recent accuracy` : w.weak_reason === "hard_streak" ? "Revisions rated Hard" : "Low confidence" }));
  const again = { label: "Practice again", href: practiceNewHref(s.scope_type, s.scope_id) };
  return {
    stats: [
      { label: "Questions", value: String(s.planned) }, { label: "Correct", value: String(s.correct) }, { label: "Incorrect", value: String(s.incorrect) },
      { label: "Accuracy", value: s.accuracy === null ? "—" : `${s.accuracy}%` }, { label: "Time", value: s.total_seconds > 0 ? fmtDuration(s.total_seconds) : "—" },
    ],
    weak,
    revisionNote: weak.length ? `A revision is queued for ${weak.length === 1 ? "this topic" : `these ${weak.length} topics`}.` : null,
    // coming from a revision self-test the one primary action is to go back and rate the revision
    primary: returnToReview ? { label: back.label, href: back.href } : weak.length ? { label: "Review weak areas", href: weak[0].href } : { label: back.label, href: back.href },
    secondary: returnToReview ? (weak.length ? [{ label: "Review weak areas", href: weak[0].href }] : []) : weak.length ? [again, { label: back.label, href: back.href }] : [again],
    incomplete: s.skipped > 0 ? `${s.skipped} ${s.skipped === 1 ? "question" : "questions"} not answered${s.state === "abandoned" ? " (session ended early)" : ""}.` : null,
  };
}
