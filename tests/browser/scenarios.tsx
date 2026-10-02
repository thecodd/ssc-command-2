import * as React from "react";
import { StudyScreen } from "@/components/study/StudyScreen";
import { StudyApiProvider } from "@/components/study/StudyProvider";
import { ReviewRunner } from "@/components/revision/ReviewRunner";
import { RevisionApiCtx } from "@/components/revision/RevisionApiContext";
import { FIXTURES } from "@/tests/fixtures/study";
import { createFakeStudyApi } from "@/tests/fixtures/fakeStudyApi";
import { createFakeRevisionApi } from "@/tests/fixtures/fakeRevisionApi";
// FIXTURE data + in-memory fake APIs driving the REAL components. Component smoke only: not real routes, not real data, no CSS.
export function makeScenario(name: string): { node: React.ReactNode; api: any } {
  if (name.startsWith("study")) {
    const key = name === "study-weak" ? "weak-due" : "ssc-topic";
    const api = createFakeStudyApi({ latencyMs: 20 }); const calls: Record<string, number> = {};
    for (const k of ["start", "pause", "resume", "finish", "heartbeat", "recover", "setProgress"] as const) { const f = (api as any)[k].bind(api); (api as any)[k] = (...a: any[]) => { calls[k] = (calls[k] ?? 0) + 1; return f(...a); }; }
    return { api: Object.assign(api, { calls }), node: <StudyApiProvider value={api}><StudyScreen ctx={FIXTURES[key]} /></StudyApiProvider> };
  }
  const ladder = [2, 5, 20];
  const api = createFakeRevisionApi({ ladder, step: 1, queueAfter: "00000000-0000-4000-8000-000000000002", latencyMs: 20 });
  const st = api.control.current();
  return { api, node: (
    <RevisionApiCtx.Provider value={api}>
      <ReviewRunner scheduleId={st.scheduleId} type="ssc_topic" entityId="fixture-entity" title="Fixture Topic A" subject="Fixture Subject" kicker="SSC" reviewNo={3} dueText="Overdue by 2 days" overdue step={1} ladder={ladder} preview={st.preview}
        mastery="needs_revision" masteryWhy="Fixture: a scheduled revision is due." confidence={3} history={[]} pyq={{ total: 18, attempted: 12, accuracyPct: 67 }} practiceHref="/practice/new?scope=ssc_topic&id=x" studyHref="/study/ssc_topic/x"
        material={<ul><li>Fixture subtopic 1</li></ul>} />
    </RevisionApiCtx.Provider>) };
}
