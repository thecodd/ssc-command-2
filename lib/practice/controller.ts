import type { PracticeApi } from "./api";
import { firstUnanswered, type PAction, type PState } from "./machine";

export interface PracticeDeps { api: PracticeApi; getState(): PState; dispatch(a: PAction): void; now(): number }
/** Orchestration for the question flow (no React): one request at a time, resume from the server snapshot, never trusts a local answer. */
export function createPracticeController(d: PracticeDeps) {
  let inflight = false, alive = true;
  const sid = () => d.getState().session.id;

  async function load(index?: number) {
    const st = d.getState();
    const i = index ?? firstUnanswered(st.session);
    if (i < 0) return finish();
    const pyq = st.session.pyq_ids[i];
    if (!pyq) return finish();
    d.dispatch({ t: "load", index: i });
    const r = await d.api.question(sid(), pyq);
    if (!alive) return;
    if (r.ok) d.dispatch({ t: "loaded", q: r.data, at: d.now() });
    else d.dispatch({ t: "fail", code: r.code, message: r.error, retry: "load" });
  }

  async function submit() {
    const st = d.getState();
    if (inflight || st.phase !== "ready" || !st.picked || !st.question) return;       // double click / Enter repeat / not ready
    inflight = true;
    const picked = st.picked, pyq = st.question.pyq_id;
    d.dispatch({ t: "submitting" });
    const seconds = Math.max(0, Math.round((d.now() - st.shownAt) / 1000));            // informational only; the server clamps it
    const r = await d.api.submit(sid(), pyq, picked, seconds);
    inflight = false;
    if (!alive) return;
    if (r.ok) { d.dispatch({ t: "submitted", r: r.data, pyq, time: seconds });         // duplicate=true is just the ORIGINAL result again
      await enrich(pyq); }
    else {
      d.dispatch({ t: "fail", code: r.code, message: r.error, retry: "submit" });
      if (r.code === "timeout" || r.code === "network") await reconcile();            // it may have landed: re-read the server's truth
    }
  }

  /** The concept / mapped SSC topic are only returned by practice_question AFTER the answer exists, so fetch it once more. Failure is harmless: feedback is already shown. */
  async function enrich(pyq: string) {
    const r = await d.api.question(sid(), pyq);
    if (alive && r.ok) d.dispatch({ t: "enriched", q: r.data });
  }

  /** After an uncertain submit: ask the server whether this question now has an answer. */
  async function reconcile() {
    const st = d.getState();
    if (!st.question) return;
    const r = await d.api.question(sid(), st.question.pyq_id);
    if (!alive || !r.ok) return;
    if (r.data.answer) d.dispatch({ t: "loaded", q: r.data, at: d.now() });
  }

  async function next() {
    const st = d.getState();
    if (st.phase !== "answered") return;
    const i = firstUnanswered(st.session);
    return i === -1 ? finish() : load(i);
  }

  async function finish(abandon = false) {
    if (inflight) return;
    inflight = true; d.dispatch({ t: "finishing" });
    const r = await d.api.finish(sid(), abandon);
    inflight = false;
    if (!alive) return;
    if (r.ok) d.dispatch({ t: "summary", s: r.data });
    else d.dispatch({ t: "fail", code: r.code, message: r.error, retry: "finish" });
  }
  const retry = () => { const e = d.getState().error; if (!e) return; d.dispatch({ t: "dismiss" }); return e.retry === "load" ? load() : e.retry === "finish" ? finish() : submit(); };
  return { load, submit, next, finish, retry, activate() { alive = true; }, dispose() { alive = false; }, isBusy: () => inflight };
}
export type PracticeController = ReturnType<typeof createPracticeController>;
