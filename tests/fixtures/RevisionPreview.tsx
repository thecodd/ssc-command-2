"use client";
import { useMemo } from "react";
import { ReviewRunner } from "@/components/revision/ReviewRunner";
import { RevisionApiCtx } from "@/components/revision/RevisionApiContext";
import { createFakeRevisionApi } from "./fakeRevisionApi";
import type { IntervalPreview, Rating } from "@/types/revision";
import { RATING_ORDER } from "@/lib/revision/queue";

/** Dev-only host for the review screen: REAL components, fixture data, in-memory fake API (custom ladder 2-5-20 so the "no hard-coded ladder" rule is visible). */
export function RevisionPreview({ scenario }: { scenario: string }) {
  const ladder = useMemo(() => [2, 5, 20], []), step = scenario === "late" ? 2 : 1;
  const api = useMemo(() => createFakeRevisionApi({ ladder, step, queueAfter: scenario === "last" ? null : "00000000-0000-4000-8000-000000000002" }), [ladder, step, scenario]);
  const preview: IntervalPreview[] = [];
  return (
    <RevisionApiCtx.Provider value={api}>
      <ReviewPreviewInner api={api} ladder={ladder} step={step} fallback={preview} />
    </RevisionApiCtx.Provider>
  );
}
function ReviewPreviewInner({ api, ladder, step }: { api: ReturnType<typeof createFakeRevisionApi>; ladder: number[]; step: number; fallback: IntervalPreview[] }) {
  const state = api.control.current();
  return (
    <ReviewRunner scheduleId={state.scheduleId} type="ssc_topic" entityId="fixture-entity" title="Fixture Topic A" subject="Fixture Subject" kicker="SSC" reviewNo={3} dueText="Overdue by 2 days" overdue step={step} ladder={ladder} preview={state.preview}
      mastery="needs_revision" masteryWhy="Fixture: a scheduled revision is due." confidence={3}
      history={[{ id: "h1", reviewed_on: "2099-01-05", rating: "good" as Rating, step_before: 0, step_after: 1, interval_days_after: 5, graduated: false, confidence: 3, source: "app" }, { id: "h2", reviewed_on: "2099-01-01", rating: RATING_ORDER[0], step_before: 1, step_after: 0, interval_days_after: 2, graduated: false, confidence: null, source: "app" }]}
      pyq={{ total: 18, attempted: 12, accuracyPct: 67 }} practiceHref="/dev/revision-preview" studyHref="/dev/study-preview"
      material={<ul className="flex flex-wrap gap-1.5"><li className="chip text-sm text-ink">Fixture subtopic 1</li><li className="chip text-sm text-ink">Fixture subtopic 2</li></ul>} />
  );
}
