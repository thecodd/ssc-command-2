"use client";
import { useEffect } from "react";
import { useStudy } from "./StudyProvider";
const editable = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const interactive = (el: EventTarget | null) => el instanceof HTMLElement && !!el.closest("button, a, summary, [role=button], [role=radio]");
/** Space = pause/resume, Esc = exit, N = next section. Never fires while typing, inside an open dialog, or with a modifier key. */
export function StudyShortcuts() {
  const { state, pause, resume, requestExit } = useStudy();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || editable(e.target)) return;
      const dialogOpen = !!document.querySelector("dialog[open]");
      if (e.key === "Escape") { if (!dialogOpen) { e.preventDefault(); requestExit(); } return; }
      if (dialogOpen) return;
      if (e.key === " " || e.code === "Space") {
        if (interactive(e.target) || e.repeat) return;                 // Space on a focused button must keep activating that button
        if (state.busy) return;
        if (state.phase === "running") { e.preventDefault(); pause(); }
        else if (state.phase === "paused") { e.preventDefault(); resume(); }
        return;
      }
      if ((e.key === "n" || e.key === "N") && !interactive(e.target)) {
        const secs = Array.from(document.querySelectorAll<HTMLElement>("[data-study-section]"));
        const next = secs.find((s) => s.getBoundingClientRect().top > 90) ?? secs[0];
        if (!next) return;
        e.preventDefault();
        next.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
        next.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state.phase, state.busy, pause, resume, requestExit]);
  return null;
}
