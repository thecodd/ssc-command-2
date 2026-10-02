import { createController } from "@/lib/study/controller";
import { initialState, reduce, type MAction, type MState } from "@/lib/study/sessionMachine";
import { createFakeStudyApi } from "@/tests/fixtures/fakeStudyApi";
const TYPE = "ssc_topic" as const, ID = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
function rig(opts: { recovering?: boolean; clockRef?: { v: number }; resume?: boolean } = {}) {
  const clk = opts.clockRef ?? { v: 0 };
  const api = createFakeStudyApi({ clock: () => clk.v, resumeFor: opts.resume ? { type: TYPE, id: ID, elapsedSeconds: 600 } : undefined });
  let state: MState = initialState(opts.recovering ?? false); let refreshes = 0; const actions: MAction[] = [];
  const calls: Record<string, number> = {};
  for (const k of ["start", "pause", "resume", "finish", "heartbeat", "recover", "setProgress"] as const) { const f = (api as any)[k].bind(api); (api as any)[k] = (...a: any[]) => { calls[k] = (calls[k] ?? 0) + 1; return f(...a); }; }
  const ctl = createController({ api, type: TYPE, id: ID, getState: () => state, dispatch: (a) => { actions.push(a); state = reduce(state, a); }, now: () => clk.v, refresh: () => { refreshes++; } });
  return { api, ctl, clk, calls, get state() { return state; }, get refreshes() { return refreshes; }, actions };
}
export default async function () {
  await t("controller: double-click Start sends ONE request", async () => {
    const r = rig(); await Promise.all([r.ctl.start(), r.ctl.start(), r.ctl.start()]);
    assert.equal(r.calls.start, 1); assert.equal(r.state.phase, "running");
  });
  await t("controller: pause/resume/finish happy path; server time is what is shown (clock jump ignored)", async () => {
    const r = rig(); await r.ctl.start(); r.clk.v += 61_000; await r.ctl.pause();
    assert.equal(r.state.phase, "paused"); assert.equal(r.state.baseElapsed, 61);
    r.clk.v += 500_000; await r.ctl.resume(); r.clk.v += 4000; await r.ctl.finish();
    assert.equal(r.state.phase, "ended"); assert.equal(r.state.ended?.seconds, 65); assert.equal(r.refreshes, 1);
  });
  await t("controller: finish is idempotent (double tap = one finish call, one refresh)", async () => {
    const r = rig(); await r.ctl.start(); await Promise.all([r.ctl.finish(), r.ctl.finish()]);
    assert.equal(r.calls.finish, 1); assert.equal(r.refreshes, 1);
  });
  await t("controller: timeout on pause -> error notice, then reconcile re-reads server truth", async () => {
    const r = rig(); await r.ctl.start(); r.api.control.failNext("timeout", "pause"); await r.ctl.pause();
    assert.equal(r.calls.recover, 1); assert.equal(r.state.phase, "running"); assert.equal(r.state.notice?.kind, "error"); assert.equal(r.state.notice?.retry, "pause");
    await r.ctl.retry("pause"); assert.equal(r.state.phase, "paused");
  });
  await t("controller: request that LANDED but timed out is not applied twice (reconcile shows paused)", async () => {
    const r = rig(); await r.ctl.start(); await r.api.pause(r.state.session!.id);          // server applied it...
    r.api.control.failNext("timeout", "pause"); await r.ctl.pause();                         // ...but the client saw a timeout
    assert.equal(r.state.phase, "paused");
  });
  await t("controller: finish after the session ended elsewhere -> shows the saved session, does not double count", async () => {
    const r = rig(); await r.ctl.start(); r.clk.v += 120_000; r.api.control.endElsewhere("completed");
    await r.ctl.finish(); assert.equal(r.state.phase, "ended"); assert.equal(r.state.ended?.seconds, 120);
  });
  await t("controller: heartbeat sees session ended in another tab", async () => {
    const r = rig(); await r.ctl.start(); r.clk.v += 30_000; r.api.control.endElsewhere("completed"); await r.ctl.heartbeat();
    assert.equal(r.state.phase, "ended"); assert.equal(r.state.ended?.byUs, false); assert.equal(r.state.ended?.seconds, 30);
  });
  await t("controller: abandoned (stale) session is reported, with saved seconds", async () => {
    const r = rig(); await r.ctl.start(); r.clk.v += 45_000; r.api.control.endElsewhere("abandoned"); await r.ctl.heartbeat();
    assert.equal(r.state.ended?.state, "abandoned"); assert.equal(r.state.notice?.kind, "abandoned");
  });
  await t("controller: network down -> sync_lost, display frozen; back online -> recovers", async () => {
    const r = rig(); await r.ctl.start(); r.clk.v += 5000; r.api.control.setNetworkDown(true); await r.ctl.heartbeat();
    assert.equal(r.state.notice?.kind, "sync_lost"); r.api.control.setNetworkDown(false); r.clk.v += 5000; await r.ctl.heartbeat();
    assert.equal(r.state.syncLostAt, null); assert.equal(r.state.notice, null);
  });
  await t("controller: a session on ANOTHER item is not adopted on mount (we don't show someone else's timer)", async () => {
    const r = rig({ recovering: true }); await r.api.start(TYPE, OTHER); await r.ctl.reconcile("recover");
    assert.equal(r.state.phase, "idle"); assert.equal(r.state.session, null);
  });
  await t("controller: refresh mid-session recovers the same running session with server elapsed", async () => {
    const r = rig({ recovering: true, resume: true }); r.clk.v = 10_000; await r.ctl.reconcile("recover");
    assert.equal(r.state.phase, "running"); assert.equal(r.state.baseElapsed, 610); assert.equal(r.state.notice?.kind, "recovered");
  });
  await t("controller: starting here while another item is timed closes that one (server decides)", async () => {
    const r = rig(); await r.api.start(TYPE, OTHER); await r.ctl.start();
    assert.equal(r.api.control.current()!.entity_id, ID); assert.equal(r.state.phase, "running");
  });
  await t("controller: mutate de-dupes by key, refreshes on success, surfaces error without refresh", async () => {
    const r = rig(); const a = r.ctl.mutate("progress", () => r.api.setProgress(TYPE, ID, { completion: 50 })); const b = r.ctl.mutate("progress", () => r.api.setProgress(TYPE, ID, { completion: 60 }));
    await Promise.all([a, b]); assert.equal(r.calls.setProgress, 1); assert.equal(r.refreshes, 1);
    r.api.control.failNext("network", "setProgress"); const x = await r.ctl.mutate("progress", () => r.api.setProgress(TYPE, ID, { completion: 70 }));
    assert.equal(x && x.ok, false); assert.equal(r.refreshes, 1);
  });
  await t("controller: conflict triggers a refresh so the user sees fresh state", async () => {
    const r = rig(); r.api.control.failNext("conflict", "setProgress"); await r.ctl.mutate("progress", () => r.api.setProgress(TYPE, ID, { completion: 10 }));
    assert.equal(r.refreshes, 1);
  });
  await t("controller: pauseForExit pauses; failure keeps the user on the page", async () => {
    const r = rig(); await r.ctl.start(); assert.equal(await r.ctl.pauseForExit(), true); assert.equal(r.state.phase, "paused");
    const r2 = rig(); await r2.ctl.start(); r2.api.control.failNext("network", "pause"); assert.equal(await r2.ctl.pauseForExit(), false);
  });
}
