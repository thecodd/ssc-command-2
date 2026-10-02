import Link from "next/link";
import { getLadder, getOpenRevision, getRevisionHistory } from "@/services/revision";
import { revisionHref } from "@/lib/revision/routes";
import { formatDate } from "@/lib/time";
import type { EntityType } from "@/types/curriculum";
import { LadderStrip } from "./LadderStrip";
import { RevisionHistory } from "./RevisionHistory";
/** Server component for detail pages: current revision state, the user's ladder, and the last few reviews. All read from the database. */
export async function RevisionPanel({ type, id }: { type: EntityType; id: string }) {
  const [open, ladder, history] = await Promise.all([getOpenRevision(type, id), getLadder().catch(() => [] as number[]), getRevisionHistory(type, id)]);
  const state = !open ? (history.length ? "No open revision (ladder complete)" : "No revision scheduled") : open.daysUntil < 0 ? `Overdue by ${-open.daysUntil} ${open.daysUntil === -1 ? "day" : "days"}` : open.daysUntil === 0 ? "Due today" : `Next revision ${formatDate(open.dueDate)}`;
  return (
    <section aria-labelledby="rev-h" className="card space-y-3 p-5">
      <h2 id="rev-h" className="text-sm text-sub">Revision</h2>
      <p className="font-medium">{state}</p>
      {open && open.daysUntil <= 0 && <Link href={revisionHref(open.scheduleId)} className="btn-primary w-full sm:w-auto">Review</Link>}
      {open && ladder.length > 0 && <LadderStrip ladder={ladder} step={open.step} />}
      {history.length > 0 && <RevisionHistory rows={history} />}
    </section>);
}
