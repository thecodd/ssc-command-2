import { requireUser } from "@/lib/auth";
import { toAppError } from "@/lib/study/errors";
import type { EntityType, StudySession } from "@/types/curriculum";
// Thin wrappers over the Phase 4 study_* RPCs. No duration is ever sent: the server owns the clock. Errors become coded AppErrors (no raw DB text).
async function call(fn: string, args: Record<string, unknown> = {}): Promise<StudySession | null> {
  let ctx;
  try { ctx = await requireUser(); } catch (e) { throw toAppError(e); }
  const { data, error } = await ctx.sb.rpc(fn, args);
  if (error) throw toAppError(error);
  return (data as StudySession | null) ?? null;
}
export const studyStart = (type: EntityType, id: string) => call("study_start", { p_type: type, p_id: id }) as Promise<StudySession>;
export const studyPause = (session: string) => call("study_pause", { p_session: session }) as Promise<StudySession>;
export const studyResume = (session: string) => call("study_resume", { p_session: session }) as Promise<StudySession>;
export const studyHeartbeat = (session: string) => call("study_heartbeat", { p_session: session }) as Promise<StudySession>;
export const studyFinish = (session: string, confidence?: number) => call("study_finish", { p_session: session, p_confidence: confidence ?? null }) as Promise<StudySession>;
export const studyRecover = () => call("study_recover");
