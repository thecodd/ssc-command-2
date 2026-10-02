import type { EntityType, StudySession } from "@/types/curriculum";
import type { ApiResult, StudyApi } from "./api";
import type { MAction, MState, Op } from "./sessionMachine";

// Orchestration for the study timer, kept OUT of React so it can be exercised in Node with a fake API: de-duplication, reconcile-after-failure,
// heartbeat handling. The React provider only wires state/dispatch/refresh into it.
export interface ControllerDeps {
  api: StudyApi; type: EntityType; id: string;
  getState(): MState; dispatch(a: MAction): void; now(): number; refresh(): void;
  onPending?(keys: ReadonlySet<string>): void; onError?(message: string | null): void;
}
const sameItem = (s: StudySession, t: EntityType, id: string) => s.entity_type === t && s.entity_id === id;

export function createController(d: ControllerDeps) {
  let inflight: Op | null = null, alive = true;
  const keys = new Set<string>();

  async function reconcile(source: "recover" | "heartbeat" = "recover", clearNotice = false) {
    const r = await d.api.recover();
    if (!alive) return;
    if (r.ok) {
      d.dispatch({ t: "adopt", session: r.data && sameItem(r.data, d.type, d.id) ? r.data : null, at: d.now(), source });   // a session on ANOTHER item is not ours
      if (clearNotice) d.dispatch({ t: "dismiss_notice" });
    } else d.dispatch({ t: "fail", op: "recover", code: r.code, message: r.error });
  }

  async function run(op: Op, call: () => Promise<ApiResult<StudySession>>) {
    if (inflight) return;                                    // double click / double tap / key repeat
    inflight = op;
    d.dispatch({ t: "begin", op });
    const r = await call();
    inflight = null;
    if (!alive) return;
    if (r.ok) {
      if (op === "finish") { d.dispatch({ t: "finished", session: r.data, at: d.now() }); d.refresh(); }
      else d.dispatch({ t: "adopt", session: r.data, at: d.now(), source: "op" });
      return;
    }
    d.dispatch({ t: "fail", op, code: r.code, message: r.error });
    if (r.code === "timeout" || r.code === "network" || r.code === "ended" || r.code === "not_found") await reconcile("recover");   // the call may have landed: re-read the truth
  }
  const sid = () => d.getState().session?.id ?? null;

  const ctl = {
    reconcile,
    start: () => { d.dispatch({ t: "clear_ended" }); return run("start", () => d.api.start(d.type, d.id)); },
    pause: () => { const s = sid(); return s ? run("pause", () => d.api.pause(s)) : Promise.resolve(); },
    resume: () => { const s = sid(); return s ? run("resume", () => d.api.resume(s)) : Promise.resolve(); },
    finish: () => { const s = sid(); return s ? run("finish", () => d.api.finish(s, d.type, d.id)) : Promise.resolve(); },
    retry(op: Op) { d.dispatch({ t: "dismiss_notice" }); return op === "start" ? ctl.start() : op === "pause" ? ctl.pause() : op === "resume" ? ctl.resume() : op === "finish" ? ctl.finish() : reconcile("recover"); },
    async heartbeat() {
      const s = d.getState();
      if (!s.session || (s.phase !== "running" && s.phase !== "paused") || inflight) return;
      const r = await d.api.heartbeat(s.session.id);
      if (!alive) return;
      if (r.ok) d.dispatch({ t: "adopt", session: sameItem(r.data, d.type, d.id) ? r.data : null, at: d.now(), source: "heartbeat" });
      else if (r.code === "network" || r.code === "timeout") d.dispatch({ t: "sync_lost", at: d.now() });
      else if (r.code === "not_found") d.dispatch({ t: "adopt", session: null, at: d.now(), source: "heartbeat" });
    },
    /** Pause, then report whether it is safe to leave. */
    async pauseForExit(): Promise<boolean> {
      const s = d.getState().session;
      if (!s) return true;
      if (inflight) return false;
      inflight = "pause"; d.dispatch({ t: "begin", op: "pause" });
      const r = await d.api.pause(s.id);
      inflight = null;
      if (r.ok) { d.dispatch({ t: "adopt", session: r.data, at: d.now(), source: "op" }); return true; }
      d.dispatch({ t: "fail", op: "pause", code: r.code, message: r.error });
      return false;
    },
    /** Generic server write (progress, revision, focus): one per key at a time; refreshes server data on success (and on a conflict). */
    async mutate<T>(key: string, fn: () => Promise<ApiResult<T>>): Promise<ApiResult<T> | null> {
      if (keys.has(key)) return null;
      keys.add(key); d.onPending?.(new Set(keys)); d.onError?.(null);
      const r = await fn();
      keys.delete(key); if (alive) d.onPending?.(new Set(keys));
      if (!alive) return r;
      if (r.ok) d.refresh(); else { d.onError?.(r.error); if (r.code === "conflict") d.refresh(); }
      return r;
    },
    isBusy: () => inflight !== null,
    /** React StrictMode (and fast refresh) runs effect cleanup then setup again on the SAME controller: re-arm it. */
    activate() { alive = true; },
    dispose() { alive = false; },
  };
  return ctl;
}
export type StudyController = ReturnType<typeof createController>;
