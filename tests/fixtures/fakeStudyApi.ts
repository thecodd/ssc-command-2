// In-memory StudyApi for the dev preview and Node tests. It mimics the CONTRACT of the Phase 4 RPCs (server clock, idempotent pause/resume/finish, stale handling),
// but it is NOT the database and proves nothing about it. mode: "fixture" makes the UI show a banner.
import type { ErrorCode } from "@/lib/study/errors";
import { userMessage } from "@/lib/study/errors";
import type { ApiResult, ProgressPatch, StudyApi } from "@/lib/study/api";
import type { EntityType, StudySession } from "@/types/curriculum";

export type FakeEvent = { kind: "progress"; patch: ProgressPatch } | { kind: "schedule" } | { kind: "finish"; seconds: number };
interface Sess { id: string; type: EntityType; entityId: string; state: StudySession["state"]; accumulated: number; activeSince: number; startedAt: string; seconds: number }
export interface FakeOptions { clock?: () => number; latencyMs?: number; onEvent?: (e: FakeEvent) => void; resumeFor?: { type: EntityType; id: string; elapsedSeconds: number } }

export function createFakeStudyApi(o: FakeOptions = {}) {
  const clock = o.clock ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  let sess: Sess | null = null, n = 0, networkDown = false;
  const failures: { method: string | null; code: ErrorCode }[] = [];
  if (o.resumeFor) sess = { id: "fixture-session-0", type: o.resumeFor.type, entityId: o.resumeFor.id, state: "active", accumulated: o.resumeFor.elapsedSeconds, activeSince: clock(), startedAt: "2099-01-01T00:00:00.000Z", seconds: 0 };

  const elapsed = (s: Sess) => Math.floor(s.accumulated + (s.state === "active" ? (clock() - s.activeSince) / 1000 : 0));
  const json = (s: Sess): StudySession => ({ id: s.id, entity_type: s.type, entity_id: s.entityId, state: s.state, started_at: s.startedAt, ended_at: s.state === "completed" || s.state === "abandoned" ? "2099-01-01T01:00:00.000Z" : null, seconds: s.seconds, elapsed_seconds: elapsed(s), server_now: "2099-01-01T00:00:00.000Z" });
  const delay = () => (o.latencyMs ? new Promise<void>((r) => setTimeout(r, o.latencyMs)) : Promise.resolve());
  const bad = <T,>(code: ErrorCode): ApiResult<T> => ({ ok: false, code, error: userMessage(code) });
  async function gate<T>(method: string, fn: () => ApiResult<T>): Promise<ApiResult<T>> {
    await delay();
    if (networkDown) return bad("network");
    const i = failures.findIndex((f) => f.method === null || f.method === method);
    if (i >= 0) { const [f] = failures.splice(i, 1); return bad(f.code); }
    return fn();
  }
  const close = (s: Sess, state: "completed" | "abandoned") => { s.accumulated = elapsed(s); s.seconds = s.accumulated; s.state = state; };

  const api: StudyApi = {
    mode: "fixture",
    recover: () => gate("recover", () => ({ ok: true, data: sess && (sess.state === "active" || sess.state === "paused") ? json(sess) : null })),
    start: (type, id) => gate("start", () => {
      if (sess && (sess.state === "active" || sess.state === "paused")) { if (sess.type === type && sess.entityId === id) return { ok: true, data: json(sess) }; close(sess, "abandoned"); }
      sess = { id: `fixture-session-${++n}`, type, entityId: id, state: "active", accumulated: 0, activeSince: clock(), startedAt: "2099-01-01T00:00:00.000Z", seconds: 0 };
      return { ok: true, data: json(sess) };
    }),
    pause: (id) => gate("pause", () => {
      if (!sess || sess.id !== id) return bad("not_found"); if (sess.state === "completed" || sess.state === "abandoned") return bad("ended");
      if (sess.state === "active") { sess.accumulated = elapsed(sess); sess.state = "paused"; } return { ok: true, data: json(sess) };
    }),
    resume: (id) => gate("resume", () => {
      if (!sess || sess.id !== id) return bad("not_found"); if (sess.state === "completed" || sess.state === "abandoned") return bad("ended");
      if (sess.state === "paused") { sess.activeSince = clock(); sess.state = "active"; } return { ok: true, data: json(sess) };
    }),
    heartbeat: (id) => gate("heartbeat", () => (!sess || sess.id !== id ? bad("not_found") : { ok: true, data: json(sess) })),
    finish: (id) => gate("finish", () => {
      if (!sess || sess.id !== id) return bad("not_found");
      if (sess.state === "active" || sess.state === "paused") close(sess, "completed");           // idempotent: a second call returns the closed session
      o.onEvent?.({ kind: "finish", seconds: sess.seconds }); return { ok: true, data: json(sess) };
    }),
    setProgress: (_t, _id, patch) => gate("setProgress", () => { o.onEvent?.({ kind: "progress", patch }); return { ok: true, data: null }; }),
    scheduleRevision: () => gate("scheduleRevision", () => { o.onEvent?.({ kind: "schedule" }); return { ok: true, data: { dueDate: "2099-01-02" } }; }),
    addFocus: () => gate("addFocus", () => ({ ok: true, data: { already: false } })),
  };
  return Object.assign(api, {
    control: {
      failNext: (code: ErrorCode, method: string | null = null) => { failures.push({ method, code }); },
      setNetworkDown: (v: boolean) => { networkDown = v; },
      /** another tab / the inactivity sweep ended our session */
      endElsewhere: (state: "completed" | "abandoned" = "completed") => { if (sess && (sess.state === "active" || sess.state === "paused")) close(sess, state); },
      current: () => (sess ? json(sess) : null),
    },
  });
}
