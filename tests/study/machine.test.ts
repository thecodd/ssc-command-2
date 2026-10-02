import { initialState, reduce, elapsedAt, clockText, type MState } from "@/lib/study/sessionMachine";
import type { StudySession } from "@/types/curriculum";
const S = (o: Partial<StudySession> = {}): StudySession => ({ id: "s1", entity_type: "ssc_topic", entity_id: "e1", state: "active", started_at: "x", ended_at: null, seconds: 0, elapsed_seconds: 100, server_now: "x", ...o });
export default async function () {
  await t("machine: recovering -> running adopts server elapsed and says recovered", () => {
    const s = reduce(initialState(true), { t: "adopt", session: S(), at: 1000, source: "recover" });
    assert.equal(s.phase, "running"); assert.equal(s.baseElapsed, 100); assert.equal(s.notice?.kind, "recovered");
  });
  await t("machine: recover with nothing -> idle, no notice", () => {
    const s = reduce(initialState(true), { t: "adopt", session: null, at: 0, source: "recover" });
    assert.equal(s.phase, "idle"); assert.equal(s.notice, null);
  });
  await t("machine: elapsed = server base + monotonic delta, never negative, frozen when paused", () => {
    let s = reduce(initialState(false), { t: "adopt", session: S(), at: 5000, source: "op" });
    assert.equal(elapsedAt(s, 5000), 100); assert.equal(elapsedAt(s, 8500), 103); assert.equal(elapsedAt(s, 4000), 100);
    s = reduce(s, { t: "adopt", session: S({ state: "paused", elapsed_seconds: 130 }), at: 9000, source: "op" });
    assert.equal(elapsedAt(s, 99999), 130);
  });
  await t("machine: elapsed is capped at the 6h server maximum", () => {
    const s = reduce(initialState(false), { t: "adopt", session: S({ elapsed_seconds: 21590 }), at: 0, source: "op" });
    assert.equal(elapsedAt(s, 60000), 21600);
  });
  await t("machine: sync_lost freezes the display and the next server answer clears it", () => {
    let s = reduce(initialState(false), { t: "adopt", session: S(), at: 0, source: "op" });
    s = reduce(s, { t: "sync_lost", at: 4000 }); assert.equal(s.notice?.kind, "sync_lost"); assert.equal(elapsedAt(s, 90000), 104);
    s = reduce(s, { t: "adopt", session: S({ elapsed_seconds: 160 }), at: 91000, source: "heartbeat" });
    assert.equal(s.syncLostAt, null); assert.equal(s.notice, null); assert.equal(elapsedAt(s, 92000), 161);
  });
  await t("machine: session vanishing while running = ended elsewhere notice", () => {
    let s = reduce(initialState(false), { t: "adopt", session: S(), at: 0, source: "op" });
    s = reduce(s, { t: "adopt", session: null, at: 1, source: "heartbeat" });
    assert.equal(s.phase, "idle"); assert.equal(s.notice?.kind, "ended_elsewhere");
  });
  await t("machine: server says completed (other tab) / abandoned (stale) -> ended with the SAVED seconds", () => {
    const a = reduce(reduce(initialState(false), { t: "adopt", session: S(), at: 0, source: "op" }), { t: "adopt", session: S({ state: "completed", seconds: 1500 }), at: 1, source: "heartbeat" });
    assert.equal(a.phase, "ended"); assert.equal(a.ended?.seconds, 1500); assert.equal(a.ended?.byUs, false); assert.equal(a.notice?.kind, "ended_elsewhere");
    const b = reduce(initialState(true), { t: "adopt", session: S({ state: "abandoned", seconds: 700 }), at: 1, source: "recover" });
    assert.equal(b.ended?.state, "abandoned"); assert.equal(b.notice?.kind, "abandoned");
  });
  await t("machine: our own finished summary is final (a late 'no session' answer cannot erase it)", () => {
    let s = reduce(initialState(false), { t: "adopt", session: S(), at: 0, source: "op" });
    s = reduce(s, { t: "finished", session: S({ state: "completed", seconds: 1800 }), at: 5 });
    s = reduce(s, { t: "adopt", session: null, at: 6, source: "recover" });
    assert.equal(s.phase, "ended"); assert.equal(s.ended?.seconds, 1800);
    s = reduce(s, { t: "clear_ended" }); assert.equal(s.phase, "idle"); assert.equal(s.session, null);
  });
  await t("machine: failed recover while recovering leaves the UI usable (idle) with a retryable notice", () => {
    const s = reduce(initialState(true), { t: "fail", op: "recover", code: "network", message: "m" });
    assert.equal(s.phase, "idle"); assert.equal(s.notice?.retry, "recover");
  });
  await t("machine: clockText", () => { assert.equal(clockText(0), "00:00"); assert.equal(clockText(1458), "24:18"); assert.equal(clockText(3725), "1:02:05"); });
}
