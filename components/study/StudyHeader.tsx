"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SessionClock } from "./SessionClock";
import { SessionControls } from "./SessionControls";
import { useStudy } from "./StudyProvider";
import { Badge } from "@/components/ui/Badge";
import { MASTERY_LABEL, MASTERY_TONE, type Mastery } from "@/lib/learning/rules";
import type { StudyCrumb } from "@/types/study";

/** Sticky, compact header: exit + context on the left, the timer always visible. Controls live here on desktop and in the bottom bar on phones. */
export function StudyHeader({ title, crumbs, mastery, kicker }: { title: string; crumbs: StudyCrumb[]; mastery: Mastery; kicker: string }) {
  const { requestExit } = useStudy();
  const tone = MASTERY_TONE[mastery];
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 lg:px-8">
        <button type="button" onClick={requestExit} aria-keyshortcuts="Escape" className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-ctl px-2 text-sm text-sub hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden />Exit</button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] uppercase tracking-widest text-mute">{kicker}</p>
          <p className="truncate text-sm font-medium">{title}</p>
        </div>
        <span className="hidden sm:inline-flex"><Badge tone={tone === "red" ? "mute" : tone}><span className={tone === "red" ? "text-red-400" : ""}>{MASTERY_LABEL[mastery]}</span></Badge></span>
        <div className="hidden shrink-0 lg:block"><SessionClock /></div>   {/* phones/tablets show the clock in the sticky bar, so the header stays Exit + title at 360px */}
        <div className="hidden lg:block"><SessionControls compact /></div>
      </div>
      {crumbs.length > 0 && (
        <nav aria-label="Where this is in the syllabus" className="mx-auto hidden max-w-6xl px-4 pb-2 text-xs text-mute lg:block lg:px-8">
          <ol className="flex flex-wrap items-center gap-1.5">{crumbs.map((c, i) => <li key={i} className="flex items-center gap-1.5">{i > 0 && <span aria-hidden>/</span>}{c.href ? <Link data-inline href={c.href} className="hover:text-ink">{c.label}</Link> : <span>{c.label}</span>}</li>)}</ol>
        </nav>
      )}
    </header>
  );
}
