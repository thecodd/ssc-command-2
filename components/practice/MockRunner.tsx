"use client";
import Link from "next/link";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Flag, X } from "lucide-react";
import { clock, ensureDeadline, mockSeconds, remainingSeconds } from "@/lib/practice/mock";
import { clearDraft, counts, emptyDraft, loadDraft, pendingSubmissions, saveDraft, setAnswer, statusOf, toggleFlag, type Draft } from "@/lib/practice/mockDraft";
import { summaryView } from "@/lib/practice/summary";
import type { PracticeQuestion, PracticeSession, PracticeSummary } from "@/types/practice";
import { PracticeApiCtx } from "./PracticeApiContext";
import { SummaryView } from "./SummaryView";
import type { RunnerInfo } from "./PracticeRunner";

const entries = (o: Record<string, string>) => Object.entries(o).sort(([a], [b]) => a.localeCompare(b));
type Phase = "test" | "confirm" | "submitting" | "review";

/** Timed, exam-style mock. Free navigation, changeable answers and flags live in a local draft; "Submit test" (or the timer reaching zero)
 *  sends them through the server-graded submit, then the server's summary and a per-question review are shown. */
export function MockRunner({ session, info }: { session: PracticeSession; info: RunnerInfo }) {
  const api = useContext(PracticeApiCtx);
  const ids = session.pyq_ids;
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [ready, setReady] = useState(false);
  const [index, setIndex] = useState(0);
  const [qs, setQs] = useState<Record<string, PracticeQuestion>>({});
  const [phase, setPhase] = useState<Phase>(session.state === "active" ? "test" : "submitting");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PracticeSummary | null>(null);
  const [review, setReview] = useState<Record<string, PracticeQuestion>>({});
  const [left, setLeft] = useState<number | null>(null);
  const sent = useRef(new Set(session.answered.map((a) => a.pyq_id)));
  const busy = useRef(false), autoFired = useRef(false), startedAt = useRef(Date.now());

  useEffect(() => { setDraft(loadDraft(session.id, ids)); setReady(true); }, [session.id, ids]);
  useEffect(() => { if (ready && phase !== "review") saveDraft(session.id, draft); }, [ready, draft, phase, session.id]);

  const cur = ids[index];
  useEffect(() => {      // fetch the current question (and the next one) so moving on feels instant
    if (phase !== "test" && phase !== "confirm") return;
    let alive = true;
    for (const id of [cur, ids[index + 1]]) {
      if (!id || qs[id]) continue;
      void api.question(session.id, id).then((r) => { if (alive && r.ok) setQs((p) => (p[id] ? p : { ...p, [id]: r.data })); else if (alive && !r.ok && id === cur) setError(r.error); });
    }
    return () => { alive = false; };
  }, [api, cur, index, ids, phase, qs, session.id]);

  const submitAll = useCallback(async () => {
    if (busy.current) return; busy.current = true; setError(null); setPhase("submitting");
    const todo = pendingSubmissions(ids, draft, sent.current);
    const each = todo.length ? Math.max(1, Math.round((Date.now() - startedAt.current) / 1000 / todo.length)) : 0;     // informational; the server clamps it
    for (const t of todo) {
      const r = await api.submit(session.id, t.id, t.selected, each);
      if (!r.ok) { setError(r.error); setPhase("confirm"); busy.current = false; return; }
      sent.current.add(t.id);
    }
    const f = await api.finish(session.id, false);
    if (!f.ok) { setError(f.error); setPhase("confirm"); busy.current = false; return; }
    setSummary(f.data); clearDraft(session.id);
    const got: Record<string, PracticeQuestion> = {};
    await Promise.all(ids.map(async (id) => { const r = await api.question(session.id, id); if (r.ok) got[id] = r.data; }));
    setReview(got); setPhase("review"); busy.current = false;
  }, [api, draft, ids, session.id]);

  // overall countdown from a persisted deadline; at zero the test is submitted exactly once
  useEffect(() => {
    if (!ready || phase === "review") return;
    const deadline = ensureDeadline(session.id, mockSeconds(session.total), Date.now());
    const tick = () => { const r = remainingSeconds(deadline, Date.now()); setLeft(r); if (r === 0 && !autoFired.current) { autoFired.current = true; void submitAll(); } };
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, [ready, phase, session.id, session.total, session.state, submitAll]);
  useEffect(() => { if (ready && session.state !== "active" && !summary) void submitAll(); }, [ready, session.state, summary, submitAll]);

  const c = useMemo(() => counts(draft, ids), [draft, ids]);
  const q = qs[cur];
  const sum = summary ? summaryView(summary, { href: info.backHref, label: info.backLabel }) : null;

  const header = (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-3 py-2 sm:px-4">
        <Link href={info.backHref} className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-ctl px-2 text-sm text-sub hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden />Exit</Link>
        <div className="min-w-0 flex-1"><p className="truncate text-[11px] uppercase tracking-widest text-mute">Timed mock</p><h1 className="truncate text-sm font-medium">{info.title}</h1></div>
        {phase !== "review" && left !== null && <span role="timer" aria-label="Time left" className={`rounded-ctl px-2 py-1 text-sm font-medium tabular-nums ${left <= 60 ? "bg-red-500/15 text-red-300" : "text-sub"}`}>{clock(left)}</span>}
      </div>
    </header>
  );

  if (phase === "review" && sum && summary) {
    return (
      <div className="min-h-dvh">{header}
        <div className="mx-auto max-w-2xl space-y-10 px-4 pb-16 pt-6">
          <SummaryView v={sum} title={info.title} />
          <section aria-labelledby="rev-h"><h2 id="rev-h" className="mb-3 text-xl font-semibold">Review</h2>
            <ol className="space-y-4">{ids.map((id, i) => { const rq = review[id]; const a = rq?.answer; const mine = a?.selected ?? session.answered.find((x) => x.pyq_id === id)?.selected ?? draft.sel[id] ?? null;
              return (
                <li key={id} className="card p-4">
                  <p className="text-xs text-mute">Question {i + 1}{a ? (a.is_correct ? " · Correct" : " · Incorrect") : " · Not answered"}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words">{rq?.question ?? "Question unavailable"}</p>
                  {rq && <ul className="mt-3 space-y-1.5">{entries(rq.options).map(([k, t]) => { const right = a?.correct_answer === k, wrong = !!a && mine === k && !a.is_correct;
                    return <li key={k} className={`flex items-start gap-2 rounded-ctl border px-3 py-2 text-sm ${right ? "border-lime bg-lime-dim" : wrong ? "border-red-500/60 bg-red-500/10" : "border-line"}`}>
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line text-[11px]">{k}</span><span className="min-w-0 flex-1 break-words">{t}</span>
                      {right && <span className="flex shrink-0 items-center gap-1 text-xs text-lime"><Check className="h-4 w-4" aria-hidden />Correct</span>}
                      {wrong && <span className="flex shrink-0 items-center gap-1 text-xs text-red-400"><X className="h-4 w-4" aria-hidden />Yours</span>}</li>; })}</ul>}
                  {a?.explanation && <p className="mt-3 whitespace-pre-wrap text-sm text-sub">{a.explanation}</p>}
                </li>); })}</ol>
          </section>
        </div>
      </div>);
  }

  if (phase === "submitting") return <div className="min-h-dvh">{header}<p role="status" className="py-24 text-center text-sub">Submitting and scoring…</p></div>;

  return (
    <div className="min-h-dvh">{header}
      <div className="mx-auto max-w-2xl px-4 pb-40 pt-5 sm:pb-12">
        {api.mode === "fixture" && <p role="note" className="mb-4 rounded-ctl border border-amber-400/40 bg-amber-400/10 p-2 text-center text-xs text-amber-200">FIXTURE DATA: development preview. Nothing here is real.</p>}
        {error && <div role="alert" className="mb-4 rounded-ctl border border-red-500/40 bg-red-500/10 p-3 text-sm">{error}{phase === "confirm" && <button type="button" onClick={() => void submitAll()} className="ml-3 min-h-[44px] text-lime underline">Retry submit</button>}</div>}

        {phase === "confirm" ? (
          <section aria-labelledby="cf-h" className="card space-y-4 p-5">
            <h2 id="cf-h" className="text-lg font-semibold">Submit the test?</h2>
            <p className="text-sm text-sub"><span className="tabular-nums text-ink">{c.answered}</span> answered, <span className="tabular-nums text-ink">{c.unanswered}</span> not answered, <span className="tabular-nums text-ink">{c.flagged}</span> flagged. You cannot change answers after submitting.</p>
            <div className="flex flex-col gap-2 sm:flex-row"><button type="button" className="btn-primary" onClick={() => void submitAll()}>Submit and see score</button><button type="button" className="btn-ghost" onClick={() => setPhase("test")}>Back to the test</button></div>
          </section>
        ) : (
          <>
            <nav aria-label="Question navigator" className="mb-5"><ol className="flex flex-wrap gap-1.5">{ids.map((id, i) => { const st = statusOf(draft, id);
              return <li key={id}><button type="button" onClick={() => setIndex(i)} aria-current={i === index ? "true" : undefined} aria-label={`Question ${i + 1}, ${st}`}
                className={`grid min-h-[44px] min-w-[44px] place-items-center rounded-ctl border text-sm tabular-nums ${i === index ? "border-lime bg-lime-dim text-ink" : st === "flagged" ? "border-amber-400/60 bg-amber-400/10" : st === "answered" ? "border-lime/40 bg-raised" : "border-line"}`}>{i + 1}</button></li>; })}</ol></nav>
            {!q ? <div aria-busy="true" aria-label="Loading question" className="space-y-4"><div className="skeleton h-6 w-1/3 rounded" /><div className="skeleton h-24 rounded-card" /><div className="skeleton h-14 rounded-ctl" /></div> : (
              <fieldset className="min-w-0 border-0 p-0">
                <legend className="mb-1 text-xs text-sub tabular-nums">Question {index + 1} of {ids.length}</legend>
                <p className="mb-4 whitespace-pre-wrap break-words text-lg leading-relaxed sm:text-xl">{q.question}</p>
                <div className="space-y-2.5">{entries(q.options).map(([k, t]) => { const mine = draft.sel[cur] === k;
                  return <label key={k} className="block cursor-pointer"><input type="radio" name={`q-${cur}`} value={k} checked={mine} onChange={() => setDraft((d) => setAnswer(d, cur, k))} className="peer sr-only" />
                    <span className={`flex min-h-[56px] items-start gap-3 rounded-ctl border px-3.5 py-3 transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-lime ${mine ? "border-lime/60 bg-raised" : "border-line bg-surface hover:border-mute"}`}>
                      <span aria-hidden className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line text-xs">{k}</span><span className="min-w-0 flex-1 break-words text-base">{t}</span></span></label>; })}</div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className="btn-ghost" disabled={!draft.sel[cur]} onClick={() => setDraft((d) => setAnswer(d, cur, null))}>Clear answer</button>
                  <button type="button" className="btn-ghost" aria-pressed={draft.flagged.includes(cur)} onClick={() => setDraft((d) => toggleFlag(d, cur))}><Flag className="h-4 w-4" aria-hidden />{draft.flagged.includes(cur) ? "Unflag" : "Flag for review"}</button>
                </div>
              </fieldset>)}
          </>)}
      </div>

      {phase === "test" && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:pb-0">
          <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3 sm:px-4">
            <button type="button" className="btn-ghost" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}><ArrowLeft className="h-4 w-4" aria-hidden />Previous</button>
            <button type="button" className="btn-ghost" disabled={index >= ids.length - 1} onClick={() => setIndex((i) => Math.min(ids.length - 1, i + 1))}>Next<ArrowRight className="h-4 w-4" aria-hidden /></button>
            <button type="button" className="btn-primary ml-auto" onClick={() => setPhase("confirm")}>Submit test</button>
          </div>
        </div>)}
    </div>);
}
