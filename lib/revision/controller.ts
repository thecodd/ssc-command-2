import type { RevisionApi } from "./api";
import type { RAction, RState } from "./machine";
import type { EntityType } from "@/types/curriculum";

export interface ReviewDeps { api: RevisionApi; scheduleId: string; type: EntityType; id: string; getState(): RState; dispatch(a: RAction): void; refresh(): void }
const STALE = new Set(["conflict", "ended", "not_found"]);
/** Orchestration without React. One submit at a time; a stale or already-reviewed item is re-read from the server and shown, never overwritten. */
export function createReviewController(d: ReviewDeps) {
  let inflight = false, alive = true;
  async function submit() {
    const s = d.getState();
    if (inflight || s.phase !== "material" || !s.picked) return;                    // double click / double tap / Enter repeat
    inflight = true;
    const expectedStep = s.step, rating = s.picked;
    d.dispatch({ t: "submitting" });
    const r = await d.api.submit({ scheduleId: d.scheduleId, rating, expectedStep, confidence: s.confidence, type: d.type, id: d.id });
    inflight = false;
    if (!alive) return;
    if (r.ok) { d.dispatch({ t: "done", o: r.data }); d.refresh(); return; }
    if (STALE.has(r.code)) {
      const f = await d.api.state(d.scheduleId);
      if (!alive) return;
      d.dispatch({ t: "stale", fresh: f.ok ? f.data : null, message: "This revision was already updated elsewhere." });
      d.refresh(); return;
    }
    if (r.code === "timeout" || r.code === "network") {                            // it may have landed: ask the server instead of guessing
      const f = await d.api.state(d.scheduleId);
      if (!alive) return;
      if (f.ok && (f.data.done || f.data.step !== expectedStep)) { d.dispatch({ t: "stale", fresh: f.data, message: "Your review was saved. Here is where this revision stands now." }); d.refresh(); return; }
    }
    d.dispatch({ t: "fail", code: r.code, message: r.error });
  }
  return { submit, retry() { d.dispatch({ t: "dismiss" }); return submit(); }, activate() { alive = true; }, dispose() { alive = false; }, isBusy: () => inflight };
}
export type ReviewController = ReturnType<typeof createReviewController>;
