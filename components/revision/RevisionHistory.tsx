import { historyLine } from "@/lib/revision/queue";
import type { HistoryRow } from "@/types/revision";
/** Lightweight history: date, rating, what it set next. Server-rendered from revision_reviews (append-only). */
export function RevisionHistory({ rows, empty = "No reviews yet." }: { rows: HistoryRow[]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-mute">{empty}</p>;
  return <ul className="space-y-1.5 text-sm text-sub">{rows.slice(0, 6).map((h) => <li key={h.id}>{historyLine(h)}</li>)}</ul>;
}
