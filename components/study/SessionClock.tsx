"use client";
import { useEffect, useState } from "react";
import { clockText, elapsedAt } from "@/lib/study/sessionMachine";
import { useStudy } from "./StudyProvider";

const LABEL = { running: "STUDYING", paused: "PAUSED", ended: "DONE", idle: "", recovering: "RESUMING" } as const;
/** "24:18 STUDYING". The number is the last SERVER value plus a monotonic local interpolation (see sessionMachine.elapsedAt); it is display-only.
 *  role="timer" with aria-live="off": assistive tech is not spammed every second. State changes are announced separately via the polite status line. */
export function SessionClock({ className = "", stacked = false }: { className?: string; stacked?: boolean }) {
  const { state } = useStudy();
  const [now, setNow] = useState(0);
  const ticking = state.phase === "running" && state.syncLostAt === null;
  useEffect(() => {
    setNow(performance.now());
    if (!ticking) return;
    const t = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(t);
  }, [ticking, state.baseAt, state.session?.id]);
  if (state.phase === "idle") return null;
  const lost = state.syncLostAt !== null;
  const label = lost ? "RECONNECTING" : LABEL[state.phase];
  const text = state.phase === "recovering" ? "--:--" : clockText(elapsedAt(state, now || state.baseAt));
  const tone = lost ? "text-amber-300" : state.phase === "running" ? "text-lime" : "text-sub";
  return (
    <span className={`inline-flex whitespace-nowrap ${stacked ? "flex-col items-start gap-0.5 leading-none" : "items-baseline gap-2"} ${className}`}>
      <span role="timer" aria-live="off" aria-label={`Study timer, ${label.toLowerCase()}`} className={`font-semibold tabular-nums ${stacked ? "text-xl" : "text-lg sm:text-xl"} ${tone}`}>{text}</span>
      <span aria-hidden className={`text-[10px] font-medium tracking-widest sm:text-[11px] ${stacked ? "" : "hidden sm:inline"} ${tone}`}>{label}</span>
      <span role="status" className="sr-only">{state.phase === "running" ? (lost ? "Timer reconnecting" : "Studying") : state.phase === "paused" ? "Paused" : state.phase === "ended" ? "Session finished" : ""}</span>
    </span>
  );
}
