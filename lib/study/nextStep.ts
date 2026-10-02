import type { Mastery } from "@/lib/learning/rules";
import type { StudyRevision } from "@/types/study";
import { practiceVerb } from "./routes";
import { revisionHref } from "@/lib/revision/routes";

// ONE recommendation per screen. This maps ALREADY-DERIVED server state (mastery, revision state, PYQ counts, daily-focus "up next") to copy
// and a call to action. It derives nothing about mastery/weakness itself. Precedence mirrors daily_focus(): revision due > weak > unfinished > practice > schedule > move on.
export type StepCta =
  | { kind: "start"; label: string } | { kind: "resume"; label: string } | { kind: "finish"; label: string }
  | { kind: "schedule"; label: string }
  | { kind: "link"; label: string; href: string };
export type StepCode = "in_session" | "paused" | "revise" | "rate" | "fix_weak" | "restudy" | "foundation" | "start" | "continue" | "practice" | "schedule" | "move_on" | "all_clear";
export interface NextStep { code: StepCode; title: string; hint: string; cta: StepCta; tone: "lime" | "violet" | "red" }
export interface StepInput {
  phase: "recovering" | "idle" | "running" | "paused" | "ended";
  mastery: Mastery; completion: number; revision: StudyRevision;
  pyq: { total: number; attempted: number; accuracyPct: number | null };
  practiceHref: string | null;
  foundation: { unfinished: number; href: string | null };
  upNext: { title: string; href: string } | null;
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function nextStep(i: StepInput): NextStep {
  if (i.phase === "running") return { code: "in_session", title: "Stay with it", hint: "Finish when you're done. Your time is counted by the server.", cta: { kind: "finish", label: "Finish session" }, tone: "lime" };
  if (i.phase === "paused") return { code: "paused", title: "Resume when you're ready", hint: "Paused time isn't counted.", cta: { kind: "resume", label: "Resume" }, tone: "violet" };
  const ended = i.phase === "ended";
  const rev = i.revision;

  if ((rev.state === "due" || rev.state === "overdue") && rev.scheduleId) {
    // Revision is its own mode (recall first, then rate). Study Mode only points at it.
    return { code: ended ? "rate" : "revise", title: ended ? "Now review it" : rev.state === "overdue" ? "Revision overdue" : "Revision due today", hint: "Recall it first, check yourself, then rate how it went.",
      cta: { kind: "link", label: "Review", href: revisionHref(rev.scheduleId) }, tone: "violet" };
  }
  if (i.mastery === "weak") {
    return i.pyq.total > 0 && i.practiceHref
      ? { code: "fix_weak", title: "Fix this weak spot", hint: i.pyq.accuracyPct !== null ? `Overall PYQ accuracy is ${i.pyq.accuracyPct}%. Review the notes, then go back to the questions.` : "Review it, then test yourself with the linked PYQs.", cta: { kind: "link", label: `${practiceVerb} ${plural(i.pyq.total, "PYQ")}`, href: i.practiceHref }, tone: "red" }
      : { code: "restudy", title: "Re-study this", hint: "You rated it low. A focused second pass will help.", cta: { kind: "start", label: "Start studying" }, tone: "red" };
  }
  if (i.mastery === "not_started") {
    return i.foundation.unfinished > 0 && i.foundation.href
      ? { code: "foundation", title: "Warm up with the NCERT foundation", hint: `${plural(i.foundation.unfinished, "foundation chapter")} ${i.foundation.unfinished === 1 ? "isn't" : "aren't"} done yet.`, cta: { kind: "link", label: "Open the NCERT chapter", href: i.foundation.href }, tone: "lime" }
      : { code: "start", title: "Start your first session", hint: "The timer is server-side, so a refresh won't lose it.", cta: { kind: "start", label: "Start studying" }, tone: "lime" };
  }
  if (i.mastery === "in_progress" || i.completion < 100) {
    const left = Math.max(0, 100 - i.completion);
    return { code: "continue", title: ended ? `Complete the remaining ${left}%` : "Keep going", hint: left > 0 ? `You're ${i.completion}% through.` : "Mark it complete when you're done.", cta: { kind: "start", label: ended ? "Continue studying" : "Continue" }, tone: "lime" };
  }
  if (i.pyq.total > 0 && i.pyq.attempted === 0 && i.practiceHref) {
    return { code: "practice", title: `${practiceVerb} ${plural(i.pyq.total, "PYQ")}`, hint: "Testing yourself is what proves you've got it.", cta: { kind: "link", label: `${practiceVerb} PYQs`, href: i.practiceHref }, tone: "lime" };
  }
  if (rev.state === "none") return { code: "schedule", title: "Review this tomorrow", hint: "First pass done. Without a review it fades.", cta: { kind: "schedule", label: "Schedule revision" }, tone: "violet" };
  if (i.upNext) return { code: "move_on", title: `Continue with ${i.upNext.title}`, hint: rev.daysUntil !== null && rev.state === "scheduled" ? `Next revision of this: in ${plural(rev.daysUntil, "day")}.` : "You're on track here.", cta: { kind: "link", label: "Study next", href: i.upNext.href }, tone: "lime" };
  return { code: "all_clear", title: "You're on track", hint: "Nothing urgent here. Pick your next topic from the dashboard.", cta: { kind: "link", label: "Back to dashboard", href: "/dashboard" }, tone: "lime" };
}
