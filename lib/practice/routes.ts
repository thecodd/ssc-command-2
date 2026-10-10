import { isUuid } from "@/lib/filters";
import type { PracticeScope } from "@/types/practice";
// /practice/new?scope=ssc_topic&id=<uuid>      configure + start (default action: "Practice this topic")
// /practice/<sessionId>                        the focused question flow and summary
export const PRACTICE_SCOPES: readonly PracticeScope[] = ["ssc_topic", "ssc_subtopic", "ssc_subject", "weak", "mixed"];
export const NEEDS_ID: readonly PracticeScope[] = ["ssc_topic", "ssc_subtopic", "ssc_subject"];
export const parseScope = (v: string | undefined | null): PracticeScope | null => ((PRACTICE_SCOPES as readonly string[]).includes(v ?? "") ? (v as PracticeScope) : null);
/** Whitelists URL input: unknown scope, missing/odd id, or an id on weak/mixed all fail (a 404, never a query). */
export function parseNewParams(sp: { scope?: string; id?: string }): { scope: PracticeScope; id: string | null } | null {
  const scope = parseScope(sp.scope);
  if (!scope) return null;
  if ((NEEDS_ID as readonly string[]).includes(scope)) return isUuid(sp.id) ? { scope, id: sp.id } : null;
  return sp.id ? null : { scope, id: null };
}
export const practiceNewHref = (scope: PracticeScope, id?: string | null) => `/practice/new?scope=${scope}${id ? `&id=${id}` : ""}`;
import { parseBackToReview } from "@/lib/revision/routes";
export const practiceSessionHref = (sessionId: string, back?: string | null, timed = false) => {
  const q = [parseBackToReview(back) ? `back=${parseBackToReview(back)}` : "", timed ? "timed=1" : ""].filter(Boolean).join("&");
  return `/practice/${sessionId}${q ? `?${q}` : ""}`;
};
/** A short revision self-test: `count` questions, and the way back to the review page afterwards (whitelisted by parseBackToReview). */
export const practiceForReviewHref = (scope: PracticeScope, id: string, reviewHref: string, count = 5) => `${practiceNewHref(scope, id)}&count=${count}&back=${reviewHref}`;
export const parseCount = (v: string | undefined): number | null => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 50 ? n : null; };
export const parseSessionId = (v: string | undefined) => (isUuid(v) ? v : null);
