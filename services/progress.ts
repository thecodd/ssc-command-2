import type { Db } from "@/lib/auth";
import { fetchAll } from "@/lib/paging";
import type { EntityType, Progress } from "@/types/curriculum";
// READ side only. Clients have SELECT on user_progress; every write is an RPC (set_progress, study_*, review_revision, submit_pyq_answer).
const COLS = "status,completion,confidence,seconds_spent,sessions,revision_count,last_studied_at";
export const EMPTY_PROGRESS: Progress = { status: "not_started", completion: 0, confidence: null, seconds_spent: 0, sessions: 0, revision_count: 0, last_studied_at: null };

export async function getProgress(sb: Db, uid: string, type: EntityType, id: string): Promise<Progress> {
  const { data, error } = await sb.from("user_progress").select(COLS).eq("user_id", uid).eq("entity_type", type).eq("entity_id", id).maybeSingle();
  if (error) throw error;
  return (data as Progress) ?? EMPTY_PROGRESS;
}
export async function getProgressMap(sb: Db, uid: string, type: EntityType) {
  const rows = await fetchAll<{ entity_id: string } & Progress>((a, b) =>
    sb.from("user_progress").select(`entity_id,${COLS}`).eq("user_id", uid).eq("entity_type", type).order("entity_id").range(a, b));
  return new Map<string, Progress>(rows.map((r) => [r.entity_id, r]));
}
/** Learner input only: lifecycle status, completion, confidence. The database derives everything else. */
export async function setProgress(sb: Db, type: EntityType, id: string, patch: { status?: "not_started" | "learning" | "completed"; completion?: number; confidence?: number }) {
  const { error } = await sb.rpc("set_progress", { p_type: type, p_id: id, p_status: patch.status ?? null, p_completion: patch.completion ?? null, p_confidence: patch.confidence ?? null });
  if (error) throw new Error(error.message);
}

/** Progress for a small set of ids (pass <= ~50). Missing ids simply have no row. */
export async function getProgressMany(sb: Db, uid: string, type: EntityType, ids: string[]) {
  if (!ids.length) return new Map<string, Progress>();
  const { data, error } = await sb.from("user_progress").select(`entity_id,${COLS}`).eq("user_id", uid).eq("entity_type", type).in("entity_id", ids);
  if (error) throw error;
  return new Map<string, Progress>(((data ?? []) as unknown as (Progress & { entity_id: string })[]).map((r) => [r.entity_id, r as Progress]));
}
