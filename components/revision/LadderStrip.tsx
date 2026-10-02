import { Check } from "lucide-react";
import { ladderLabel, ladderView } from "@/lib/revision/queue";
/** The user's own ladder with the current step marked: "1d ✓ → 3d ✓ → 7d → 15d → 30d". Meaning is carried by the check mark and the bracket, not by colour. */
export function LadderStrip({ ladder, step }: { ladder: number[]; step: number | null }) {
  if (!ladder.length) return null;
  const steps = ladderView(ladder, step);
  return (
    <ol aria-label={`Revision ladder: ${ladderLabel(steps)}`} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm tabular-nums">
      {steps.map((s, i) => (
        <li key={i} aria-hidden className="flex items-center gap-1.5">
          {i > 0 && <span className="text-mute">→</span>}
          <span className={s.state === "current" ? "rounded-md border border-violet/60 px-1.5 py-0.5 text-ink" : s.state === "done" ? "text-sub" : "text-mute"}>{s.days}d{s.state === "done" && <Check className="ml-0.5 inline h-3.5 w-3.5 text-lime" />}</span>
        </li>
      ))}
    </ol>
  );
}
