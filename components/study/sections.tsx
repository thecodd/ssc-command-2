// Server-safe presentational sections (no hooks, no server-only imports): they render on the server in production and in the client in the fixture preview.
import Link from "next/link";
import { ArrowDown, BookOpen, ExternalLink, Target } from "lucide-react";
import { Badge, relevanceTone } from "@/components/ui/Badge";
import { MAPPING_LABEL, PRIORITY_LABEL, RELEVANCE_LABEL } from "@/lib/format";
import { practiceHref, practiceVerb, studyHref } from "@/lib/study/routes";
import { SubtopicChecklist } from "./SubtopicChecklist";
import { OpenSheetButton } from "./NotesSheet";
import type { StudyContext, StudyLink } from "@/types/study";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const Heading = ({ id, children, hint }: { id: string; children: React.ReactNode; hint?: string }) => (
  <div className="mb-3"><h2 id={id} className="text-base font-semibold">{children}</h2>{hint && <p className="mt-0.5 text-sm text-sub">{hint}</p>}</div>
);
const Dot = ({ done, started }: { done: boolean; started: boolean }) => <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full border ${done ? "border-lime bg-lime" : started ? "border-violet bg-violet/40" : "border-mute"}`} />;
const lifeText = (l: StudyLink["lifecycle"]) => (l === "completed" ? "completed" : l === "learning" ? "in progress" : "not started");

export function WhyItMatters({ ctx }: { ctx: StudyContext }) {
  const e = ctx.entity, ssc = e.type !== "ncert_chapter", links = ssc ? ctx.foundation : ctx.sscTopics;
  const seen = new Set<string>();
  const reasons = links.filter((l) => l.mapping?.reason && !seen.has(l.mapping.reason) && seen.add(l.mapping.reason)).slice(0, 3);
  return (
    <section data-study-section tabIndex={-1} aria-labelledby="why-h" className="outline-none">
      <Heading id="why-h">Why this matters</Heading>
      <div className="flex flex-wrap gap-1.5">
        {e.relevance && <Badge tone={relevanceTone(e.relevance)}>{RELEVANCE_LABEL[e.relevance] ?? e.relevance} relevance</Badge>}
        {e.priority && <Badge>{PRIORITY_LABEL[e.priority] ?? e.priority} priority</Badge>}
        {e.estimatedMinutes ? <Badge>~{e.estimatedMinutes} min</Badge> : null}
      </div>
      <p className="mt-3 text-base leading-relaxed">
        {ssc
          ? <>Part of <span className="text-ink">{e.context || "the SSC syllabus"}</span>{e.subject ? <> under <span className="text-ink">{e.subject}</span></> : null}. {links.length ? `It builds on ${plural(links.length, "NCERT chapter")}.` : "No NCERT chapter is mapped to it yet."}</>
          : <>{links.length ? <>It supports {plural(links.length, "SSC topic")}, mostly in <span className="text-ink">{Array.from(new Set(links.map((l) => l.context.split(" · ").pop()))).slice(0, 2).join(" and ")}</span>.</> : "It isn't mapped to the SSC syllabus yet, so treat it as general background."}</>}
      </p>
      {reasons.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm text-sub">
          {reasons.map((l) => <li key={l.id} className="border-l-2 border-line pl-3"><span className="text-ink">{l.title}</span> <span className="text-mute">· {MAPPING_LABEL[l.mapping!.kind] ?? l.mapping!.kind}</span><br />{l.mapping!.reason}</li>)}
        </ul>
      )}
    </section>
  );
}

export function WhatToLearn({ ctx }: { ctx: StudyContext }) {
  const e = ctx.entity;
  const unfinished = ctx.foundation.filter((l) => l.lifecycle !== "completed").slice(0, 3);
  return (
    <section data-study-section tabIndex={-1} aria-labelledby="learn-h" className="outline-none">
      <Heading id="learn-h" hint={e.type === "ssc_subtopic" ? `Part of ${e.parentTopic?.title ?? "its topic"}` : undefined}>What to learn</Heading>
      {unfinished.length > 0 && (
        <p className="mb-4 rounded-ctl border border-violet/40 bg-violet/10 p-3 text-sm">
          <span className="text-violet-fg">Before you start:</span> {unfinished.map((l, i) => <span key={l.id}>{i > 0 && ", "}<Link data-inline href={studyHref("ncert_chapter", l.id)} className="underline">{l.title}</Link></span>)} {unfinished.length === 1 ? "isn't" : "aren't"} done yet.
        </p>
      )}
      {e.type === "ncert_chapter" && (ctx.concepts.length ? <ol className="space-y-2 text-base">{ctx.concepts.map((c, i) => <li key={i} className="flex gap-3"><span className="w-5 shrink-0 text-right tabular-nums text-mute">{i + 1}</span><span>{c}</span></li>)}</ol> : <p className="text-sm text-sub">No concepts are listed for this chapter yet. Study it as a whole and track it in your progress.</p>)}
      {e.type !== "ncert_chapter" && (ctx.subtopics.length
        ? <SubtopicChecklist items={ctx.subtopics} />
        : <p className="text-sm text-sub">No subtopics are listed. Study the topic as a whole and track it in your progress.</p>)}
    </section>
  );
}

export function StudyMaterial({ ctx }: { ctx: StudyContext }) {
  const { entity: e, materials } = ctx;
  return (
    <section data-study-section tabIndex={-1} aria-labelledby="material-h" className="outline-none">
      <Heading id="material-h">Study material</Heading>
      {!e.sourceUrl && materials.length === 0 ? (
        <div className="rounded-card border border-dashed border-line p-5 text-sm text-sub">
          <p>Nothing is attached to this yet. Add a link you trust, or write your own notes as you study.</p>
          <div className="mt-3 flex flex-wrap gap-2"><OpenSheetButton tab="resources">Add a resource</OpenSheetButton><OpenSheetButton tab="notes">Write a note</OpenSheetButton></div>
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line">
          {e.sourceUrl && <li><a href={e.sourceUrl} target="_blank" rel="noreferrer noopener" className="flex min-h-[56px] items-center gap-3 px-4 hover:text-lime"><BookOpen className="h-4 w-4 shrink-0 text-lime" aria-hidden /><span className="min-w-0 flex-1"><span className="block truncate">Read the source chapter</span><span className="text-xs text-mute">Official source</span></span><ExternalLink className="h-4 w-4 text-mute" aria-hidden /></a></li>}
          {materials.map((m) => <li key={m.id}>{m.url ? <a href={m.url} target="_blank" rel="noreferrer noopener" className="flex min-h-[56px] items-center gap-3 px-4 hover:text-lime"><span className="min-w-0 flex-1"><span className="block truncate">{m.title}</span><span className="text-xs text-mute">{m.official ? "Official · " : "Yours · "}{m.type}</span></span><ExternalLink className="h-4 w-4 text-mute" aria-hidden /></a> : <p className="px-4 py-4">{m.title}</p>}</li>)}
        </ul>
      )}
    </section>
  );
}

function LinkRow({ l, here }: { l: StudyLink; here?: boolean }) {
  return (
    <li>
      <Link href={studyHref(l.type, l.id)} className="flex min-h-[56px] items-center gap-3 rounded-ctl border border-line bg-surface px-3 py-2 hover:border-mute" aria-label={`Study ${l.title} (${lifeText(l.lifecycle)})`}>
        <Dot done={l.lifecycle === "completed"} started={l.lifecycle === "learning"} />
        <span className="min-w-0 flex-1"><span className="block truncate text-sm">{l.title}</span><span className="block truncate text-xs text-mute">{l.context}</span></span>
        {l.mapping && <Badge tone={relevanceTone(l.mapping.relevance)}>{MAPPING_LABEL[l.mapping.kind] ?? l.mapping.kind}</Badge>}
        {here && <Badge tone="lime">You are here</Badge>}
      </Link>
    </li>
  );
}
const Stage = ({ label, last, children }: { label: string; last?: boolean; children: React.ReactNode }) => (
  <li className="relative pl-7">
    <span aria-hidden className="absolute left-0 top-1.5 grid h-4 w-4 place-items-center rounded-full border border-lime/60 bg-bg"><span className="h-1.5 w-1.5 rounded-full bg-lime" /></span>
    {!last && <span aria-hidden className="absolute left-[7.5px] top-6 bottom-[-18px] w-px bg-line" />}
    <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-mute">{label}</p>
    <div className="pb-6">{children}</div>
  </li>
);

/** NCERT foundation -> SSC topic -> subtopics -> PYQs, from whichever end you are standing on. Every node is a real row; nothing is drawn that isn't mapped. */
export function ConnectionMap({ ctx }: { ctx: StudyContext }) {
  const e = ctx.entity, fromNcert = e.type === "ncert_chapter";
  const none = fromNcert ? ctx.sscTopics.length === 0 : ctx.foundation.length === 0;
  const topicHere = e.type === "ssc_topic" ? e : null;
  return (
    <section data-study-section tabIndex={-1} aria-labelledby="map-h" className="outline-none">
      <Heading id="map-h" hint="How the NCERT foundation connects to the SSC syllabus.">Connection map</Heading>
      <ol aria-label="From NCERT to SSC">
        <Stage label="NCERT foundation">
          {fromNcert
            ? <ul><li className="rounded-ctl border border-lime/40 bg-lime-dim px-3 py-3"><p className="text-sm font-medium">{e.title}</p><p className="text-xs text-sub">{e.subject}{e.context ? ` · ${e.context}` : ""}</p><span className="mt-1 inline-block text-[11px] text-lime">You are here</span></li></ul>
            : ctx.foundation.length ? <ul className="space-y-2">{ctx.foundation.map((l) => <LinkRow key={l.id} l={l} />)}</ul> : <p className="text-sm text-sub">No NCERT chapter is mapped to this. Some SSC topics don&apos;t rely on NCERT at all.</p>}
        </Stage>
        <Stage label={`SSC${e.context ? " · " + e.context.split(" · ")[0] : ""}`}>
          {fromNcert
            ? (ctx.sscTopics.length ? <ul className="space-y-2">{ctx.sscTopics.map((l) => <LinkRow key={l.id} l={l} />)}</ul> : <p className="text-sm text-sub">This chapter isn&apos;t mapped to an SSC topic yet.</p>)
            : <div className={`rounded-ctl border px-3 py-3 ${topicHere ? "border-lime/40 bg-lime-dim" : "border-line bg-surface"}`}>
                <p className="text-xs text-sub">{e.subject}</p>
                <p className="text-sm font-medium">{e.parentTopic ? e.parentTopic.title : e.title}</p>
                {topicHere && <span className="mt-1 inline-block text-[11px] text-lime">You are here</span>}
              </div>}
        </Stage>
        <Stage label="Subtopics">
          {fromNcert
            ? (ctx.sscTopics.some((t) => t.subtopics?.length)
              ? <ul className="space-y-3">{ctx.sscTopics.filter((t) => t.subtopics?.length).map((t) => <li key={t.id}><p className="mb-1 text-xs text-mute">{t.title}</p><div className="flex flex-wrap gap-1.5">{t.subtopics!.slice(0, 6).map((s) => <Link key={s.id} href={studyHref("ssc_subtopic", s.id)} className="chip min-h-[44px] text-sm text-ink hover:border-mute">{s.title}</Link>)}{t.subtopics!.length > 6 && <span className="chip">+{t.subtopics!.length - 6} more</span>}</div></li>)}</ul>
              : <p className="text-sm text-sub">No subtopics are listed for the mapped topics.</p>)
            : (ctx.subtopics.length ? <div className="flex flex-wrap gap-1.5">{ctx.subtopics.map((s) => <Link key={s.id} href={studyHref("ssc_subtopic", s.id)} aria-current={s.current ? "true" : undefined} className={`chip min-h-[44px] text-sm hover:border-mute ${s.current ? "chip-on" : "text-ink"}`}>{s.lifecycle === "completed" ? "✓ " : ""}{s.title}</Link>)}</div> : <p className="text-sm text-sub">This topic has no subtopics.</p>)}
        </Stage>
        <Stage label="PYQs" last>
          {ctx.pyq.total > 0
            ? <p className="text-sm"><ArrowDown className="mr-1 inline h-4 w-4 text-lime" aria-hidden />{ctx.pyq.scope === "mapped_topics" ? `${plural(ctx.pyq.rows.length, "mapped topic")} ${ctx.pyq.rows.length === 1 ? "has" : "have"} previous-year questions` : `${plural(ctx.pyq.total, "previous-year question")} linked`}.</p>
            : <p className="text-sm text-sub">No mapped PYQs yet.</p>}
        </Stage>
      </ol>
      {none && <p className="mt-2 text-xs text-mute">An empty link here means nothing is mapped, not that something failed to load.</p>}
    </section>
  );
}

export function PyqCard({ ctx }: { ctx: StudyContext }) {
  const p = ctx.pyq;
  return (
    <section data-study-section tabIndex={-1} aria-labelledby="pyq-h" className="card space-y-3 p-5 outline-none">
      <h2 id="pyq-h" className="flex items-center gap-2 text-sm text-sub"><Target className="h-4 w-4" aria-hidden />Previous-year questions</h2>
      {p.total === 0 ? (
        <><p className="font-medium">No mapped PYQs yet</p><p className="text-sm text-sub">When questions are tagged to {ctx.entity.type === "ncert_chapter" ? "the SSC topics this chapter supports" : "this topic"}, they appear here with your accuracy.</p></>
      ) : p.scope === "mapped_topics" ? (
        <ul className="divide-y divide-line">
          {p.rows.map((r) => <li key={r.topicId}><Link href={practiceHref("ssc_topic", r.topicId)} className="flex min-h-[52px] items-center justify-between gap-3 hover:text-lime"><span className="min-w-0"><span className="block truncate text-sm">{r.title}</span><span className="text-xs text-mute">{plural(r.total, "PYQ")} · {r.attempted ? `${plural(r.attempted, "attempt")}, ${Math.round((100 * r.correct) / r.attempted)}% correct` : "not attempted"}</span></span><span className="text-sm text-lime">{practiceVerb}</span></Link></li>)}
        </ul>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div><dd className="text-xl font-semibold tabular-nums">{p.total}</dd><dt className="text-xs text-mute">PYQs</dt></div>
            <div><dd className="text-xl font-semibold tabular-nums">{p.attempted}</dd><dt className="text-xs text-mute">Attempts</dt></div>
            <div><dd className="text-xl font-semibold tabular-nums">{p.accuracyPct === null ? "—" : `${p.accuracyPct}%`}</dd><dt className="text-xs text-mute">Accuracy</dt></div>
          </dl>
          {p.practiceScope && <Link href={practiceHref(p.practiceScope.scope, p.practiceScope.id)} className="btn-primary w-full">{practiceVerb} PYQs</Link>}
        </>
      )}
    </section>
  );
}
