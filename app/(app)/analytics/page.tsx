import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { getAnalytics } from "@/services/analytics";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { fmtDuration } from "@/lib/format";
import { MASTERY_LABEL, type Mastery } from "@/lib/learning/rules";
import { formatDate } from "@/lib/time";
export const dynamic = "force-dynamic";
const ORDER: Mastery[] = ["mastered", "strong", "learning", "in_progress", "needs_revision", "weak"];
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="card p-4"><p className="text-xs text-mute">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>{hint && <p className="mt-0.5 text-xs text-sub">{hint}</p>}</div>;
}
export default async function Analytics() {
  const a = await getAnalytics();
  if (!a.started && !a.attempts) return (<div><PageHeader title="Analytics" /><EmptyState icon={BarChart3} title="Nothing to analyse yet" hint="Study a topic or practise some PYQs; your real numbers appear here. Nothing is estimated." action={{ href: "/study", label: "Start studying" }} /></div>);
  const max = Math.max(1, ...a.days.map((d) => d.seconds)), week = a.days.slice(-7).reduce((s, d) => s + d.seconds, 0);
  const reviews = a.reviews30.easy + a.reviews30.good + a.reviews30.hard, mTotal = ORDER.reduce((s, m) => s + (a.mastery[m] ?? 0), 0);
  return (
    <div className="space-y-8">
      <PageHeader title="Analytics" subtitle="Computed from your own sessions, attempts and reviews." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Study time, last 7 days" value={fmtDuration(week)} hint={`goal ${a.goalMinutes} min/day`} />
        <Stat label="PYQ accuracy" value={a.accuracy === null ? "—" : `${a.accuracy}%`} hint={`${a.correct} of ${a.attempts} correct`} />
        <Stat label="Current streak" value={`${a.streak} ${a.streak === 1 ? "day" : "days"}`} />
        <Stat label="Items started" value={String(a.started)} hint={`${a.completed} through the first pass`} />
      </div>
      <section aria-labelledby="time-h" className="card p-5">
        <h2 id="time-h" className="font-semibold">Study time, last 14 days</h2>
        <p className="mt-0.5 text-xs text-mute">{a.sessions14} counted sessions · times in {a.tz}</p>
        <ol className="mt-4 grid grid-cols-[repeat(14,minmax(0,1fr))] items-end gap-1.5" aria-label="Minutes studied per day">
          {a.days.map((d) => <li key={d.date} className="flex flex-col items-center gap-1"><span aria-hidden className="w-full rounded-sm bg-lime/80" style={{ height: `${Math.max(2, Math.round((d.seconds / max) * 96))}px`, opacity: d.seconds ? 1 : 0.25 }} />
            <span className="sr-only">{formatDate(d.date)}: {Math.round(d.seconds / 60)} minutes</span><span aria-hidden className="text-[10px] text-mute">{d.date.slice(8)}</span></li>)}
        </ol>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="m-h" className="card p-5"><h2 id="m-h" className="font-semibold">Mastery</h2>
          {mTotal === 0 ? <p className="mt-2 text-sm text-sub">Mastery appears once you have studied something.</p> : <ul className="mt-3 space-y-2">{ORDER.filter((m) => a.mastery[m]).map((m) => (
            <li key={m} className="flex items-center gap-3 text-sm"><span className="w-28 shrink-0 text-sub">{MASTERY_LABEL[m]}</span><span className="h-2 flex-1 overflow-hidden rounded-full bg-raised"><span className={`block h-full rounded-full ${m === "weak" || m === "needs_revision" ? "bg-violet" : "bg-lime"}`} style={{ width: `${Math.round((100 * a.mastery[m]) / mTotal)}%` }} /></span><span className="w-8 text-right tabular-nums">{a.mastery[m]}</span></li>))}</ul>}
        </section>
        <section aria-labelledby="r-h" className="card p-5"><h2 id="r-h" className="font-semibold">Revision, last 30 days</h2>
          {reviews === 0 ? <p className="mt-2 text-sm text-sub">No reviews yet. They start once an item is due.</p> : <dl className="mt-3 grid grid-cols-3 gap-2 text-center">{(["hard", "good", "easy"] as const).map((k) => <div key={k}><dd className="text-2xl font-semibold tabular-nums">{a.reviews30[k]}</dd><dt className="text-xs capitalize text-mute">{k}</dt></div>)}</dl>}
          <Link href="/revision" className="btn-ghost mt-4">Open revision</Link>
        </section>
      </div>
      <section aria-labelledby="acc-h"><h2 id="acc-h" className="mb-3 font-semibold">Accuracy by topic <span className="text-sm font-normal text-mute">(5+ attempts, weakest first)</span></h2>
        {a.topicAccuracy.length === 0 ? <p className="text-sm text-sub">Practise at least 5 questions in a topic to see its accuracy.</p> : <ul className="space-y-2">{a.topicAccuracy.map((t) => (
          <li key={t.href}><Link href={t.href} className="card flex min-h-[56px] items-center gap-3 px-4 py-3 hover:border-mute"><span className="min-w-0 flex-1 truncate">{t.title}</span><span className="text-xs text-mute">{t.attempts} attempts</span><span className={`w-12 text-right font-semibold tabular-nums ${t.accuracy < 50 ? "text-violet-fg" : "text-lime"}`}>{t.accuracy}%</span></Link></li>))}</ul>}
      </section>
    </div>);
}
