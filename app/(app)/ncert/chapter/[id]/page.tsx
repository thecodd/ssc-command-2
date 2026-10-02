import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Layers, Target, StickyNote, Link2 } from "lucide-react";
import { getChapterDetail } from "@/services/ncert";
import { studyHref } from "@/lib/study/routes";
import { RevisionPanel } from "@/components/revision/RevisionPanel";
import { ProgressPanel } from "@/components/progress/ProgressPanel";
import { ConnectionCard } from "@/components/curriculum/ConnectionCard";
import { Tabs } from "@/components/ui/Tabs";
import { Badge, relevanceTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { NotesPanel, ResourcesPanel } from "@/components/curriculum/NotesPanel";
import { ContextActions } from "@/components/curriculum/ContextActions";
import { PRIORITY_LABEL, RELEVANCE_LABEL } from "@/lib/format";
import { formatDate as fmtDate } from "@/lib/time";
import { isUuid } from "@/lib/filters";

const TABS = [["overview", "Overview"], ["ssc", "SSC Connection"], ["concepts", "Concepts"], ["notes", "Notes"], ["pyqs", "PYQs"], ["resources", "Resources"], ["revision", "Revision"]].map(([id, label]) => ({ id, label }));

export default async function ChapterPage({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string } }) {
  if (!isUuid(params.id)) notFound();
  const c = await getChapterDetail(params.id);
  if (!c) notFound();
  const tab = TABS.some((t) => t.id === searchParams.tab) ? searchParams.tab! : "overview";
  const path = `/ncert/chapter/${c.id}`;
  const today = c.today;

  return (
    <div>
      <Link href={`/ncert/${c.grade}`} className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-sub"><ArrowLeft className="h-4 w-4" />Class {c.grade}</Link>
      <p className="text-sm text-sub">Class {c.grade} · {c.subject}</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">{c.title}</h1>
      <div className="mt-3 flex flex-wrap gap-1.5"><Badge>NCERT</Badge><Badge tone={relevanceTone(c.relevance)}>{RELEVANCE_LABEL[c.relevance]} relevance</Badge><Badge>{PRIORITY_LABEL[c.priority]} priority</Badge></div>

      <div className="mt-5"><Link href={studyHref("ncert_chapter", c.id)} className="btn-primary w-full sm:w-auto">Open Study Mode</Link></div>
      <div className="mt-3"><ContextActions focus={{ type: "ncert_chapter", id: c.id, title: c.title }} links={[
        { href: `${path}?tab=notes`, label: "Add note", icon: <StickyNote className="h-4 w-4" /> },
        { href: `${path}?tab=pyqs`, label: "View PYQs", icon: <Target className="h-4 w-4" /> },
        ...(c.mappings[0] ? [{ href: `/mapping/${c.mappings[0].id}`, label: "View mapping", icon: <Link2 className="h-4 w-4" /> }] : []),
      ]} /></div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <ProgressPanel type="ncert_chapter" id={c.id} path={path} progress={c.progress} mastery={c.mastery} />
        <div className="min-w-0">
          <Tabs tabs={TABS} active={tab} base={path} />

          {tab === "overview" && (
            <div className="space-y-4">
              <dl className="card grid grid-cols-2 gap-4 p-5 text-sm">
                <div><dt className="text-mute">Book</dt><dd>{c.book.title || "—"}</dd></div>
                <div><dt className="text-mute">Edition</dt><dd>{c.book.edition ?? "—"}</dd></div>
                <div><dt className="text-mute">Academic year</dt><dd>{c.book.academic_year ?? "—"}</dd></div>
                <div><dt className="text-mute">Estimated time</dt><dd>{c.estimated_minutes ? `${c.estimated_minutes} min` : "—"}</dd></div>
                {c.source_url && <div className="col-span-2"><dt className="text-mute">Source</dt><dd><a href={c.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-lime">Open source <ExternalLink className="h-3 w-3" /></a></dd></div>}
              </dl>
              <h2 className="pt-2 font-semibold">Why this matters for SSC</h2>
              {c.mappings.length ? c.mappings.slice(0, 3).map((m) => <ConnectionCard key={m.id} m={m} />) : <p className="text-sm text-sub">This chapter isn&apos;t mapped to an SSC topic yet. It may still be useful as background.</p>}
            </div>
          )}
          {tab === "ssc" && (c.mappings.length ? <div className="space-y-3">{c.mappings.map((m) => <ConnectionCard key={m.id} m={m} />)}</div> : <EmptyState icon={Layers} title="Not mapped yet" hint="No SSC topic is linked to this chapter." action={{ href: "/mapping", label: "Open mapping" }} />)}
          {tab === "concepts" && (c.concepts.length ? <ul className="flex flex-wrap gap-2">{c.concepts.map((k: any) => <li key={k.id} className="chip text-sm text-ink">{k.title}</li>)}</ul> : <EmptyState icon={Layers} title="No concepts listed" hint="Concepts appear here once they're imported for this chapter." />)}
          {tab === "notes" && <NotesPanel type="ncert_chapter" id={c.id} path={path} notes={c.notes} />}
          {tab === "pyqs" && (c.pyqs.length ? <ul className="space-y-2">{c.pyqs.map((p: any) => <li key={p.id} className="card p-4 text-sm"><p className="text-mute">{[p.exam, p.year].filter(Boolean).join(" ")}</p><p className="mt-1">{p.question}</p></li>)}</ul> : <EmptyState icon={Layers} title="No PYQs linked" hint="PYQs show up here when they're tagged to this chapter's SSC topics." />)}
          {tab === "resources" && <ResourcesPanel type="ncert_chapter" id={c.id} path={path} resources={c.resources} />}
          {tab === "revision" && <RevisionPanel type="ncert_chapter" id={c.id} />}
        </div>
      </div>
    </div>
  );
}
