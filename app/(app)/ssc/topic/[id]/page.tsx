import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Target, StickyNote, Link2, ArrowRight, Layers } from "lucide-react";
import { getTopicDetail } from "@/services/ssc";
import { nextAction } from "@/lib/learning/rules";
import { ProgressPanel } from "@/components/progress/ProgressPanel";
import { ContextActions } from "@/components/curriculum/ContextActions";
import { ConnectionCard } from "@/components/curriculum/ConnectionCard";
import { SubtopicList } from "@/components/curriculum/SubtopicList";
import { NotesPanel, ResourcesPanel } from "@/components/curriculum/NotesPanel";
import { StatStrip } from "@/components/ui/StatStrip";
import { Tabs } from "@/components/ui/Tabs";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PRIORITY_LABEL } from "@/lib/format";
import { formatDate as fmt } from "@/lib/time";
import { isUuid } from "@/lib/filters";
import { studyHref } from "@/lib/study/routes";
import { RevisionPanel } from "@/components/revision/RevisionPanel";
import { practiceNewHref } from "@/lib/practice/routes";

const TABS = [["plan", "Study plan"], ["ncert", "NCERT foundation"], ["pyqs", "PYQs"], ["notes", "Notes"], ["resources", "Resources"]].map(([id, label]) => ({ id, label }));

export default async function TopicPage({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string } }) {
  if (!isUuid(params.id)) notFound();
  const t = await getTopicDetail(params.id);
  if (!t) notFound();
  const tab = TABS.some((x) => x.id === searchParams.tab) ? searchParams.tab! : "plan";
  const path = `/ssc/topic/${t.id}`;
  const next = nextAction({ mastery: t.mastery, pyqCount: t.pyqCount, attempts: t.attempts, accuracy: t.accuracy, foundationGap: t.foundationGap, hasPendingRevision: t.hasRevision, completion: t.progress.completion });

  return (
    <div>
      <Link href={t.subjectId ? `/ssc/subject/${t.subjectId}` : "/ssc"} className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-sub"><ArrowLeft className="h-4 w-4" />{t.subject}</Link>
      <p className="text-sm text-sub">{t.exam} · {t.tier}</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">{t.title}</h1>
      <div className="mt-3 flex flex-wrap gap-1.5"><Badge>SSC</Badge><Badge>{PRIORITY_LABEL[t.priority] ?? t.priority} priority</Badge>{t.custom && <Badge tone="violet">Custom</Badge>}{t.estimated_minutes ? <Badge>{t.estimated_minutes} min</Badge> : null}</div>

      <div className="mt-5 rounded-card border border-lime/30 bg-lime-dim p-4">
        <p className="text-sm text-lime">Next up</p><p className="mt-1 text-lg font-semibold">{next.title}</p><p className="mt-1 text-sm text-sub">{next.hint}</p>
        {next.tab && <Link href={`${path}?tab=${next.tab}`} scroll={false} className="mt-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-lime">Go there <ArrowRight className="h-4 w-4" /></Link>}
      </div>
      <div className="mt-5"><Link href={studyHref("ssc_topic", t.id)} className="btn-primary w-full sm:w-auto">Open Study Mode<ArrowRight className="h-4 w-4" /></Link></div>
      <div className="mt-4"><RevisionPanel type="ssc_topic" id={t.id} /></div>
      <div className="mt-3"><ContextActions focus={{ type: "ssc_topic", id: t.id, title: t.title }} links={[
        ...(t.pyqCount > 0 ? [{ href: practiceNewHref("ssc_topic", t.id), label: "Practice PYQs", icon: <Target className="h-4 w-4" /> }] : []),
        { href: `${path}?tab=pyqs`, label: "View PYQs", icon: <Target className="h-4 w-4" /> },
        { href: `${path}?tab=notes`, label: "Add note", icon: <StickyNote className="h-4 w-4" /> },
        { href: t.mappings[0] ? `/mapping/${t.mappings[0].id}` : `${path}?tab=ncert`, label: "View mapping", icon: <Link2 className="h-4 w-4" /> },
      ]} /></div>
      <div className="mt-5"><StatStrip items={[
        { label: "PYQs linked", value: String(t.pyqCount) },
        { label: "PYQ accuracy", value: t.accuracy === null ? "—" : `${t.accuracy}%`, tone: t.accuracy !== null && t.attempts >= 5 && t.accuracy < 50 ? "red" : undefined },
        { label: "Notes · resources", value: `${t.notes.length} · ${t.resources.length}` },
        { label: "Next revision", value: t.nextRevision ? (t.revisionDue ? "Due" : fmt(t.nextRevision)) : "—", tone: t.revisionDue ? "red" : undefined },
      ]} /></div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <ProgressPanel type="ssc_topic" id={t.id} path={path} progress={t.progress} mastery={t.mastery} />
        <div className="min-w-0">
          <Tabs tabs={TABS} active={tab} base={path} />
          {tab === "plan" && (
            <div className="space-y-6">
              <section><h2 className="mb-1 font-semibold">What to study</h2>
                {t.subtopics.length ? <SubtopicList items={t.subtopics} path={path} /> : <p className="text-sm text-sub">No subtopics are listed. Study the topic as a whole and track it with the progress panel.</p>}</section>
              {t.mappings.length > 0 && <section><h2 className="mb-3 font-semibold">Why it&apos;s relevant</h2><p className="text-sm text-sub">{t.mappings.find((m) => m.reason)?.reason ?? "This topic is supported by the NCERT chapters in the next tab."}</p></section>}
              {t.related.length > 0 && <section><h2 className="mb-3 font-semibold">Related topics</h2><div className="flex flex-wrap gap-2">{t.related.map((r) => <Link key={r.id} href={`/ssc/topic/${r.id}`} className="chip min-h-[36px] text-sm text-ink hover:border-mute">{r.title}</Link>)}</div></section>}
            </div>
          )}
          {tab === "ncert" && (t.mappings.length ? <div className="space-y-3">{t.mappings.map((m) => <ConnectionCard key={m.id} m={m} side="ncert" />)}</div> : <EmptyState icon={Layers} title="No NCERT foundation mapped" hint="No chapter is linked to this topic yet. Some SSC topics don't rely on NCERT at all." action={{ href: "/mapping", label: "Open mapping" }} />)}
          {tab === "pyqs" && (t.pyqs.length ? <ul className="divide-y divide-line">{t.pyqs.map((p: any) => <li key={p.id} className="py-3 text-sm"><p className="text-xs text-mute">{[p.exam, p.year].filter(Boolean).join(" ")}</p><p className="mt-1">{p.question}</p></li>)}</ul> : <EmptyState icon={Target} title="No PYQs linked yet" hint="Once PYQs are tagged to this topic they appear here with your accuracy." />)}
          {tab === "notes" && <NotesPanel type="ssc_topic" id={t.id} path={path} notes={t.notes} />}
          {tab === "resources" && <ResourcesPanel type="ssc_topic" id={t.id} path={path} resources={t.resources} />}
        </div>
      </div>
    </div>
  );
}
