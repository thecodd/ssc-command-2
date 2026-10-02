"use client";
import { SessionControls } from "./SessionControls";
import { SessionClock } from "./SessionClock";
import { useStudy } from "./StudyProvider";
/** Phone-only action bar, pinned above the home indicator. Thumb-reach: the one primary session action, plus the timer. */
export function StickyBar({ completion, mastery }: { completion: number; mastery: string }) {
  const { state } = useStudy();
  const live = state.phase === "running" || state.phase === "paused";
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" role="region" aria-label="Study controls">
      <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-2.5">
        <div className="min-w-0">{live ? <SessionClock stacked /> : <a href="#progress" className="block min-h-[44px] text-sm leading-tight text-sub"><span className="block text-ink tabular-nums">{completion}% complete</span><span className="block text-xs">{mastery}</span></a>}</div>
        <SessionControls compact />
      </div>
    </div>
  );
}
