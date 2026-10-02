import { requireUser } from "@/lib/auth";
import { toAppError } from "@/lib/study/errors";
import { studyHref } from "@/lib/study/routes";
import type { PracticeOptions, PracticeQuestion, PracticeScope, PracticeSession, PracticeSummary, StartRequest, SubmitResult } from "@/types/practice";

// Thin wrappers over the Phase 4 / 012 practice RPCs. Correctness, the answer key, ordering and accuracy are ALL decided in SQL; nothing here grades.
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let ctx;
  try { ctx = await requireUser(); } catch (e) { throw toAppError(e); }
  const { data, error } = await ctx.sb.rpc(fn, args);
  if (error) throw toAppError(error);
  return data as T;
}
export const startPractice = (r: StartRequest) =>
  rpc<PracticeSession>("start_practice", { p_scope: r.scope, p_scope_id: r.scopeId, p_count: r.count, p_difficulty: r.difficulty, p_paper: r.paper });
export const getPracticeState = (session: string) => rpc<PracticeSession>("practice_state", { p_session: session });
export const getPracticeQuestion = (session: string, pyq: string) => rpc<PracticeQuestion>("practice_question", { p_session: session, p_pyq: pyq });
export const getPracticeOptions = (scope: PracticeScope, scopeId: string | null) => rpc<PracticeOptions>("practice_options", { p_scope: scope, p_scope_id: scopeId });
/** The client sends the learner's choice and an informational time. There is no correctness parameter anywhere. */
export const submitAnswer = (session: string, pyq: string, selected: string, seconds: number | null) =>
  rpc<SubmitResult>("submit_pyq_answer", { p_session: session, p_pyq: pyq, p_selected: selected, p_time_seconds: seconds });
export const finishPractice = (session: string, abandon = false) => rpc<PracticeSummary>("finish_practice", { p_session: session, p_abandon: abandon });

export interface ScopeInfo { title: string; kicker: string; backHref: string; backLabel: string }
/** Display names for a scope (RLS applies: a hidden/archived item yields null -> 404). */
export async function getScopeInfo(scope: PracticeScope, id: string | null): Promise<ScopeInfo | null> {
  if (scope === "weak") return { title: "Weak spots", kicker: "Practice", backHref: "/study", backLabel: "Back to Study" };
  if (scope === "mixed") return { title: "Mixed practice", kicker: "Practice", backHref: "/study", backLabel: "Back to Study" };
  const { sb } = await requireUser();
  if (!id) return null;
  if (scope === "ssc_topic") {
    const { data, error } = await sb.from("ssc_topics").select("title,archived").eq("id", id).maybeSingle();
    if (error) throw toAppError(error);
    return data && !data.archived ? { title: data.title, kicker: "Practice · topic", backHref: studyHref("ssc_topic", id), backLabel: "Back to Study" } : null;
  }
  if (scope === "ssc_subtopic") {
    const { data, error } = await sb.from("ssc_subtopics").select("title,archived").eq("id", id).maybeSingle();
    if (error) throw toAppError(error);
    return data && !data.archived ? { title: data.title, kicker: "Practice · subtopic", backHref: studyHref("ssc_subtopic", id), backLabel: "Back to Study" } : null;
  }
  const { data, error } = await sb.from("ssc_subjects").select("name,archived").eq("id", id).maybeSingle();
  if (error) throw toAppError(error);
  return data && !data.archived ? { title: data.name, kicker: "Practice · subject", backHref: `/ssc/subject/${id}`, backLabel: "Back to subject" } : null;
}
