import { formatDate } from "@/lib/time";
import type { StudyRevision } from "@/types/study";
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
/** Human text for the server-derived revision state. Pure. */
export function revisionLabel(r: StudyRevision): string {
  switch (r.state) {
    case "none": return "No revision scheduled";
    case "graduated": return "Revision ladder complete";
    case "due": return "Revision due today";
    case "overdue": return `Revision overdue by ${days(Math.abs(r.daysUntil ?? 0))}`;
    case "scheduled": { const d = r.daysUntil ?? 0; return d === 1 ? `Next revision: tomorrow (${formatDate(r.dueDate!)})` : `Next revision: in ${days(d)} (${formatDate(r.dueDate!)})`; }
  }
}
