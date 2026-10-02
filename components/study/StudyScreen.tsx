// Composition only (server-safe). Everything shown is read from `ctx`, which comes from services/studyContext.ts (real rows + Phase 4 RPCs) in production
// or from tests/fixtures in the dev preview. Client islands share ONE session state through <StudyProvider>.
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { explainMastery, MASTERY_LABEL } from "@/lib/learning/rules";
import { revisionLabel } from "@/lib/study/labels";
import { practiceHref, studyHref } from "@/lib/study/routes";
import type { StudyContext } from "@/types/study";
import { StudyProvider } from "./StudyProvider";
import { StudyShortcuts } from "./StudyShortcuts";
import { StudyHeader } from "./StudyHeader";
import { StudyFocusCard } from "./StudyFocusCard";
import { ProgressCard } from "./ProgressCard";
import { RevisionCard } from "./RevisionCard";
import { StickyBar } from "./StickyBar";
import { ExitDialog } from "./ExitDialog";
import { NotesSheet, OpenSheetButton } from "./NotesSheet";
import { AddToFocus } from "./FocusAction";
import { FixtureBanner } from "./FixtureBanner";
import { ConnectionMap, PyqCard, StudyMaterial, WhatToLearn, WhyItMatters } from "./sections";

export function StudyScreen({ ctx }: { ctx: StudyContext }) {
  const e = ctx.entity;
  const path = studyHref(e.type, e.id);
  const open = ctx.openSession;
  const openHere = !!open && open.type === e.type && open.entityId === e.id;
  const other = open && !openHere ? open : null;
  const unfinished = ctx.foundation.filter((l) => l.lifecycle !== "completed");
  const why = explainMastery(ctx.signals ? { ...ctx.signals, completion: ctx.completion } : null);
  const rLabel = revisionLabel(ctx.revision);
  const started = ctx.mastery !== "not_started";
  const subDone = e.type === "ssc_topic" && ctx.subtopics.length ? { done: ctx.subtopics.filter((s) => s.lifecycle === "completed").length, total: ctx.subtopics.length } : null;
  const kicker = `${e.type === "ncert_chapter" ? "NCERT" : "SSC"} · ${e.subject || "Study"}`;

  return (
    <StudyProvider type={e.type} id={e.id} backHref={e.detailHref} openHere={openHere} other={other}>
      <StudyShortcuts />
      <StudyHeader title={e.title} crumbs={e.breadcrumbs} mastery={ctx.mastery} kicker={kicker} />
      <FixtureBanner />
      <div className="mx-auto max-w-6xl px-4 pb-36 pt-5 lg:px-8 lg:pb-16">
        <div className="mb-6">
          <p className="text-sm text-sub">{e.type === "ncert_chapter" ? `${e.subject}${e.number ? ` · Chapter ${e.number}` : ""}` : e.context}</p>
          <h1 className="mt-1 break-words text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">{e.title}</h1>
        </div>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-8">
            <StudyFocusCard mastery={ctx.mastery} completion={ctx.completion} confidence={ctx.progress.confidence} revision={ctx.revision} revisionLabel={rLabel} canSchedule={started}
              entityTitle={e.title} pyq={{ total: ctx.pyq.total, attempted: ctx.pyq.attempted, accuracyPct: ctx.pyq.accuracyPct }} practiceHref={ctx.pyq.practiceScope ? practiceHref(ctx.pyq.practiceScope.scope, ctx.pyq.practiceScope.id) : null}
              foundation={{ unfinished: unfinished.length, href: unfinished[0] ? studyHref("ncert_chapter", unfinished[0].id) : null }}
              upNext={ctx.upNext ? { title: ctx.upNext.title, href: studyHref(ctx.upNext.entity_type, ctx.upNext.entity_id) } : null} />
            <WhyItMatters ctx={ctx} />
            <WhatToLearn ctx={ctx} />
            <StudyMaterial ctx={ctx} />
            <ConnectionMap ctx={ctx} />
          </div>
          <aside aria-label="Your progress and actions" className="space-y-4 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto">
            <ProgressCard completion={ctx.completion} confidence={ctx.progress.confidence} status={ctx.progress.status} mastery={ctx.mastery} why={why} secondsSpent={ctx.progress.seconds_spent}
              sessions={ctx.progress.sessions} revisions={ctx.progress.revision_count} subtopicProgress={subDone} />
            <RevisionCard revision={ctx.revision} label={rLabel} canSchedule={started} ladder={ctx.ladder} history={ctx.revisionHistory} />
            <PyqCard ctx={ctx} />
            <section aria-label="More actions" className="card space-y-2 p-4">
              <div className="grid grid-cols-2 gap-2">
                <OpenSheetButton tab="notes">Notes ({ctx.notes.length})</OpenSheetButton>
                <OpenSheetButton tab="resources">Resources</OpenSheetButton>
              </div>
              <AddToFocus title={e.title} />
              <Link href={e.detailHref} className="btn-ghost w-full">Open full page<ExternalLink className="h-4 w-4" aria-hidden /></Link>
            </section>
            <p className="hidden text-xs text-mute lg:block">Keys: <kbd>Space</kbd> pause or resume · <kbd>N</kbd> next section · <kbd>Esc</kbd> exit</p>
          </aside>
        </div>
      </div>
      <StickyBar completion={ctx.completion} mastery={MASTERY_LABEL[ctx.mastery]} />
      <NotesSheet notes={ctx.notes} materials={ctx.materials} path={path} />
      <ExitDialog />
    </StudyProvider>
  );
}
