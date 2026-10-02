import { guarded } from "@/lib/study/api";
import type { PracticeApi } from "@/lib/practice/api";
import * as A from "@/app/actions/practice";
// LIVE api: server actions -> services -> Phase 4 / 012 RPCs. Unverified against a real database.
export const livePracticeApi: PracticeApi = {
  mode: "live",
  start: (r) => guarded(A.practiceStartAction(r)) as ReturnType<PracticeApi["start"]>,
  state: (s) => guarded(A.practiceStateAction(s)) as ReturnType<PracticeApi["state"]>,
  question: (s, p) => guarded(A.practiceQuestionAction(s, p)) as ReturnType<PracticeApi["question"]>,
  submit: (s, p, sel, sec) => guarded(A.practiceSubmitAction(s, p, sel, sec)) as ReturnType<PracticeApi["submit"]>,
  finish: (s, a) => guarded(A.practiceFinishAction(s, a ?? false)) as ReturnType<PracticeApi["finish"]>,
  options: (sc, id) => guarded(A.practiceOptionsAction(sc, id)) as ReturnType<PracticeApi["options"]>,
};
