"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Play, Pause, Square, Check, RefreshCw } from "lucide-react";
import { Ring } from "@/components/ui/Ring";
import { Badge } from "@/components/ui/Badge";
import { MASTERY_LABEL, MASTERY_TONE, type Mastery } from "@/lib/learning/rules";
import { LEARNING } from "@/lib/learning/config";
import { clock, fmtDuration } from "@/lib/format";
import { setProgressAction, completeAction, scheduleRevisionAction, studyStartAction, studyPauseAction, studyResumeAction, studyHeartbeatAction, studyRecoverAction, studyFinishAction } from "@/app/actions/progress";
import type { EntityType, Progress, StudySession } from "@/types/curriculum";

/** `mastery` is DERIVED by the database and passed in; this component never computes it. The timer shows SERVER time:
 *  every response carries elapsed_seconds + server_now, and the client only ticks between responses. */
export function ProgressPanel({ type, id, path, progress, mastery }: { type: EntityType; id: string; path: string; progress: Progress; mastery: Mastery }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [slider, setSlider] = useState(progress.completion);
  const [sess, setSess] = useState<StudySession | null>(null);
  const [tick, setTick] = useState(0);
  const base = useRef({ elapsed: 0, at: 0 });
  useEffect(() => setSlider(progress.completion), [progress.completion]);

  const adopt = useCallback((s: StudySession | null) => {
    if (s && s.entity_type === type && s.entity_id === id && (s.state === "active" || s.state === "paused")) { base.current = { elapsed: s.elapsed_seconds, at: Date.now() }; setSess(s); } else setSess(null);
  }, [type, id]);
  // refresh-safe: re-adopt an open session when the page (re)mounts
  useEffect(() => { studyRecoverAction().then((r) => r.ok && adopt(r.data)); }, [adopt]);
  const active = sess?.state === "active";
  useEffect(() => { if (!active) return; const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, [active]);
  const sessId = sess?.id;
  useEffect(() => {
    if (!active || !sessId) return;
    const t = setInterval(() => studyHeartbeatAction(sessId).then((r) => { if (r.ok) { if (r.data.state === "active" || r.data.state === "paused") adopt(r.data); else setSess(null); } }), LEARNING.heartbeatSeconds * 1000);
    return () => clearInterval(t);
  }, [active, sessId, adopt]);
  void tick;
  const shown = sess ? base.current.elapsed + (active ? Math.floor((Date.now() - base.current.at) / 1000) : 0) : 0;

  const run = (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>) => start(async () => { setErr(null); const r = await fn(); if (!r.ok) setErr(r.error ?? "Something went wrong."); });
  const begin = () => run(async () => { const r = await studyStartAction(type, id); if (r.ok) adopt(r.data); return r; });
  const toggle = () => run(async () => { if (!sess) return { ok: true }; const r = await (active ? studyPauseAction(sess.id) : studyResumeAction(sess.id)); if (r.ok) adopt(r.data); return r; });
  const finish = () => run(async () => { if (!sess) return { ok: true }; const r = await studyFinishAction(sess.id, path); if (r.ok) setSess(null); return r; });
  const done = progress.status === "completed";

  return (
    <section className="card p-5" aria-label="Your progress">
      <div className="flex items-center gap-5">
        <Ring value={progress.completion} label="Completion" />
        <div className="min-w-0 space-y-1.5">
          <Badge tone={MASTERY_TONE[mastery] === "red" ? "mute" : MASTERY_TONE[mastery]}><span className={MASTERY_TONE[mastery] === "red" ? "text-red-400" : ""}>{done && <Check className="mr-1 inline h-3 w-3" />}{MASTERY_LABEL[mastery]}</span></Badge>
          <p className="text-xs text-sub">{fmtDuration(progress.seconds_spent)} studied · {progress.sessions} {progress.sessions === 1 ? "session" : "sessions"}</p>
          <p className="text-xs text-sub">Revised {progress.revision_count}×</p>
        </div>
      </div>

      {sess ? (
        <div className="mt-5 rounded-ctl border border-lime/30 bg-lime-dim p-4 text-center">
          <p className="text-3xl font-semibold tabular-nums">{clock(shown)}</p>
          <div className="mt-3 flex justify-center gap-2">
            <button className="btn-ghost" disabled={pending} onClick={toggle}>{active ? <><Pause className="h-4 w-4" />Pause</> : <><Play className="h-4 w-4" />Resume</>}</button>
            <button className="btn-primary" disabled={pending} onClick={finish}><Square className="h-4 w-4" />Finish</button>
          </div>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button className="btn-primary col-span-2" disabled={pending} onClick={begin}><Play className="h-4 w-4" />Start study</button>
          <button className="btn-ghost" disabled={pending} onClick={() => run(() => completeAction(type, id, path))}><Check className="h-4 w-4" />Mark complete</button>
          <button className="btn-ghost" disabled={pending} onClick={() => run(() => scheduleRevisionAction(type, id, path))}><RefreshCw className="h-4 w-4" />Revise now</button>
        </div>
      )}

      <div className="mt-5">
        <label className="flex justify-between text-sm text-sub" htmlFor={`c-${id}`}><span>Completion</span><span className="tabular-nums text-ink">{slider}%</span></label>
        <input id={`c-${id}`} type="range" min={0} max={100} step={5} value={slider} className="mt-2 w-full accent-[#B8FF3D]"
          onChange={(e) => setSlider(+e.target.value)} onPointerUp={() => run(() => setProgressAction(type, id, { completion: slider }, path))}
          onKeyUp={(e) => /^(Arrow|Home$|End$|Page)/.test(e.key) && run(() => setProgressAction(type, id, { completion: slider }, path))} />
      </div>
      <div className="mt-4">
        <p className="mb-2 text-sm text-sub">Confidence</p>
        <div className="flex gap-2" role="radiogroup" aria-label="Confidence">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} role="radio" aria-checked={progress.confidence === n} disabled={pending} onClick={() => run(() => setProgressAction(type, id, { confidence: n }, path))}
              className={`h-11 flex-1 rounded-ctl border text-sm transition ${progress.confidence === n ? "border-lime bg-lime-dim text-lime" : "border-line text-sub hover:bg-raised"}`}>{n}</button>
          ))}
        </div>
      </div>
      {err && <p role="alert" className="mt-3 text-sm text-red-400">{err}</p>}
    </section>
  );
}
