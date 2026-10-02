"use client";
import { useMemo, useState } from "react";
import { StudyScreen } from "@/components/study/StudyScreen";
import { StudyApiProvider, StudyRefreshContext } from "@/components/study/StudyProvider";
import type { StudyContext } from "@/types/study";
import { createFakeStudyApi } from "./fakeStudyApi";

/** Dev-only host: renders the REAL Study Mode components against fixture data and the in-memory fake API, with buttons to inject failures. */
export function FixturePreview({ initial, scenario }: { initial: StudyContext; scenario: string }) {
  const [ctx, setCtx] = useState(initial);
  const [log, setLog] = useState<string>("");
  const api = useMemo(() => createFakeStudyApi({
    resumeFor: scenario === "resume" ? { type: initial.entity.type, id: initial.entity.id, elapsedSeconds: 754 } : undefined,
    onEvent: (e) => {
      setLog(JSON.stringify(e));
      setCtx((c) => {
        if (e.kind === "progress") {
          const completion = e.patch.status === "completed" ? 100 : e.patch.completion ?? c.completion;
          return { ...c, completion, progress: { ...c.progress, completion, status: e.patch.status ?? (completion >= 100 ? "completed" : completion > 0 ? "learning" : c.progress.status), confidence: e.patch.confidence ?? c.progress.confidence },
            mastery: c.mastery === "not_started" && completion > 0 ? "in_progress" : c.mastery };        // fixture-only simplification: the real mastery is derived in SQL
        }
        if (e.kind === "schedule") return { ...c, revision: { state: "scheduled", scheduleId: "fixture-sched", step: 0, dueDate: "2099-01-02", daysUntil: 1, reason: "manual" } };
        if (e.kind === "finish") return { ...c, progress: { ...c.progress, sessions: c.progress.sessions + (e.seconds >= 30 ? 1 : 0), seconds_spent: c.progress.seconds_spent + e.seconds } };
        return c;
      });
    },
  }), [scenario, initial]);
  const c = api.control;
  return (
    <StudyApiProvider value={api}>
      <StudyRefreshContext.Provider value={() => setLog((l) => l)}>
        <div className="sticky top-0 z-50 flex flex-wrap items-center gap-2 border-b border-amber-400/40 bg-bg px-3 py-2 text-xs">
          <span className="text-amber-300">Failure injection (fixture API):</span>
          {(["network", "timeout", "ended", "conflict"] as const).map((k) => <button key={k} type="button" className="rounded border border-line px-2 py-1" onClick={() => c.failNext(k)}>fail next: {k}</button>)}
          <button type="button" className="rounded border border-line px-2 py-1" onClick={() => c.setNetworkDown(true)}>network down</button>
          <button type="button" className="rounded border border-line px-2 py-1" onClick={() => c.setNetworkDown(false)}>network up</button>
          <button type="button" className="rounded border border-line px-2 py-1" onClick={() => c.endElsewhere("completed")}>end in other tab</button>
          <button type="button" className="rounded border border-line px-2 py-1" onClick={() => c.endElsewhere("abandoned")}>mark abandoned (stale)</button>
          <span className="text-mute">last event: {log || "none"}</span>
        </div>
        <StudyScreen key={ctx.revision.state + ctx.completion} ctx={ctx} />
      </StudyRefreshContext.Provider>
    </StudyApiProvider>
  );
}
