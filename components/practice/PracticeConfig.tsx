"use client";
import Link from "next/link";
import { useContext, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Target } from "lucide-react";
import { availableFilters, buildStartRequest, DEFAULT_COUNT } from "@/lib/practice/config";
import { practiceSessionHref } from "@/lib/practice/routes";
import type { Difficulty, PracticeOptions, PracticeScope } from "@/types/practice";
import { PracticeApiCtx } from "./PracticeApiContext";

const VERB: Record<PracticeScope, string> = { ssc_topic: "Practice this topic", ssc_subtopic: "Practice this subtopic", ssc_subject: "Practice this subject", weak: "Practice weak spots", mixed: "Start mixed practice" };
export interface ConfigInfo { title: string; kicker: string; backHref: string; backLabel: string }

/** Default = one big button. The optional filters appear only when the server says they would change the question set. */
export function PracticeConfig({ scope, scopeId, info, options, backTo = null, initialCount = null }: { scope: PracticeScope; scopeId: string | null; info: ConfigInfo; options: PracticeOptions; backTo?: string | null; initialCount?: number | null }) {
  const api = useContext(PracticeApiCtx), router = useRouter();
  const f = availableFilters(options);
  const [count, setCount] = useState<number>(initialCount ?? DEFAULT_COUNT), [difficulty, setDifficulty] = useState<string | null>(null), [paper, setPaper] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const req = buildStartRequest(scope, scopeId, options, { count, difficulty, paper });
  const start = async () => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null);
    const r = await api.start(req);
    if (r.ok) router.push(practiceSessionHref(r.data.id, backTo)); else { setError(r.error); setBusy(false); lock.current = false; }
  };
  const has = f.counts.length > 0 || f.difficulties.length > 0 || f.papers.length > 0;
  return (
    <div className="mx-auto max-w-lg px-4 pb-16 pt-4">
      <Link href={info.backHref} className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 px-2 text-sm text-sub hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden />{info.backLabel}</Link>
      {api.mode === "fixture" && <p role="note" className="mb-3 rounded-ctl border border-amber-400/40 bg-amber-400/10 p-2 text-center text-xs text-amber-200">FIXTURE DATA: development preview.</p>}
      <p className="mt-4 text-sm text-sub">{info.kicker}</p>
      <h1 className="mt-1 break-words text-2xl font-bold tracking-tight sm:text-3xl">{info.title}</h1>
      {options.total === 0 ? (
        <div className="card mt-6 p-6 text-center"><Target className="mx-auto h-6 w-6 text-mute" aria-hidden /><p className="mt-2 font-medium">No practice questions yet</p><p className="mt-1 text-sm text-sub">Nothing with a valid answer key is linked here yet.</p><Link href={info.backHref} className="btn-ghost mt-4">{info.backLabel}</Link></div>
      ) : (
        <>
          <p className="mt-2 text-sm text-sub"><span className="tabular-nums text-ink">{options.total}</span> {options.total === 1 ? "question" : "questions"} available. You&apos;ll get {req.count}, newest gaps first.</p>
          <button type="button" onClick={() => void start()} disabled={busy} className="btn-primary mt-6 w-full disabled:opacity-60">{busy ? "Starting…" : VERB[scope]}</button>
          {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
          {has && (
            <details className="group mt-6 rounded-card border border-line px-4">
              <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between text-sm text-sub marker:hidden">Adjust<span aria-hidden className="transition group-open:rotate-180">⌄</span></summary>
              <div className="space-y-5 pb-4">
                {f.counts.length > 0 && <fieldset><legend className="mb-2 text-sm text-sub">Questions</legend><div className="flex gap-2">{[...f.counts, ...(f.counts.includes(DEFAULT_COUNT as 10) ? [] : [])].map((n) => <button key={n} type="button" aria-pressed={count === n} onClick={() => setCount(n)} className={`btn-ghost flex-1 ${count === n ? "border-lime/50 bg-lime-dim text-lime" : ""}`}>{n}</button>)}</div></fieldset>}
                {f.difficulties.length > 0 && <fieldset><legend className="mb-2 text-sm text-sub">Difficulty</legend><div className="flex gap-2">{([null, ...f.difficulties] as (Difficulty | null)[]).map((d) => <button key={d ?? "any"} type="button" aria-pressed={difficulty === d} onClick={() => setDifficulty(d)} className={`btn-ghost flex-1 capitalize ${difficulty === d ? "border-lime/50 bg-lime-dim text-lime" : ""}`}>{d ?? "Any"}</button>)}</div></fieldset>}
                {f.papers.length > 0 && <div><label htmlFor="paper" className="mb-2 block text-sm text-sub">Paper</label><select id="paper" value={paper ?? ""} onChange={(e) => setPaper(e.target.value || null)} className="min-h-[44px] w-full rounded-ctl border border-line bg-surface px-3 text-base lg:text-sm"><option value="">Any paper</option>{f.papers.map((p) => <option key={p.id} value={p.id}>{[p.exam, p.year, p.tier, p.shift].filter(Boolean).join(" · ")} ({p.n})</option>)}</select></div>}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
