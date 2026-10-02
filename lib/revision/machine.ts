import type { ErrorCode } from "@/lib/study/errors";
import type { Rating, ReviewOutcome, ReviewState } from "@/types/revision";

// Pure state machine of ONE review: recall -> material -> (pick) -> submitting -> done. The server owns the interval, next due date, history and mastery;
// the client only remembers what the learner picked and the step it SAW (sent back as expected_step so a stale page is rejected by the database).
export type RPhase = "recall" | "material" | "submitting" | "done" | "stale" | "error";
export interface RState { phase: RPhase; step: number; confidence: number | null; picked: Rating | null; outcome: ReviewOutcome | null; fresh: ReviewState | null; notice: string | null; error: { code: ErrorCode; message: string } | null }
export type RAction =
  | { t: "reveal" } | { t: "confidence"; n: number | null } | { t: "pick"; r: Rating } | { t: "submitting" }
  | { t: "done"; o: ReviewOutcome } | { t: "stale"; fresh: ReviewState | null; message: string } | { t: "fail"; code: ErrorCode; message: string } | { t: "dismiss" };
export const initialRState = (step: number): RState => ({ phase: "recall", step, confidence: null, picked: null, outcome: null, fresh: null, notice: null, error: null });
export function reduce(s: RState, a: RAction): RState {
  switch (a.t) {
    case "reveal": return s.phase === "recall" ? { ...s, phase: "material" } : s;                  // recall FIRST: no rating before the material is shown
    case "confidence": return s.phase === "material" ? { ...s, confidence: a.n } : s;
    case "pick": return s.phase === "material" ? { ...s, picked: a.r } : s;
    case "submitting": return s.phase === "material" && s.picked ? { ...s, phase: "submitting", error: null } : s;
    case "done": return { ...s, phase: "done", outcome: a.o, error: null, notice: null };
    case "stale": return { ...s, phase: "stale", fresh: a.fresh, notice: a.message, error: null, picked: null };
    case "fail": return { ...s, phase: "error", error: { code: a.code, message: a.message } };
    case "dismiss": return s.phase === "error" ? { ...s, phase: "material", error: null } : s;
  }
}
