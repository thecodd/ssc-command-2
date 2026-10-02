import Link from "next/link";
import { RefreshCw } from "lucide-react";
import type { SummaryView as View } from "@/lib/practice/summary";
/** Presentational: every number is the server's (finish_practice). One primary action, the rest secondary. */
export function SummaryView({ v, title }: { v: View; title: string }) {
  return (
    <section aria-labelledby="sum-h" className="space-y-6">
      <div><p className="text-sm text-sub">{title}</p><h1 id="sum-h" className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Session summary</h1></div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {v.stats.map((s) => <div key={s.label} className="card p-4"><dt className="text-xs text-mute">{s.label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</dd></div>)}
      </dl>
      {v.incomplete && <p className="text-sm text-mute">{v.incomplete}</p>}
      {v.weak.length > 0 && (
        <div>
          <h2 className="mb-2 font-semibold">Weak areas</h2>
          <ul className="space-y-2">{v.weak.map((w) => <li key={w.topicId}><Link href={w.href} className="card flex min-h-[56px] items-center justify-between gap-3 px-4 py-3 hover:border-mute"><span className="min-w-0"><span className="block truncate">{w.title}</span><span className="text-xs text-mute">{w.note}</span></span><span className="text-sm text-lime">Study</span></Link></li>)}</ul>
          {v.revisionNote && <p className="mt-3 flex items-center gap-2 text-sm text-sub"><RefreshCw className="h-4 w-4 text-violet" aria-hidden />{v.revisionNote}</p>}
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link href={v.primary.href} className="btn-primary">{v.primary.label}</Link>
        {v.secondary.map((a) => <Link key={a.label} href={a.href} className="btn-ghost">{a.label}</Link>)}
      </div>
    </section>
  );
}
