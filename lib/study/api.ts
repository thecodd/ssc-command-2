import type { EntityType, StudySession } from "@/types/curriculum";
import type { ErrorCode } from "./errors";
// The ONLY surface the study UI uses to talk to the server. The live implementation wraps the server actions; fixtures swap in an in-memory fake
// (tests/fixtures). `mode` lets the UI label fixture data so mock output can never pass as real.
export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; error: string };
export type ProgressPatch = { status?: "not_started" | "learning" | "completed"; completion?: number; confidence?: number };
export interface StudyApi {
  mode: "live" | "fixture";
  recover(): Promise<ApiResult<StudySession | null>>;
  start(type: EntityType, id: string): Promise<ApiResult<StudySession>>;
  pause(session: string): Promise<ApiResult<StudySession>>;
  resume(session: string): Promise<ApiResult<StudySession>>;
  heartbeat(session: string): Promise<ApiResult<StudySession>>;
  finish(session: string, type: EntityType, id: string, confidence?: number): Promise<ApiResult<StudySession>>;
  setProgress(type: EntityType, id: string, patch: ProgressPatch): Promise<ApiResult<null>>;
  scheduleRevision(type: EntityType, id: string): Promise<ApiResult<{ dueDate: string }>>;
  addFocus(type: EntityType, id: string, title: string): Promise<ApiResult<{ already: boolean }>>;
}
export const API_TIMEOUT_MS = 15000;
/** Turns a hung request into code "timeout" and a thrown fetch failure into "network", so the UI always gets a typed result. */
export function guarded<T>(p: Promise<ApiResult<T>>, ms = API_TIMEOUT_MS): Promise<ApiResult<T>> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, code: "timeout", error: "That took too long. Retry." }), ms);
    p.then((r) => { clearTimeout(t); resolve(r); }, () => { clearTimeout(t); resolve({ ok: false, code: "network", error: "Can't reach the server. Check your connection and retry." }); });
  });
}
