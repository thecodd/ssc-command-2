import Link from "next/link";
import { Clock, RefreshCw } from "lucide-react";
import { getGraduated, getRevisionQueue } from "@/services/revision";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { MASTERY_LABEL } from "@/lib/learning/rules";
import { dueText, groupQueue, isDue, queueCounts, startHere, whyText } from "@/lib/revision/queue";
import { revisionHref } from "@/lib/revision/routes";
import { studyHref } from "@/lib/study/routes";
import { formatDate } from "@/lib/time";
import type { QueueItem } from "@/types/revision";

export const dynamic = "force-dynamic";
// "What should I revise right now?" Order inside every group is the SERVER's (revision_queue(): bucket, oldest due, weak, lower mastery). Nothing is re-sorted here.
function Card({ r }: { r: QueueItem }) {
  const due = isDue(r.bucket);
  const meta = [MASTERY_LABEL[r.mastery], r.last_studied_at ? `studied ${formatDate(r.last_studied_at.slice(0, 10))}` : null, r.confidence ? `confidence ${r.confidence}/5` : null,
    r.pyq_attempts > 0 && r.pyq_recent_accuracy !== null ? `${Math.round(r.pyq_recent_accuracy)}% on PYQs` : null].filter(Boolean).join(" · ");
  return (
    <li><article className={`card p-4 ${r.bucket === "overdue" ? "border-l-2 border-l-violet" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="break-words font-medium leading-snug">{r.title}</h3><p className="mt-0.5 truncate text-xs text-mute">{[r.subject, r.kind].filter(Boolean).join(" · ")}</p></div>
        <Badge tone={r.bucket === "overdue" ? "violet" : due ? "lime" : "mute"}>{r.bucket === "overdue" ? <Clock className="mr-1 h-3 w-3" aria-hidden /> : null}{dueText(r)}</Badge>
      </div>
      <p className="mt-2 text-sm text-sub">{whyText(r)}</p>
      <p className="mt-1 text-xs text-mute">{meta}</p>
      <Link href={revisionHref(r.schedule_id)} className={`${due ? "btn-primary" : "btn-ghost"} mt-3 w-full sm:w-auto`}>{due ? "Review" : "Review early"}</Link>
    </article></li>);
}
function Group({ title, rows }: { title: string; rows: QueueItem[] }) {
  if (!rows.length) return null;
  return <section aria-label={title}><h2 className="mb-3 font-semibold">{title} <span className="text-sm font-normal text-mute">({rows.length})</span></h2><ul className="space-y-3">{rows.map((r) => <Card key={r.schedule_id} r={r} />)}</ul></section>;
}
export default async function RevisionQueue() {
  const rows = await getRevisionQueue();
  const g = groupQueue(rows), c = queueCounts(rows), top = startHere(rows);
  const done = await getGraduated(new Set(rows.map((r) => r.entity_id)));
  const nextUp = g.upcoming[0];
  return (
    <div className="space-y-8">
      <header><h1 className="text-3xl font-bold tracking-tight">Revision</h1>
        <p className="mt-1 text-sm text-sub">{c.due > 0 ? `${c.due} ${c.due === 1 ? "item" : "items"} to revise now${c.overdue ? `, ${c.overdue} overdue` : ""}.` : "Nothing is due right now."}</p></header>
      {top && <Link href={revisionHref(top.schedule_id)} className="btn-primary w-full sm:w-auto">Start with {top.title.length > 36 ? top.title.slice(0, 34) + "…" : top.title}</Link>}
      {c.due === 0 && (
        <div className="card p-6"><RefreshCw className="h-5 w-5 text-lime" aria-hidden /><p className="mt-2 text-lg font-semibold">You&apos;re caught up.</p>
          <p className="mt-1 text-sm text-sub">{nextUp ? `Your next revision: ${nextUp.title}, ${formatDate(nextUp.due_date)}.` : "Complete a topic and its first revision is scheduled automatically."}</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row"><Link href="/study" className="btn-primary">Study a topic</Link><Link href="/practice/new?scope=mixed" className="btn-ghost">Practice PYQs</Link></div></div>
      )}
      {rows.length === 0 && done.length === 0 && <EmptyState icon={RefreshCw} title="No revisions yet" hint="Revisions are scheduled when you complete a topic or chapter, or when practice finds a weak spot." action={{ href: "/syllabus", label: "Open the syllabus" }} />}
      <Group title="Overdue" rows={g.overdue} /><Group title="Due today" rows={g.today} /><Group title="Upcoming" rows={g.upcoming.slice(0, 15)} />
      {done.length > 0 && <section aria-label="Completed"><h2 className="mb-3 font-semibold">Completed <span className="text-sm font-normal text-mute">(finished the ladder)</span></h2>
        <ul className="divide-y divide-line rounded-card border border-line">{done.map((d) => <li key={d.entity_id}><Link href={studyHref(d.entity_type, d.entity_id)} className="flex min-h-[52px] items-center justify-between gap-3 px-4 text-sm hover:text-lime"><span className="min-w-0 truncate">{d.title}</span><span className="shrink-0 text-xs text-mute">{formatDate(d.reviewed_on)}</span></Link></li>)}</ul></section>}
    </div>);
}
