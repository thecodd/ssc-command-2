import Link from "next/link";
import { ArrowRight, Layers, Timer } from "lucide-react";
import { getStudyHub } from "@/services/studyHub";
import { FOCUS_LABEL, MASTERY_LABEL } from "@/lib/learning/rules";
import { studyHref } from "@/lib/study/routes";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";
export default async function StudyHub() {
  const h = await getStudyHub();
  return (
    <div className="space-y-8">
      <header><h1 className="text-3xl font-bold tracking-tight">Study</h1><p className="mt-1 text-sm text-sub">Pick up where you left off, or take what&apos;s most useful next.</p></header>
      {h.open && (
        <section aria-labelledby="resume-h" className="rounded-card border border-lime/30 bg-lime-dim p-5">
          <h2 id="resume-h" className="text-xs font-medium uppercase tracking-widest text-sub">{h.open.state === "active" ? "Session running" : "Session paused"}</h2>
          <p className="mt-1 text-xl font-semibold">{h.open.title}</p>
          <Link href={studyHref(h.open.type, h.open.id)} className="btn-primary mt-4"><Timer className="h-4 w-4" aria-hidden />Resume</Link>
        </section>
      )}
      {h.empty ? (
        <EmptyState icon={Layers} title="Nothing to study yet" hint="Start with a topic from the Master Syllabus. Once you've studied something, your focus and weak spots appear here." action={{ href: "/syllabus", label: "Open the syllabus" }} />
      ) : (
        <>
          {h.focus.length > 0 && (
            <section aria-labelledby="focus-h"><h2 id="focus-h" className="mb-3 font-semibold">Today&apos;s focus</h2>
              <ul className="space-y-2">{h.focus.map((f) => (
                <li key={f.entity_type + f.entity_id}><Link href={studyHref(f.entity_type, f.entity_id)} className="card flex min-h-[64px] items-center justify-between gap-3 px-4 py-3 hover:border-mute">
                  <span className="min-w-0"><span className="block truncate font-medium">{f.title}</span><span className="block truncate text-xs text-mute">{FOCUS_LABEL[f.kind]} · {f.reason}</span></span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-lime" aria-hidden /></Link></li>))}</ul></section>
          )}
          {h.weak.length > 0 && (
            <section aria-labelledby="weak-h"><h2 id="weak-h" className="mb-3 font-semibold">Weak spots</h2>
              <ul className="space-y-2">{h.weak.map((w) => (
                <li key={w.entity_type + w.entity_id}><Link href={studyHref(w.entity_type, w.entity_id)} className="card flex min-h-[64px] items-center justify-between gap-3 px-4 py-3 hover:border-mute">
                  <span className="min-w-0"><span className="block truncate font-medium">{w.title}</span><span className="block truncate text-xs text-mute">{MASTERY_LABEL[w.mastery]}{w.pyq_attempts >= 5 && w.pyq_recent_accuracy !== null ? ` · ${Math.round(w.pyq_recent_accuracy)}% recent accuracy` : ""}</span></span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-lime" aria-hidden /></Link></li>))}</ul></section>
          )}
        </>
      )}
    </div>
  );
}
