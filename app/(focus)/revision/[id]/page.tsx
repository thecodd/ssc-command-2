import Link from "next/link";
import { notFound } from "next/navigation";
import { getRevisionHistory, getReviewState } from "@/services/revision";
import { getStudyContext } from "@/services/studyContext";
import { ReviewRunner } from "@/components/revision/ReviewRunner";
import { RecallMaterial } from "@/components/revision/RecallMaterial";
import { parseReviewId, revisionHref } from "@/lib/revision/routes";
import { practiceForReviewHref } from "@/lib/practice/routes";
import { dueText } from "@/lib/revision/queue";
import { explainMastery } from "@/lib/learning/rules";
import { studyHref } from "@/lib/study/routes";

export const dynamic = "force-dynamic";
// Validate BEFORE touching the database. Another user's schedule id is invisible (RLS) and so a 404, exactly like a missing one.
export default async function ReviewPage({ params }: { params: { id: string } }) {
  const id = parseReviewId(params.id);
  if (!id) notFound();
  const state = await getReviewState(id);
  if (!state) notFound();
  const ctx = await getStudyContext(state.entityType, state.entityId);
  if (!ctx) notFound();
  const e = ctx.entity, study = studyHref(e.type, e.id);
  if (state.done) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="text-xl font-semibold">This revision is already complete</h1>
        <p className="mt-2 text-sm text-sub">{e.title} has no open review right now. It comes back if practice shows a weakness.</p>
        <div className="mt-6 flex justify-center gap-2"><Link href="/revision" className="btn-primary">Back to revision queue</Link><Link href={study} className="btn-ghost">Continue studying</Link></div>
      </div>);
  }
  const history = await getRevisionHistory(e.type, e.id);
  const why = explainMastery(ctx.signals ? { ...ctx.signals, completion: ctx.completion } : null);
  const due = dueText({ bucket: state.bucket ?? "upcoming", days_overdue: Math.max(-(state.daysUntil ?? 0), 0), days_until: Math.max(state.daysUntil ?? 0, 0), due_date: state.dueDate ?? "" });
  const scope = ctx.pyq.practiceScope;
  return (
    <ReviewRunner scheduleId={state.scheduleId} type={e.type} entityId={e.id} title={e.title} subject={e.subject} kicker={e.type === "ncert_chapter" ? "NCERT" : "SSC"}
      reviewNo={(ctx.signals?.reviews_done ?? 0) + 1} dueText={due} overdue={state.bucket === "overdue"} step={state.step} ladder={state.ladder} preview={state.preview}
      mastery={ctx.mastery} masteryWhy={why.detail || why.headline} confidence={ctx.progress.confidence} history={history}
      pyq={{ total: ctx.pyq.total, attempted: ctx.pyq.attempted, accuracyPct: ctx.pyq.accuracyPct }} practiceHref={scope ? practiceForReviewHref(scope.scope, scope.id, revisionHref(state.scheduleId)) : null}
      studyHref={study} material={<RecallMaterial ctx={ctx} />} />
  );
}
