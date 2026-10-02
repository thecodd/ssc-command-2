// PRESENTATION ONLY. Mastery, weakness, revision scheduling and daily focus are computed in the database
// (migrations 008 + 010) and read through services/learning.ts. Nothing here derives them again.
// What stays in TypeScript: labels, tones, and the copy for "what should I do next" given an already-derived mastery state.
import type { EntitySignals } from "@/types/curriculum";
import { LEARNING } from "./config";
import { diffDaysISO } from "@/lib/time";
export type Mastery = "not_started" | "in_progress" | "learning" | "needs_revision" | "weak" | "strong" | "mastered";
export type FocusKind = "picked" | "overdue_revision" | "due_revision" | "weak" | "continue" | "start_next";
export type Tone = "lime" | "violet" | "mute" | "red";

export const MASTERY_LABEL: Record<Mastery, string> = { not_started: "Not started", in_progress: "In progress", learning: "Learning", needs_revision: "Needs revision", weak: "Weak", strong: "Strong", mastered: "Mastered" };
export const MASTERY_TONE: Record<Mastery, Tone> = { not_started: "mute", in_progress: "violet", learning: "violet", needs_revision: "violet", weak: "red", strong: "lime", mastered: "lime" };
export const FOCUS_LABEL: Record<FocusKind, string> = { picked: "Picked by you", overdue_revision: "Overdue revision", due_revision: "Revision due", weak: "Weak spot", continue: "Continue", start_next: "Start next" };
export const isMastery = (v: unknown): v is Mastery => typeof v === "string" && v in MASTERY_LABEL;

export interface ActionCtx { mastery: Mastery; pyqCount: number; attempts: number; accuracy: number | null; foundationGap: number; hasPendingRevision: boolean; completion: number }
export interface NextAction { code: "fix_weak" | "revise" | "foundation" | "start" | "continue" | "practice" | "schedule_revision" | "on_track"; title: string; hint: string; tab?: "pyqs" | "ncert" | "notes" }

export function nextAction(c: ActionCtx): NextAction {
  switch (c.mastery) {
    case "weak": return { code: "fix_weak", title: "Fix your weak spots", hint: c.accuracy !== null && c.attempts >= 5 ? `Recent accuracy is ${Math.round(c.accuracy)}%. Re-read your notes, then retry the PYQs.` : "You rated this low or struggled in revision. Review it, then test yourself.", tab: c.pyqCount > 0 ? "pyqs" : "notes" };
    case "needs_revision": return { code: "revise", title: "Revise this now", hint: "A scheduled revision is due. Reviewing on time is what makes it stick." };
    case "not_started": return c.foundationGap > 0
      ? { code: "foundation", title: "Warm up with the NCERT foundation", hint: `${c.foundationGap} foundation ${c.foundationGap === 1 ? "chapter isn't" : "chapters aren't"} done yet. Start there, then come back.`, tab: "ncert" }
      : { code: "start", title: "Start your first session", hint: "Begin with the subtopics below." };
    case "in_progress": return { code: "continue", title: "Keep going", hint: `You're ${c.completion}% through. Finish what's left.` };
    default:
      if (c.pyqCount > 0 && c.attempts === 0) return { code: "practice", title: "Test yourself with PYQs", hint: `${c.pyqCount} previous-year ${c.pyqCount === 1 ? "question is" : "questions are"} linked to this topic.`, tab: "pyqs" };
      if (c.mastery === "learning" && !c.hasPendingRevision) return { code: "schedule_revision", title: "Schedule a revision", hint: "First pass done. Without review it fades." };
      return { code: "on_track", title: "You're on track", hint: "Nothing urgent here. Pick another topic from the syllabus." };
  }
}

// ---- "Why this status?" ----------------------------------------------------------------------------------------------
// The status itself is derived by the database. This only EXPLAINS it, using the signals the same RPC returned. No threshold is applied
// here to decide anything: thresholds appear only as text, and a Node test pins them to the SQL constants.
export interface MasteryWhy { headline: string; detail: string }
const dayDiff = diffDaysISO;

export function explainMastery(s: Pick<EntitySignals, "mastery" | "weak_reason" | "pyq_attempts" | "pyq_recent_accuracy" | "pyq_count" | "confidence" | "completion" | "revision_due_date" | "today" | "reviews_done" | "ladder_complete"> | null): MasteryWhy {
  if (!s || s.mastery === "not_started") return { headline: "Not started", detail: "You haven't studied this yet." };
  const acc = s.pyq_recent_accuracy !== null && s.pyq_attempts >= LEARNING.minAttemptsForAccuracy ? Math.round(s.pyq_recent_accuracy) : null;
  switch (s.mastery) {
    case "weak":
      if (s.weak_reason === "low_accuracy" && acc !== null) return { headline: "Weak", detail: `Recent PYQ accuracy is ${acc}% over ${s.pyq_attempts} attempts, below the ${LEARNING.weakAccuracy}% line.` };
      if (s.weak_reason === "hard_streak") return { headline: "Weak", detail: `Your last ${LEARNING.hardStreakForWeak} revisions were both rated Hard.` };
      return { headline: "Weak", detail: `You rated your confidence ${LEARNING.weakConfidence}/5 or lower and have no practice results that say otherwise.` };
    case "needs_revision": {
      const d = s.revision_due_date ? dayDiff(s.today, s.revision_due_date) : 0;
      return { headline: "Needs revision", detail: d > 0 ? `A revision was due ${d} ${d === 1 ? "day" : "days"} ago.` : "A scheduled revision is due today." };
    }
    case "in_progress": return { headline: "In progress", detail: `You've started and are ${s.completion}% through. Finish the first pass to move on.` };
    case "learning": return { headline: "Learning", detail: s.pyq_count > 0 && s.pyq_attempts < LEARNING.minAttemptsForAccuracy
      ? `First pass done. Attempt at least ${LEARNING.minAttemptsForAccuracy} PYQs so accuracy can be measured.` : "First pass done. Practice and on-time revision are what move this to Strong." };
    case "strong": return { headline: "Strong", detail: acc !== null ? `Recent PYQ accuracy is ${acc}% (${LEARNING.strongAccuracy}% or more) with healthy confidence.` : `Reviewed and rated ${LEARNING.strongConfidence}/5 confidence or higher.` };
    case "mastered": return { headline: "Mastered", detail: s.ladder_complete ? "The full revision ladder is complete and your performance meets the mastery threshold." : "Your performance meets the mastery threshold." };
    default: return { headline: MASTERY_LABEL[s.mastery], detail: "" };
  }
}

/** What each self-rated confidence level means (shown beside the 1-5 control). */
export const CONFIDENCE_LABEL: Record<number, string> = { 1: "I don't understand this yet", 2: "Weak", 3: "Getting there", 4: "Confident", 5: "I can solve or recall it on my own" };
