"use client";
import Link from "next/link";
import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowLeft, Timer } from "lucide-react";
import { createPracticeController } from "@/lib/practice/controller";
import { initialPState, isLast, reduce, type PAction } from "@/lib/practice/machine";
import { summaryView } from "@/lib/practice/summary";
import type { PracticeSession } from "@/types/practice";
import { clockText } from "@/lib/study/sessionMachine";
import { PracticeApiCtx } from "./PracticeApiContext";
import { QuestionView } from "./QuestionView";
import { SummaryView } from "./SummaryView";

const mono = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
export interface RunnerInfo { title: string; kicker: string; backHref: string; backLabel: string }

/** The focused question flow. Order, grading, answer key and the summary come from the server; this component sequences the screens. */
export function PracticeRunner({ session, info, returnToReview = false }: { session: PracticeSession; info: RunnerInfo; returnToReview?: boolean }) {
  const api = useContext(PracticeApiCtx);
  const [s, raw] = useReducer(reduce, session, initialPState);
  const ref = useRef(s);
  const dispatch = useCallback((a: PAction) => { ref.current = reduce(ref.current, a); raw(a); }, []);
  const ctl = useMemo(() => createPracticeController({ api, getState: () => ref.current, dispatch, now: mono }), [api, dispatch]);
  useEffect(() => { ctl.activate(); void (ref.current.phase === "finishing" ? ctl.finish() : ctl.load()); return () => ctl.dispose(); }, [ctl]);

  // optional, display-only per-question timer (the server clamps the informational time it receives; it never affects grading)
  const [showTimer, setShowTimer] = useState(false);
  const [now, setNow] = useState(0);
  const timing = showTimer && (s.phase === "ready" || s.phase === "submitting");
  useEffect(() => { if (!timing) return; setNow(mono()); const t = setInterval(() => setNow(mono()), 1000); return () => clearInterval(t); }, [timing, s.shownAt]);

  const done = s.session.answered.length, total = s.session.total;
  const busy = s.phase === "submitting" || s.phase === "finishing";
  const view = s.summary ? summaryView(s.summary, { href: info.backHref, label: info.backLabel }, returnToReview) : null;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-3 py-2 sm:px-4">
          <Link href={info.backHref} className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-ctl px-2 text-sm text-sub hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden />Exit</Link>
          <div className="min-w-0 flex-1"><p className="truncate text-[11px] uppercase tracking-widest text-mute">{info.kicker}</p><p className="truncate text-sm font-medium">{info.title}</p></div>
          {!view && <button type="button" aria-pressed={showTimer} onClick={() => setShowTimer((v) => !v)} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-ctl px-2 text-sm text-sub hover:text-ink" aria-label="Show question timer">
            <Timer className="h-4 w-4" aria-hidden />{timing ? <span className="tabular-nums" role="timer" aria-live="off">{clockText(Math.max(0, Math.floor((now - s.shownAt) / 1000)))}</span> : null}</button>}
        </div>
        {!view && <div className="mx-auto max-w-2xl px-3 pb-2 sm:px-4"><div className="h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><div className="h-full rounded-full bg-lime transition-[width] duration-200" style={{ width: `${total ? (100 * done) / total : 0}%` }} /></div>
          <p className="mt-1 text-right text-xs tabular-nums text-mute">{done} of {total} answered</p></div>}
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-32 pt-6 sm:pb-12">
        {api.mode === "fixture" && <p role="note" className="mb-4 rounded-ctl border border-amber-400/40 bg-amber-400/10 p-2 text-center text-xs text-amber-200">FIXTURE DATA: development preview. Nothing here is real.</p>}
        {s.error && (
          <div role="alert" className="mb-4 flex items-start gap-3 rounded-ctl border border-red-500/40 bg-red-500/10 p-3 text-sm">
            <p className="min-w-0 flex-1">{s.error.message}</p><button type="button" className="min-h-[44px] px-2 text-lime underline" onClick={() => void ctl.retry()}>Retry</button>
          </div>
        )}
        {view ? <SummaryView v={view} title={info.title} />
          : s.phase === "finishing" ? <p role="status" className="py-16 text-center text-sub">Wrapping up…</p>
          : !s.question ? (s.error ? null : <div aria-busy="true" aria-label="Loading question" className="space-y-4"><div className="skeleton h-6 w-1/3 rounded" /><div className="skeleton h-24 rounded-card" /><div className="skeleton h-14 rounded-ctl" /><div className="skeleton h-14 rounded-ctl" /></div>)
          : <QuestionView s={s} busy={busy} last={isLast(s)} onPick={(k) => dispatch({ t: "pick", key: k })} onSubmit={() => void ctl.submit()} onNext={() => void ctl.next()} />}
      </main>
    </div>
  );
}
