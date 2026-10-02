import type { ApiResult } from "@/lib/study/api";
import type { PracticeOptions, PracticeQuestion, PracticeSession, PracticeSummary, StartRequest, SubmitResult } from "@/types/practice";
export interface PracticeApi {
  mode: "live" | "fixture";
  start(req: StartRequest): Promise<ApiResult<PracticeSession>>;
  state(session: string): Promise<ApiResult<PracticeSession>>;
  question(session: string, pyq: string): Promise<ApiResult<PracticeQuestion>>;
  submit(session: string, pyq: string, selected: string, seconds: number | null): Promise<ApiResult<SubmitResult>>;
  finish(session: string, abandon?: boolean): Promise<ApiResult<PracticeSummary>>;
  options(scope: string, scopeId: string | null): Promise<ApiResult<PracticeOptions>>;
}
