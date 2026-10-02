import Link from "next/link";
import { MASTERY_LABEL } from "@/lib/learning/rules";
import { RATING_COPY, nextReviewText } from "@/lib/revision/queue";
import { revisionHref } from "@/lib/revision/routes";
import type { ReviewOutcome } from "@/types/revision";
/** Compact result. Every value is the server's (review_revision + user_entity_signals); the one primary action is the next due revision, or the queue. */
export function ResultView({ o, studyHref, queueHref = "/revision" }: { o: ReviewOutcome; studyHref: string; queueHref?: string }) {
  const c = RATING_COPY[o.rating];
  return (
    <section aria-labelledby="done-h" className="space-y-5">
      <div><p className="text-xs font-medium uppercase tracking-widest text-sub">Review complete</p><h1 id="done-h" className="mt-1 text-2xl font-bold tracking-tight">{c.label}</h1><p className="mt-1 text-sm text-sub">{c.consequence}</p></div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="card p-4"><dt className="text-xs text-mute">Next review</dt><dd className="mt-1 text-lg font-semibold">{nextReviewText({ graduated: o.graduated, intervalDays: o.intervalDays, dueDate: o.dueDate })}</dd></div>
        <div className="card p-4"><dt className="text-xs text-mute">Current status</dt><dd className="mt-1 text-lg font-semibold">{MASTERY_LABEL[o.mastery]}</dd>{o.whyDetail && <dd className="mt-1 text-xs text-sub">{o.whyDetail}</dd>}</div>
      </dl>
      {o.graduated && <p className="text-sm text-sub">You&apos;ve completed this revision ladder. It stays in your study list and comes back if practice shows a weakness.</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        {o.nextScheduleId
          ? <Link href={revisionHref(o.nextScheduleId)} className="btn-primary">Next revision{o.dueRemaining > 0 ? ` (${o.dueRemaining} due)` : ""}</Link>
          : <Link href={queueHref} className="btn-primary">You&apos;re caught up. Back to queue</Link>}
        <Link href={studyHref} className="btn-ghost">Continue studying</Link>
        {o.nextScheduleId && <Link href={queueHref} className="btn-ghost">Back to revision queue</Link>}
      </div>
    </section>
  );
}
