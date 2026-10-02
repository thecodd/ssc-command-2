"use client";
import { useId } from "react";
import { RATING_COPY, RATING_ORDER, nextReviewText, previewFor, previewLine } from "@/lib/revision/queue";
import type { IntervalPreview, Rating } from "@/types/revision";
/** Hard / Good / Easy as real radio inputs (arrow keys work), each with its meaning and the server-previewed next review. The wording carries the meaning, not the colour. */
export function RatingControls({ picked, onPick, preview, disabled }: { picked: Rating | null; onPick: (r: Rating) => void; preview: IntervalPreview[]; disabled?: boolean }) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="min-w-0 border-0 p-0">
      <legend className="mb-2 text-base font-semibold">How did the recall go?</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {RATING_ORDER.map((r) => {
          const c = RATING_COPY[r], p = previewFor(preview, r);
          return (
            <label key={r} className="block cursor-pointer">
              <input type="radio" name={name} value={r} checked={picked === r} onChange={() => onPick(r)} className="peer sr-only" />
              <span className="flex min-h-[72px] flex-col justify-center gap-0.5 rounded-ctl border border-line bg-surface px-4 py-3 transition peer-checked:border-lime peer-checked:bg-lime-dim peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-lime peer-disabled:opacity-60">
                <span className="flex items-center justify-between gap-2 text-base font-semibold">{c.label}<span aria-hidden className="text-lime">{picked === r ? "Selected" : ""}</span></span>
                <span className="text-sm text-sub">{c.meaning}</span>
                <span className="text-xs text-mute">{previewLine(p)}</span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-2 min-h-[1.25rem] text-sm text-sub" aria-live="polite">{picked ? RATING_COPY[picked].consequence : "Choose one. Nothing is saved until you press Save review."}</p>
    </fieldset>
  );
}
export { nextReviewText };
