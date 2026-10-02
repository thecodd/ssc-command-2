"use client";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Ring } from "@/components/ui/Ring";
import { Badge } from "@/components/ui/Badge";
import { MASTERY_LABEL, MASTERY_TONE, type Mastery, type MasteryWhy } from "@/lib/learning/rules";
import { fmtDuration } from "@/lib/format";
import { ConfidenceScale } from "./ConfidenceScale";
import { useStudy } from "./StudyProvider";

export interface ProgressCardProps {
  completion: number; confidence: number | null; status: string; mastery: Mastery; why: MasteryWhy;
  secondsSpent: number; sessions: number; revisions: number; subtopicProgress: { done: number; total: number } | null;
}
/** Your numbers. Mastery and its explanation come from the database (user_entity_signals); this card only edits completion and confidence. */
export function ProgressCard(p: ProgressCardProps) {
  const { progress, pendingKeys, lastError, clearError } = useStudy();
  const [draft, setDraft] = useState(p.completion);
  useEffect(() => setDraft(p.completion), [p.completion]);
  const saving = pendingKeys.has("progress");
  const tone = MASTERY_TONE[p.mastery];
  const commit = () => { if (draft !== p.completion && !saving) void progress.setProgress({ completion: draft }); };
  const done = p.status === "completed";

  return (
    <section id="progress" data-study-section tabIndex={-1} aria-labelledby="progress-h" className="card space-y-5 p-5 outline-none">
      <div className="flex items-center gap-4">
        <Ring value={p.completion} size={88} label="Completion" />
        <div className="min-w-0 space-y-1.5">
          <h2 id="progress-h" className="text-sm text-sub">Your progress</h2>
          <Badge tone={tone === "red" ? "mute" : tone}><span className={tone === "red" ? "text-red-400" : ""}>{MASTERY_LABEL[p.mastery]}</span></Badge>
          <p className="text-xs text-sub tabular-nums">{p.secondsSpent > 0 ? fmtDuration(p.secondsSpent) : "0m"} studied · {p.sessions} {p.sessions === 1 ? "session" : "sessions"}{p.revisions > 0 ? ` · revised ${p.revisions}×` : ""}</p>
        </div>
      </div>

      <details className="group rounded-ctl border border-line px-3 text-sm">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between text-sub marker:hidden">Why this status?<span aria-hidden className="text-mute transition group-open:rotate-180">⌄</span></summary>
        <p className="pb-3 text-sub"><span className="text-ink">{p.why.headline}.</span> {p.why.detail}</p>
      </details>

      <div>
        <label htmlFor="completion" className="flex justify-between text-sm text-sub"><span>Completion</span><span className="tabular-nums text-ink">{draft}%</span></label>
        <input id="completion" type="range" min={0} max={100} step={5} value={draft} onChange={(e) => setDraft(+e.target.value)}
          onPointerUp={commit} onKeyUp={(e) => { if (/^(Arrow|Home|End|Page)/.test(e.key)) commit(); }} onBlur={commit}
          aria-valuetext={`${draft} percent`} className="mt-2 h-11 w-full accent-[#B8FF3D]" />
        {p.subtopicProgress && <p className="text-xs text-mute">{p.subtopicProgress.done} of {p.subtopicProgress.total} subtopics ticked off. Topic completion is your own call; it isn&apos;t calculated from them.</p>}
      </div>

      <ConfidenceScale value={p.confidence} disabled={saving} onPick={(n) => void progress.setProgress({ confidence: n })} />

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={saving || done} onClick={() => void progress.setProgress({ status: "completed" })} className="btn-ghost disabled:opacity-60"><Check className="h-4 w-4" aria-hidden />{done ? "Completed" : "Mark complete"}</button>
        {saving && <span role="status" className="self-center text-xs text-mute">Saving…</span>}
      </div>
      {lastError && <div role="alert" className="flex items-center justify-between gap-3 text-sm text-red-400"><p className="min-w-0">{lastError}</p><button type="button" className="min-h-[44px] shrink-0 px-2 underline" onClick={clearError}>Dismiss</button></div>}
    </section>
  );
}
