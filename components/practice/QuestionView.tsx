"use client";
import Link from "next/link";
import { useId } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { studyHref } from "@/lib/study/routes";
import type { PState } from "@/lib/practice/machine";

const optionEntries = (o: Record<string, string>) => Object.entries(o).sort(([a], [b]) => a.localeCompare(b));

/** One question. The correct option is marked ONLY from the server's grading result; before submitting there is nothing to reveal. */
export function QuestionView({ s, onPick, onSubmit, onNext, last, busy }: { s: PState; onPick(k: string): void; onSubmit(): void; onNext(): void; last: boolean; busy: boolean }) {
  const q = s.question!, name = useId(), r = s.result, answered = s.phase === "answered";
  const meta = [q.exam, q.year, q.tier, q.shift].filter(Boolean).join(" · ");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!answered) onSubmit(); }} className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mute">
        <span className="tabular-nums text-sub">Question {s.index + 1} of {q.total}</span>
        {meta && <span>{meta}</span>}{q.source_ref && <span>Q{q.source_ref}</span>}
        {q.difficulty && <Badge>{q.difficulty}</Badge>}
      </div>
      <fieldset className="min-w-0 border-0 p-0" disabled={answered || busy}>
        <legend className="mb-4 whitespace-pre-wrap break-words text-lg leading-relaxed sm:text-xl">{q.question}</legend>
        <div className="space-y-2.5">
          {optionEntries(q.options).map(([key, text]) => {
            const mine = s.picked === key, isRight = answered && r?.correct_answer === key, isWrong = answered && mine && !r?.is_correct;
            const cls = isRight ? "border-lime bg-lime-dim" : isWrong ? "border-red-500/60 bg-red-500/10" : mine ? "border-lime/60 bg-raised" : "border-line bg-surface hover:border-mute";
            return (
              <label key={key} className="block cursor-pointer">
                <input type="radio" name={name} value={key} checked={mine} onChange={() => onPick(key)} className="peer sr-only" />
                <span className={`flex min-h-[56px] items-start gap-3 rounded-ctl border px-3.5 py-3 transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-lime ${cls}`}>
                  <span aria-hidden className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line text-xs">{key}</span>
                  <span className="min-w-0 flex-1 break-words text-base">{text}</span>
                  {isRight && <span className="flex shrink-0 items-center gap-1 text-xs text-lime"><Check className="h-4 w-4" aria-hidden />Correct answer</span>}
                  {isWrong && <span className="flex shrink-0 items-center gap-1 text-xs text-red-400"><X className="h-4 w-4" aria-hidden />Your answer</span>}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* one persistent polite live region (the heading below keeps its heading role) */}
      <p role="status" className="sr-only">{answered && r ? (r.is_correct ? "Correct" : "Incorrect") : ""}</p>
      {answered && r && (
        <section aria-labelledby="fb-h" className={`rounded-card border p-4 ${r.is_correct ? "border-lime/40 bg-lime-dim" : "border-red-500/40 bg-red-500/10"}`}>
          <h2 id="fb-h" className="text-base font-semibold">{r.is_correct ? "Correct" : `Incorrect. The answer is ${r.correct_answer}.`}</h2>
          {r.explanation ? <p className="mt-2 whitespace-pre-wrap text-sm text-sub">{r.explanation}</p> : <p className="mt-2 text-sm text-mute">No explanation is recorded for this question.</p>}
          {(q.foundation || (q.topics && q.topics.length > 0)) && (
            <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
              {q.foundation && <div className="flex flex-wrap items-center gap-x-2"><dt className="text-mute">Concept</dt><dd><Link href={studyHref("ncert_chapter", q.foundation.id)} className="inline-flex min-h-[44px] items-center text-ink underline">{q.foundation.title}</Link></dd></div>}
              {q.topics && q.topics.length > 0 && <div className="flex flex-wrap items-center gap-x-2"><dt className="text-mute">SSC topic</dt><dd className="flex flex-wrap gap-x-3">{q.topics.map((t) => <Link key={t.id} href={studyHref("ssc_topic", t.id)} className="inline-flex min-h-[44px] items-center text-ink underline">{t.title}</Link>)}</dd></div>}
            </dl>
          )}
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:pb-0">
        <div className="mx-auto max-w-2xl px-4 py-3 sm:px-0 sm:py-0">
          {answered
            ? <button type="button" onClick={onNext} disabled={busy} className="btn-primary w-full sm:w-auto">{last ? "See summary" : "Next question"}<ArrowRight className="h-4 w-4" aria-hidden /></button>
            : <button type="submit" disabled={!s.picked || busy} className="btn-primary w-full disabled:opacity-50 sm:w-auto">{s.phase === "submitting" ? "Checking…" : "Submit answer"}</button>}
        </div>
      </div>
    </form>
  );
}
