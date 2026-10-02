"use server";
import { revalidatePath } from "next/cache";
import { classifyError, userMessage, type ErrorCode } from "@/lib/study/errors";
import type { ApiResult } from "@/lib/study/api";
import { isUuid } from "@/lib/filters";
import { parseScope, NEEDS_ID } from "@/lib/practice/routes";
import { DIFFICULTIES } from "@/lib/practice/config";
import * as P from "@/services/practice";
import type { Difficulty, PracticeScope, StartRequest } from "@/types/practice";

// Typed {ok, code, error} results; `error` is OUR copy, never a database message. Every input is validated here before it reaches an RPC.
type Overrides = Partial<Record<ErrorCode, string>>;
async function run<T>(fn: () => Promise<T>, revalidate: string[] = [], over: Overrides = {}): Promise<ApiResult<T>> {
  try { const data = await fn(); revalidate.forEach((p) => revalidatePath(p)); return { ok: true, data }; }
  catch (e) { const code = classifyError(e); return { ok: false, code, error: over[code] ?? userMessage(code) }; }
}
const bad = (): never => { throw Object.assign(new Error("invalid"), { code: "22023" }); };
const sess = (v: string) => (isUuid(v) ? v : bad());
function scopeArgs(scope: string, id: string | null): { scope: PracticeScope; id: string | null } {
  const s = parseScope(scope); if (!s) return bad();
  const needs = (NEEDS_ID as readonly string[]).includes(s);
  if (needs !== (id !== null) || (id !== null && !isUuid(id))) return bad();
  return { scope: s, id };
}

export async function practiceStartAction(req: { scope: string; scopeId: string | null; count: number; difficulty: string | null; paper: string | null }) {
  return run(async () => {
    const { scope, id } = scopeArgs(req.scope, req.scopeId ?? null);
    if (!Number.isInteger(req.count) || req.count < 1 || req.count > 50) bad();
    const difficulty = req.difficulty === null ? null : (DIFFICULTIES as readonly string[]).includes(req.difficulty) ? (req.difficulty as Difficulty) : bad();
    const paper = req.paper === null ? null : isUuid(req.paper) ? req.paper : bad();
    const r: StartRequest = { scope, scopeId: id, count: req.count, difficulty, paper };
    return P.startPractice(r);
  }, ["/study"], { not_found: "There are no practice questions for this selection yet." });
}
export async function practiceStateAction(session: string) { return run(() => P.getPracticeState(sess(session)), [], { not_found: "That practice session doesn't exist." }); }
export async function practiceQuestionAction(session: string, pyq: string) { return run(() => P.getPracticeQuestion(sess(session), sess(pyq)), [], { not_found: "That question isn't available.", invalid: "That question isn't part of this session." }); }
export async function practiceOptionsAction(scope: string, scopeId: string | null) {
  return run(() => { const a = scopeArgs(scope, scopeId ?? null); return P.getPracticeOptions(a.scope, a.id); }, [], { not_found: "There are no practice questions for this selection yet." });
}
export async function practiceSubmitAction(session: string, pyq: string, selected: string, seconds: number | null) {
  return run(async () => {
    if (typeof selected !== "string" || selected.length < 1 || selected.length > 20) bad();
    if (seconds !== null && (!Number.isInteger(seconds) || seconds < 0 || seconds > 7200)) bad();
    return P.submitAnswer(sess(session), sess(pyq), selected, seconds);
  }, [], { ended: "This practice session has already finished.", invalid: "That answer isn't valid for this question.", not_found: "That practice session doesn't exist." });
}
export async function practiceFinishAction(session: string, abandon: boolean) {
  return run(() => P.finishPractice(sess(session), abandon === true), ["/study", "/dashboard", "/revision"], { not_found: "That practice session doesn't exist." });
}
