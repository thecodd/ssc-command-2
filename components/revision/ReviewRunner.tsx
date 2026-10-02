"use client";
import Link from "next/link";
import { useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Info, Target } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Sheet } from "@/components/ui/Sheet";
import { ConfidenceScale } from "@/components/study/ConfidenceScale";
import { createReviewController } from "@/lib/revision/controller";
import { initialRState, reduce } from "@/lib/revision/machine";
import { nextReviewText } from "@/lib/revision/queue";
import { revisionHref } from "@/lib/revision/routes";
import { MASTERY_LABEL, type Mastery } from "@/lib/learning/rules";
import type { EntityType } from "@/types/curriculum";
import type { HistoryRow, IntervalPreview, ReviewState } from "@/types/revision";
import { LadderStrip } from "./LadderStrip";
import { RatingControls } from "./RatingControls";
import { RevisionHistory } from "./RevisionHistory";
import { ResultView } from "./ResultView";
import { RevisionApiCtx } from "./RevisionApiContext";

export interface ReviewRunnerProps {
  scheduleId: string; type: EntityType; entityId: string; title: string; subject: string; kicker: string;
  reviewNo: number; dueText: string; overdue: boolean; step: number; ladder: number[]; preview: IntervalPreview[];
  mastery: Mastery; masteryWhy: string; confidence: number | null; history: HistoryRow[];
  pyq: { total: number; attempted: number; accuracyPct: number | null }; practiceHref: string | null; studyHref: string;
  material: React.ReactNode;     // server-rendered quick-recall material (key points, connections, notes)
}

function Facts({ p }: { p: ReviewRunnerProps }) {
  return (
    <div className="space-y-5 text-sm">
      <div><h3 className="text-xs uppercase tracking-widest text-mute">Mastery</h3><p className="mt-1 text-base font-medium">{MASTERY_LABEL[p.mastery]}</p><p className="mt-0.5 text-sub">{p.masteryWhy}</p></div>
      <div><h3 className="text-xs uppercase tracking-widest text-mute">Ladder</h3><div className="mt-1.5"><LadderStrip ladder={p.ladder} step={p.step} /></div></div>
      <div><h3 className="text-xs uppercase tracking-widest text-mute">Past reviews</h3><div className="mt-1.5"><RevisionHistory rows={p.history} empty="This is the first review." /></div></div>
      <div><h3 className="text-xs uppercase tracking-widest text-mute">PYQs</h3>
        <p className="mt-1 text-sub">{p.pyq.total === 0 ? "No mapped PYQs yet." : p.pyq.attempted > 0 ? `${p.pyq.total} available · ${p.pyq.attempted} attempted · ${p.pyq.accuracyPct ?? 0}% accuracy` : `${p.pyq.total} available · none attempted`}</p></div>
    </div>
  );
}

