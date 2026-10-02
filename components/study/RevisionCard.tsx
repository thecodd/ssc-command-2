"use client";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { revisionHref } from "@/lib/revision/routes";
import { LadderStrip } from "@/components/revision/LadderStrip";
import { RevisionHistory } from "@/components/revision/RevisionHistory";
import type { HistoryRow } from "@/types/revision";
import type { StudyRevision } from "@/types/study";
import { useStudy } from "./StudyProvider";

/** Revision state straight from revision_schedule. Studying or re-completing never touches it (the database seeds a revision only on the first completion).
 *  Reviewing itself happens in its own mode: /revision/<id>. */
export function RevisionCard({ revision, label, canSchedule, ladder, history }: { revision: StudyRevision; label: string; canSchedule: boolean; ladder: number[]; history: HistoryRow[] }) {
  const { api, type, id, mutate, pendingKeys } = useStudy();
  const busy = pendingKeys.has("schedule");
  const due = revision.state === "due" || revision.state === "overdue";
  const schedule = () => void mutate("schedule", () => api.scheduleRevision(type, id));
  return (
    <section id="revision" data-study-section tabIndex={-1} aria-labelledby="revision-h" className="card space-y-3 p-5 outline-none">
      <h2 id="revision-h" className="flex items-center gap-2 text-sm text-sub"><RefreshCw className={`h-4 w-4 ${due ? "text-violet" : ""}`} aria-hidden />Revision</h2>
      <p className={`text-base font-medium ${due ? "text-violet" : ""}`}>{label}</p>
      {due && revision.scheduleId && <Link href={revisionHref(revision.scheduleId)} className="btn-primary w-full">Review</Link>}
      {ladder.length > 0 && revision.state !== "none" && <LadderStrip ladder={ladder} step={revision.state === "graduated" ? ladder.length : revision.step} />}
      {history.length > 0 && <div><h3 className="mb-1.5 text-xs uppercase tracking-widest text-mute">Past reviews</h3><RevisionHistory rows={history} /></div>}
      {revision.state === "none" && (<>
        <button type="button" className="btn-ghost disabled:opacity-60" disabled={!canSchedule || busy} onClick={schedule}>{busy ? "Scheduling…" : "Schedule revision"}</button>
        {!canSchedule && <p className="text-xs text-mute">Start studying first. A revision is scheduled automatically when you complete the item.</p>}
      </>)}
      {revision.state === "scheduled" && revision.scheduleId && <Link href={revisionHref(revision.scheduleId)} className="inline-flex min-h-[44px] items-center text-sm text-sub underline">Review early</Link>}
    </section>
  );
}
