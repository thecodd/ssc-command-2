"use client";
import { Pause, Play, Square } from "lucide-react";
import { useStudy } from "./StudyProvider";
/** Start / Pause / Resume / Finish. Disabled while any call is in flight (no double submits). */
export function SessionControls({ compact = false }: { compact?: boolean }) {
  const { state, start, pause, resume, finish } = useStudy();
  const busy = state.busy !== null;
  const wide = compact ? "px-3" : "min-w-[112px]";
  if (state.phase === "recovering") return <span className="text-sm text-sub">Resuming…</span>;
  if (state.phase === "running" || state.phase === "paused") {
    const running = state.phase === "running";
    return (
      <div className="flex items-center gap-2">
        <button type="button" onClick={running ? pause : resume} disabled={busy} aria-keyshortcuts="Space" className={`btn-ghost ${wide} disabled:opacity-60`}>
          {running ? <><Pause className="h-4 w-4" aria-hidden />Pause</> : <><Play className="h-4 w-4" aria-hidden />Resume</>}
        </button>
        <button type="button" onClick={finish} disabled={busy} className={`btn-primary ${wide} disabled:opacity-60`}><Square className="h-4 w-4" aria-hidden />{state.busy === "finish" ? "Finishing…" : "Finish"}</button>
      </div>
    );
  }
  return <button type="button" onClick={start} disabled={busy} className={`btn-primary ${compact ? "px-3" : "min-w-[160px]"} disabled:opacity-60`}><Play className="h-4 w-4" aria-hidden />{state.busy === "start" ? "Starting…" : "Start studying"}</button>;
}
