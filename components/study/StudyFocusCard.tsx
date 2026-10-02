"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { AlertTriangle, ArrowRight, Info, RefreshCw, X } from "lucide-react";
import { LEARNING } from "@/lib/learning/config";
import { nextStep, type NextStep, type StepInput } from "@/lib/study/nextStep";
import { fmtDuration } from "@/lib/format";
import { studyHref } from "@/lib/study/routes";
import { ConfidenceScale } from "./ConfidenceScale";
import { useStudy } from "./StudyProvider";

export interface FocusCardProps extends Omit<StepInput, "phase"> { confidence: number | null; revisionLabel: string; canSchedule: boolean; entityTitle: string }
const dur = (s: number) => (s < 60 ? `${s}s` : fmtDuration(s));
const toneCls = { lime: "border-lime/30 bg-lime-dim", violet: "border-violet/40 bg-violet/10", red: "border-red-500/40 bg-red-500/10" } as const;

function Notices() {
  const { state, retry, dismissNotice, other } = useStudy();
  const n = state.notice;
  return (
    <div className="space-y-2 empty:hidden">
      {other && state.phase === "idle" && (
        <div role="status" className="flex items-start gap-3 rounded-ctl border border-line bg-surface p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-violet" aria-hidden />
          <p className="min-w-0 flex-1 text-sub">You&apos;re timing <Link data-inline href={studyHref(other.type, other.entityId)} className="text-ink underline">{other.title ?? "another item"}</Link>. Starting here closes that session and keeps its time.</p>
        </div>
      )}
      {n && (
        <div role={n.kind === "error" || n.kind === "sync_lost" ? "alert" : "status"} className={`flex items-start gap-3 rounded-ctl border p-3 text-sm ${n.kind === "error" ? "border-red-500/40 bg-red-500/10" : n.kind === "sync_lost" ? "border-amber-400/40 bg-amber-400/10" : "border-line bg-surface"}`}>
          {n.kind === "error" || n.kind === "sync_lost" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-lime" aria-hidden />}
          <p className="min-w-0 flex-1">{n.message}</p>
          {n.retry && <button type="button" onClick={() => retry(n.retry!)} className="min-h-[44px] shrink-0 px-2 text-lime underline">Retry</button>}
          {n.kind !== "sync_lost" && <button type="button" onClick={dismissNotice} aria-label="Dismiss" className="grid h-11 w-11 shrink-0 place-items-center text-mute"><X className="h-4 w-4" /></button>}
        </div>
      )}
    </div>
  );
}

function Cta({ step, canSchedule }: { step: NextStep; canSchedule: boolean }) {
  const { state, start, resume, finish, api, type, id, mutate, pendingKeys } = useStudy();
  const busy = state.busy !== null;
  const c = step.cta;
  if (c.kind === "link") return <Link href={c.href} className="btn-primary">{c.label}<ArrowRight className="h-4 w-4" aria-hidden /></Link>;
  if (c.kind === "start") return <button type="button" className="btn-primary disabled:opacity-60" disabled={busy} onClick={start}>{c.label}</button>;
  if (c.kind === "resume") return <button type="button" className="btn-primary disabled:opacity-60" disabled={busy} onClick={resume}>{c.label}</button>;
  if (c.kind === "finish") return <button type="button" className="btn-primary disabled:opacity-60" disabled={busy} onClick={finish}>{c.label}</button>;
  return <button type="button" className="btn-primary disabled:opacity-60" disabled={!canSchedule || pendingKeys.has("schedule")} onClick={() => void mutate("schedule", () => api.scheduleRevision(type, id))}>{c.label}</button>;
}

/** The ONE recommendation. Before a session: what to do now. While running: just the session. After finishing: the summary + the single next step. */
export function StudyFocusCard(p: FocusCardProps) {
  const { state, clearEnded, progress, pendingKeys } = useStudy();
  const prev = useRef(state.phase);
  const before = useRef<{ completion: number; confidence: number | null } | null>(null);
  useEffect(() => { if (prev.current === "idle" && state.phase === "running") before.current = { completion: p.completion, confidence: p.confidence }; prev.current = state.phase; }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps (snapshot at the moment a session starts here)

  const { entityTitle, confidence, revisionLabel, canSchedule, ...input } = p;
  const step = nextStep({ ...input, phase: state.phase });

  if (state.phase === "recovering") return <section aria-busy="true" aria-label="Loading your session" className="card p-5"><div className="skeleton h-5 w-40 rounded" /><div className="skeleton mt-3 h-4 w-64 rounded" /></section>;

  if (state.phase === "ended" && state.ended) {
    const e = state.ended, b = before.current;
    const lines: string[] = [];
    if (b && b.completion !== input.completion) lines.push(`Completion ${b.completion}% → ${input.completion}%`);
    else lines.push(`Completion ${input.completion}%`);
    return (
      <section data-study-section tabIndex={-1} aria-labelledby="summary-h" className="card space-y-4 p-5 outline-none">
        <Notices />
        <div>
          <h2 id="summary-h" className="text-xl font-semibold">{e.byUs ? "Session complete" : "Session ended"}</h2>
          <p className="mt-1 text-sm text-sub">{entityTitle}</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-mute">Time studied</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums">{dur(e.seconds)}</dd></div>
          <div><dt className="text-mute">Progress</dt><dd className="mt-0.5 text-lg font-semibold">{lines[0]}</dd></div>
        </dl>
        {e.seconds < LEARNING.minCountedSessionSeconds && <p className="text-xs text-mute">Sessions under {LEARNING.minCountedSessionSeconds} seconds aren&apos;t counted toward your session total.</p>}
        <ConfidenceScale value={confidence} disabled={pendingKeys.has("progress")} onPick={(n) => void progress.setProgress({ confidence: n })} legend={confidence ? "Confidence now" : "How confident are you now?"} />
        <p className="text-sm text-sub"><RefreshCw className="mr-1.5 inline h-4 w-4 text-violet" aria-hidden />{revisionLabel}</p>
        <div className={`rounded-card border p-4 ${toneCls[step.tone]}`}>
          <p className="text-xs uppercase tracking-widest text-sub">Next</p>
          <p className="mt-1 text-lg font-semibold">{step.title}</p>
          <p className="mt-1 text-sm text-sub">{step.hint}</p>
          <div className="mt-3"><Cta step={step} canSchedule={canSchedule} /></div>
        </div>
        <button type="button" onClick={clearEnded} className="min-h-[44px] text-sm text-sub underline">Study again</button>
      </section>
    );
  }

  return (
    <section data-study-section tabIndex={-1} aria-labelledby="next-h" className="space-y-3 outline-none">
      <Notices />
      <div className={`rounded-card border p-5 ${toneCls[step.tone]}`}>
        <h2 id="next-h" className="text-xs font-medium uppercase tracking-widest text-sub">{state.phase === "idle" ? "Next up" : "Now"}</h2>
        <p className="mt-1 text-xl font-semibold">{step.title}</p>
        <p className="mt-1 text-sm text-sub">{step.hint}</p>
        <div className="mt-4"><Cta step={step} canSchedule={canSchedule} /></div>
      </div>
    </section>
  );
}
