import { guarded } from "@/lib/study/api";
import type { RevisionApi } from "@/lib/revision/api";
import { revisionReviewAction, revisionStateAction } from "@/app/actions/revision";
export const liveRevisionApi: RevisionApi = {
  mode: "live",
  submit: (r) => guarded(revisionReviewAction(r.scheduleId, r.rating, r.expectedStep, r.confidence, r.type, r.id)),
  state: (id) => guarded(revisionStateAction(id)),
};
