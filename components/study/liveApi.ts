import { guarded, type StudyApi } from "@/lib/study/api";
import * as A from "@/app/actions/study";
// LIVE api: server actions -> services -> Phase 4 RPCs. (Unverified against a real database: see docs/PHASE5_NOTES.md.)
export const liveApi: StudyApi = {
  mode: "live",
  recover: () => guarded(A.studyRecoverAction()),
  start: (t, id) => guarded(A.studyStartAction(t, id)) as ReturnType<StudyApi["start"]>,
  pause: (s) => guarded(A.studyPauseAction(s)) as ReturnType<StudyApi["pause"]>,
  resume: (s) => guarded(A.studyResumeAction(s)) as ReturnType<StudyApi["resume"]>,
  heartbeat: (s) => guarded(A.studyHeartbeatAction(s)) as ReturnType<StudyApi["heartbeat"]>,
  finish: (s, t, id, c) => guarded(A.studyFinishAction(s, t, id, c)) as ReturnType<StudyApi["finish"]>,
  setProgress: (t, id, p) => guarded(A.studySetProgressAction(t, id, p)),
  scheduleRevision: (t, id) => guarded(A.studyScheduleRevisionAction(t, id)),
  addFocus: (t, id, title) => guarded(A.studyAddFocusAction(t, id, title)),
};
