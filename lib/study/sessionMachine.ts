import type { StudySession } from "@/types/curriculum";
import { LEARNING } from "@/lib/learning/config";
import type { ErrorCode } from "./errors";

// PURE state machine for the study timer UI. The server owns time: every state change comes from an RPC response (elapsed_seconds).
// `at` / `nowMono` are MONOTONIC client milliseconds (performance.now()) used only to interpolate the display between server responses
// (a wall-clock change or sleep can't corrupt it). Nothing here is ever sent to the server as a duration.
export type Phase = "recovering" | "idle" | "running" | "paused" | "ended";
export type Op = "start" | "pause" | "resume" | "finish" | "recover";
export type NoticeKind = "recovered" | "ended_elsewhere" | "abandoned" | "error" | "sync_lost";
export interface Notice { kind: NoticeKind; message: string; retry?: Op; code?: ErrorCode }
export interface EndedSummary { sessionId: string; seconds: number; state: "completed" | "abandoned"; startedAt: string; byUs: boolean }
export interface MState { phase: Phase; session: StudySession | null; baseElapsed: number; baseAt: number; syncLostAt: number | null; busy: Op | null; notice: Notice | null; ended: EndedSummary | null }
export type MAction =
  | { t: "adopt"; session: StudySession | null; at: number; source: "recover" | "heartbeat" | "op" }
  | { t: "begin"; op: Op }
  | { t: "fail"; op: Op; code: ErrorCode; message: string }
  | { t: "finished"; session: StudySession; at: number }
  | { t: "sync_lost"; at: number }
  | { t: "dismiss_notice" }
  | { t: "clear_ended" };

export const initialState = (recovering: boolean): MState => ({ phase: recovering ? "recovering" : "idle", session: null, baseElapsed: 0, baseAt: 0, syncLostAt: null, busy: null, notice: null, ended: null });
const live = (p: Phase) => p === "running" || p === "paused";

export function reduce(s: MState, a: MAction): MState {
  switch (a.t) {
    case "begin": return { ...s, busy: a.op, notice: s.notice?.kind === "sync_lost" ? s.notice : null };
    case "fail": return { ...s, phase: a.op === "recover" && s.phase === "recovering" ? "idle" : s.phase, busy: null, notice: { kind: "error", message: a.message, retry: a.op, code: a.code } };
    case "dismiss_notice": return { ...s, notice: null };
    case "clear_ended": return { ...s, ended: null, phase: s.phase === "ended" ? "idle" : s.phase, session: s.phase === "ended" ? null : s.session };
    case "sync_lost": return s.phase === "running" && s.syncLostAt === null ? { ...s, syncLostAt: a.at, notice: { kind: "sync_lost", message: "Can't reach the server. The timer is paused on screen until it reconnects." } } : s;
    case "finished": return { ...s, phase: "ended", session: a.session, baseElapsed: a.session.seconds, baseAt: a.at, syncLostAt: null, busy: null, notice: null,
      ended: { sessionId: a.session.id, seconds: a.session.seconds, state: a.session.state === "abandoned" ? "abandoned" : "completed", startedAt: a.session.started_at, byUs: true } };
    case "adopt": {
      if (s.phase === "ended" && s.ended?.byUs) return { ...s, busy: null };               // our own completed session is final
      const sess = a.session;
      if (!sess) {
        if (live(s.phase)) return { ...s, phase: "idle", session: null, baseElapsed: 0, syncLostAt: null, busy: null, notice: { kind: "ended_elsewhere", message: "This session ended in another tab, or after a period of inactivity. Time up to your last sync was saved." } };
        return { ...s, phase: "idle", busy: null, syncLostAt: null };
      }
      if (sess.state === "completed" || sess.state === "abandoned") {
        return { ...s, phase: "ended", session: sess, baseElapsed: sess.seconds, baseAt: a.at, syncLostAt: null, busy: null,
          notice: { kind: sess.state === "abandoned" ? "abandoned" : "ended_elsewhere", message: sess.state === "abandoned" ? "This session was closed after a period of inactivity. The time up to your last activity was saved." : "This session was finished in another tab." },
          ended: { sessionId: sess.id, seconds: sess.seconds, state: sess.state, startedAt: sess.started_at, byUs: false } };
      }
      const recovered = a.source === "recover" && s.phase === "recovering";
      return { ...s, phase: sess.state === "active" ? "running" : "paused", session: sess, baseElapsed: sess.elapsed_seconds, baseAt: a.at, syncLostAt: null, busy: null, ended: null,
        notice: recovered ? { kind: "recovered", message: "Picked up your session where you left it." } : s.notice?.kind === "sync_lost" ? null : s.notice };
    }
  }
}

/** Seconds to DISPLAY now. Authoritative only at the moment of the last server response; never submitted anywhere. */
export function elapsedAt(s: MState, nowMono: number): number {
  if (!s.session) return 0;
  if (s.phase !== "running") return s.baseElapsed;
  const end = s.syncLostAt !== null ? Math.min(nowMono, s.syncLostAt) : nowMono;
  return Math.min(LEARNING.maxSessionSeconds, s.baseElapsed + Math.max(0, Math.floor((end - s.baseAt) / 1000)));
}
export const clockText = (sec: number) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60, p = (n: number) => String(n).padStart(2, "0"); return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`; };
