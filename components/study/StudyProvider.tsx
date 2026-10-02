"use client";
import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LEARNING } from "@/lib/learning/config";
import { elapsedAt, initialState, reduce, type MAction, type MState, type Op } from "@/lib/study/sessionMachine";
import { createController } from "@/lib/study/controller";
import type { StudyApi, ProgressPatch, ApiResult } from "@/lib/study/api";
import type { EntityType } from "@/types/curriculum";
import type { OpenSessionMeta } from "@/types/study";
import { liveApi } from "./liveApi";

// ONE owner of session state for the whole screen (header clock, sticky bar, focus card, progress card all read it).
// All time comes from server responses (see lib/study/sessionMachine.ts); this file only orchestrates calls, de-duplicates them and reconciles after failures.
const ApiCtx = createContext<StudyApi>(liveApi);
export const StudyApiProvider = ApiCtx.Provider;
/** Fixture/preview hosts supply their own refresh (the live page uses router.refresh()). */
export const StudyRefreshContext = createContext<(() => void) | null>(null);

export interface StudyCtx {
  state: MState; api: StudyApi; type: EntityType; id: string; backHref: string; other: OpenSessionMeta | null;
  start(): void; pause(): void; resume(): void; finish(): void; retry(op: Op): void; dismissNotice(): void; clearEnded(): void;
  sheet: "notes" | "resources" | null; openSheet(tab: "notes" | "resources" | null): void;
  exitOpen: boolean; setExitOpen(v: boolean): void; requestExit(): void; pauseAndLeave(): void; leave(): void;
  /** Runs a mutation, de-duplicated by key, and refreshes server data on success. */
  mutate<T>(key: string, fn: () => Promise<ApiResult<T>>): Promise<ApiResult<T> | null>;
  pendingKeys: ReadonlySet<string>; lastError: string | null; clearError(): void;
  progress: { setProgress(patch: ProgressPatch): Promise<ApiResult<null> | null> };
  now(): number;
}
const Ctx = createContext<StudyCtx | null>(null);
export function useStudy(): StudyCtx { const c = useContext(Ctx); if (!c) throw new Error("useStudy must be used inside <StudyProvider>"); return c; }
const mono = () => (typeof performance !== "undefined" ? performance.now() : 0);   // monotonic only; never wall-clock

export function StudyProvider({ type, id, backHref, openHere, other, children }: { type: EntityType; id: string; backHref: string; openHere: boolean; other: OpenSessionMeta | null; children: React.ReactNode }) {
  const api = useContext(ApiCtx);
  const router = useRouter();
  const refreshOverride = useContext(StudyRefreshContext);
  const [state, rawDispatch] = useReducer(reduce, openHere, initialState);
  // The controller reads state between renders. Keep the ref in lock-step with every dispatch (the reducer is pure, so applying it twice is safe).
  const stateRef = useRef(state);
  const dispatch = useCallback((a: MAction) => { stateRef.current = reduce(stateRef.current, a); rawDispatch(a); }, []);
  const [exitOpen, setExitOpen] = useState(false);
  const [sheet, openSheet] = useState<"notes" | "resources" | null>(null);
  const [pendingKeys, setPending] = useState<ReadonlySet<string>>(new Set());
  const [lastError, setLastError] = useState<string | null>(null);

  const refresh = useCallback(() => { if (refreshOverride) refreshOverride(); else startTransition(() => router.refresh()); }, [refreshOverride, router]);

  // The orchestration lives in lib/study/controller.ts (testable without React). This provider only wires state, refresh and timers into it.
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  const ctl = useMemo(() => createController({
    api, type, id, getState: () => stateRef.current, dispatch, now: mono, refresh: () => refreshRef.current(),
    onPending: (k) => setPending(k), onError: (m) => setLastError(m),
  }), [api, dispatch, id, type]);
  useEffect(() => { ctl.activate(); void ctl.reconcile("recover"); return () => ctl.dispose(); }, [ctl]);

  const start = useCallback(() => void ctl.start(), [ctl]);
  const pause = useCallback(() => void ctl.pause(), [ctl]);
  const resume = useCallback(() => void ctl.resume(), [ctl]);
  const finish = useCallback(() => void ctl.finish(), [ctl]);
  const retry = useCallback((op: Op) => void ctl.retry(op), [ctl]);

  // heartbeat (the server decides what it means) + wake-ups
  const lost = state.syncLostAt !== null, running = state.phase === "running", liveSession = state.session?.id ?? null;
  useEffect(() => {
    if (!running || !liveSession) return;
    const t = setInterval(() => void ctl.heartbeat(), (lost ? 10 : LEARNING.heartbeatSeconds) * 1000);
    return () => clearInterval(t);
  }, [running, liveSession, lost, ctl]);
  useEffect(() => {
    const wake = () => { if (document.visibilityState === "visible") void ctl.heartbeat(); };
    document.addEventListener("visibilitychange", wake); window.addEventListener("online", wake); window.addEventListener("focus", wake);
    return () => { document.removeEventListener("visibilitychange", wake); window.removeEventListener("online", wake); window.removeEventListener("focus", wake); };
  }, [ctl]);

  const mutate = ctl.mutate;
  const progress = useMemo(() => ({
    setProgress: (patch: ProgressPatch) => ctl.mutate("progress", () => api.setProgress(type, id, patch)),
  }), [api, ctl, id, type]);

  // leaving
  const leave = useCallback(() => { setExitOpen(false); router.push(backHref); }, [backHref, router]);
  const requestExit = useCallback(() => { if (stateRef.current.phase === "running") setExitOpen(true); else leave(); }, [leave]);
  const pauseAndLeave = useCallback(async () => { if (await ctl.pauseForExit()) leave(); else setExitOpen(false); }, [ctl, leave]);

  const value: StudyCtx = {
    state, api, type, id, backHref, other, start, pause, resume, finish, retry,
    dismissNotice: () => dispatch({ t: "dismiss_notice" }), clearEnded: () => dispatch({ t: "clear_ended" }),
    sheet, openSheet, exitOpen, setExitOpen, requestExit, pauseAndLeave, leave, mutate, pendingKeys, lastError, clearError: () => setLastError(null), progress, now: mono,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export { elapsedAt };
