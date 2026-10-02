import type { EntityType } from "@/types/curriculum";
import type { ApiResult } from "@/lib/study/api";
import type { Rating, ReviewOutcome, ReviewState } from "@/types/revision";
export interface SubmitReq { scheduleId: string; rating: Rating; expectedStep: number; confidence: number | null; type: EntityType; id: string }
/** The ONLY surface the review UI uses to talk to the server (live = server actions; tests use an in-memory fake). */
export interface RevisionApi {
  mode: "live" | "fixture";
  submit(req: SubmitReq): Promise<ApiResult<ReviewOutcome>>;
  state(scheduleId: string): Promise<ApiResult<ReviewState>>;
}
