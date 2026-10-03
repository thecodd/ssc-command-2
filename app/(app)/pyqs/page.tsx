import Link from "next/link";
import { Shuffle, Target, TrendingDown } from "lucide-react";
import { getPyqBank } from "@/services/pyqBank";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { MASTERY_LABEL, type Mastery } from "@/lib/learning/rules";
export const dynamic = "force-dynamic";
export default async function Pyqs() {
  const { topics, total } = await getPyqBank();
  const subjects = Array.from(new Set(topics.map((t) => t.subject)));
  return (
    <div>
      <PageHeader title="PYQs" subtitle={total ? `${total} previous-year questions ready to practise, graded on the server.` : "Previous-year questions, graded on the server."} />
      {!topics.length ? <EmptyState icon={Target} title="No questions yet" hint="Questions appear here once PYQs are imported and tagged to SSC topics." action={{ href: "/syllabus", label: "Open the syllabus" }} /> : (<>
        <div className="mb-8 grid gap-3 sm:grid-cols-2">
          <Link href="/practice/new?scope=mixed" className="card flex min-h-[72px] items-center gap-3 p-4 hover:border-mute"><Shuffle className="h-5 w-5 text-lime" aria-hidden /><span><span className="block font-medium">Mixed practice</span><span className="text-sm text-sub">Across everything you have studied</span></span></Link>
          <Link href="/practice/new?scope=weak" className="card flex min-h-[72px] items-center gap-3 p-4 hover:border-mute"><TrendingDown className="h-5 w-5 text-violet-fg" aria-hidden /><span><span className="block font-medium">Weak areas</span><span className="text-sm text-sub">Topics where your accuracy is low</span></span></Link>
        </div>
        <div className="space-y-8">{subjects.map((s) => (
          <section key={s} aria-label={s}><h2 className="mb-3 font-semibold">{s}</h2>
            <ul className="space-y-2">{topics.filter((t) => t.subject === s).map((t) => (
              <li key={t.id} className="card flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1"><p className="break-words font-medium">{t.title}</p>
                  <p className="mt-0.5 text-xs text-mute">{t.count} {t.count === 1 ? "question" : "questions"} · {t.attempts ? `${t.attempts} attempted${t.accuracy !== null ? ` · ${t.accuracy}% recent accuracy` : ""}` : "not attempted yet"}</p></div>
                {t.mastery && t.mastery !== "not_started" && <Badge tone={t.mastery === "weak" ? "violet" : "mute"}>{MASTERY_LABEL[t.mastery as Mastery]}</Badge>}
                <Link href={`/practice/new?scope=ssc_topic&id=${t.id}`} className="btn-ghost">Practise</Link>
              </li>))}</ul>
          </section>))}</div>
      </>)}
    </div>);
}