export function ReviewRunner(p: ReviewRunnerProps) {
  const api = useContext(RevisionApiCtx), router = useRouter();
  // The controller must NOT be recreated when the router object's identity changes: a recreated controller is disposed mid-request and its result would be dropped.
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; }, [router]);
  const [s, dispatch] = useReducer(reduce, p.step, initialRState);
  const sRef = useRef(s);
  useEffect(() => { sRef.current = s; }, [s]);
  const [details, setDetails] = useState(false);
  const [scratch, setScratch] = useState("");
  const ctl = useMemo(() => createReviewController({ api, scheduleId: p.scheduleId, type: p.type, id: p.entityId, getState: () => sRef.current, dispatch, refresh: () => routerRef.current.refresh() }), [api, p.scheduleId, p.type, p.entityId]);
  useEffect(() => { ctl.activate(); return () => ctl.dispose(); }, [ctl]);

  useEffect(() => {             // Esc leaves (never while typing or with a dialog open)
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]") || (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) return;
      router.push("/revision");
    };
    document.addEventListener("keydown", on); return () => document.removeEventListener("keydown", on);
  }, [router]);

  const submitting = s.phase === "submitting";
  const header = (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2 lg:px-8">
        <Link href="/revision" aria-keyshortcuts="Escape" className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-ctl px-2 text-sm text-sub hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden />Exit</Link>
        <div className="min-w-0 flex-1"><p className="truncate text-[11px] uppercase tracking-widest text-mute">{p.kicker} · Revision {p.reviewNo}</p><p className="truncate text-sm font-medium">{p.title}</p></div>
        <div className="hidden sm:block"><Badge tone={p.overdue ? "violet" : "lime"}>{p.dueText}</Badge></div>
        <button type="button" onClick={() => setDetails(true)} className="btn-ghost lg:hidden">Details</button>
      </div>
    </header>
  );
  const shell = (children: React.ReactNode) => (<>{header}{api.mode === "fixture" && <p role="note" className="border-b border-amber-400/40 bg-amber-400/10 px-4 py-2 text-center text-xs text-amber-200">FIXTURE DATA: development preview. Nothing is saved.</p>}<div className="mx-auto max-w-5xl px-4 pb-36 pt-6 lg:px-8 lg:pb-16">{children}</div></>);

  if (s.phase === "done" && s.outcome) return shell(<div className="mx-auto max-w-xl"><ResultView o={s.outcome} studyHref={p.studyHref} /></div>);

  if (s.phase === "stale") {
    const f: ReviewState | null = s.fresh;
    return shell(
      <section role="alert" aria-labelledby="stale-h" className="mx-auto max-w-xl space-y-4">
        <h1 id="stale-h" className="text-2xl font-bold tracking-tight">{s.notice}</h1>
        <p className="text-sm text-sub">{f ? (f.done ? "It's no longer open: the ladder is complete or it was reviewed already." : `It is now due ${f.bucket === "today" ? "today" : f.dueDate ? nextReviewText({ graduated: false, intervalDays: null, dueDate: f.dueDate }) : ""}. Nothing you did here overwrote it.`) : "We couldn't load its current state. Nothing you did here overwrote it."}</p>
        <div className="flex flex-col gap-2 sm:flex-row"><Link href="/revision" className="btn-primary">Back to revision queue</Link><a href={revisionHref(p.scheduleId)} className="btn-ghost">Reload this review</a><Link href={p.studyHref} className="btn-ghost">Continue studying</Link></div>
      </section>);
  }

  const recall = s.phase === "recall";
  return (<>
    {shell(
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-8">
          <div><p className="text-sm text-sub">{p.subject}</p><h1 className="mt-1 break-words text-3xl font-bold tracking-tight">{p.title}</h1><p className="mt-2 text-sm"><span className={p.overdue ? "text-violet" : "text-lime"}>{p.dueText}</span><span className="text-mute"> · Revision {p.reviewNo}</span></p></div>

          {recall ? (
            <section aria-labelledby="recall-h" className="space-y-4">
              <h2 id="recall-h" className="text-xl font-semibold">Can you still recall this?</h2>
              <p className="text-sub">Before you look: say out loud, or jot down, what you remember about <span className="text-ink">{p.title}</span>. Key ideas, facts, how it connects. Trying comes first; checking comes next.</p>
              <div><label htmlFor="scratch" className="mb-1.5 block text-sm text-sub">Your recall <span className="text-mute">(optional, not saved)</span></label>
                <textarea id="scratch" value={scratch} onChange={(e) => setScratch(e.target.value)} rows={5} className="w-full rounded-ctl border border-line bg-surface px-3 py-3 text-base outline-none focus:border-lime lg:text-sm" /></div>
            </section>
          ) : (<>
            <section aria-labelledby="mat-h" className="space-y-4"><h2 id="mat-h" className="text-xl font-semibold">Check yourself</h2>{scratch.trim() && <p className="whitespace-pre-wrap rounded-ctl border border-line bg-surface p-3 text-sm text-sub"><span className="mb-1 block text-xs text-mute">What you wrote</span>{scratch}</p>}{p.material}</section>
            <section aria-label="Confidence"><ConfidenceScale value={s.confidence} disabled={submitting} onPick={(n) => dispatch({ t: "confidence", n })} legend="How sure are you of this now? (optional)" /></section>
            {p.practiceHref && p.pyq.total > 0 && <section className="rounded-card border border-line p-4"><p className="flex items-center gap-2 font-medium"><Target className="h-4 w-4 text-lime" aria-hidden />Test yourself with 5 PYQs</p><p className="mt-1 text-sm text-sub">Optional. A short mini-session, then you come straight back here to rate this revision.</p><Link href={p.practiceHref} className="btn-ghost mt-3">Start 5 PYQs</Link></section>}
            <section aria-label="Rate this review"><RatingControls picked={s.picked} onPick={(r) => dispatch({ t: "pick", r })} preview={p.preview} disabled={submitting} /></section>
            {s.error && <div role="alert" className="flex items-start gap-3 rounded-ctl border border-red-500/40 bg-red-500/10 p-3 text-sm"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><p className="min-w-0 flex-1">{s.error.message}</p><button type="button" onClick={() => void ctl.retry()} className="min-h-[44px] shrink-0 px-2 underline">Retry</button></div>}
          </>)}
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 px-4 pb-[env(safe-area-inset-bottom)] pt-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
            <div className="mx-auto max-w-5xl pb-3 lg:max-w-none lg:pb-0">
              {recall
                ? <button type="button" className="btn-primary w-full lg:w-auto" onClick={() => dispatch({ t: "reveal" })}>Show the material</button>
                : <button type="button" className="btn-primary w-full disabled:opacity-60 lg:w-auto" disabled={!s.picked || submitting} onClick={() => void ctl.submit()}>{submitting ? "Saving…" : "Save review"}</button>}
            </div>
          </div>
        </div>
        <aside aria-label="About this revision" className="hidden lg:sticky lg:top-24 lg:block lg:self-start"><Facts p={p} /></aside>
      </div>)}

    <Sheet open={details} onClose={() => setDetails(false)} title="About this revision"><Facts p={p} /></Sheet>
  </>);
}
