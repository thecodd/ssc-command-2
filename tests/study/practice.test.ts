import { buildStartRequest, availableFilters, DEFAULT_COUNT } from "@/lib/practice/config";
import { parseNewParams, parseSessionId, practiceNewHref } from "@/lib/practice/routes";
import { firstUnanswered, initialPState, isLast, reduce, type PAction, type PState } from "@/lib/practice/machine";
import { createPracticeController } from "@/lib/practice/controller";
import { summaryView } from "@/lib/practice/summary";
import { createFakePracticeApi, SAMPLE_QUESTIONS } from "@/tests/fixtures/fakePracticeApi";
import type { PracticeOptions, PracticeSummary, StartRequest } from "@/types/practice";
import * as fs from "fs";
import * as path from "path";
const U = "11111111-1111-4111-8111-111111111111";
const opts = (o: Partial<PracticeOptions> = {}): PracticeOptions => ({ total: 30, by_difficulty: { easy: 10, medium: 15, hard: 5 }, papers: [], ...o });
const REQ: StartRequest = { scope: "ssc_topic", scopeId: U, count: 10, difficulty: null, paper: null };
async function rig(user = "A", shared?: ReturnType<typeof createFakePracticeApi>) {
  const api = shared ?? createFakePracticeApi(SAMPLE_QUESTIONS, { user });
  const started = await api.start({ ...REQ, count: 4 }); if (!started.ok) throw new Error("start failed");
  let state: PState = initialPState(started.data); let clock = 0;
  const log: PAction[] = [];
  const mk = () => createPracticeController({ api, getState: () => state, dispatch: (a) => { log.push(a); state = reduce(state, a); }, now: () => clock });
  return { api, ctl: mk(), mk, get state() { return state; }, set state(v: PState) { state = v; }, tick: (ms: number) => { clock += ms; }, log, id: started.data.id };
}
const summary = (o: Partial<PracticeSummary> = {}): PracticeSummary => ({ session_id: "s", state: "completed", scope_type: "ssc_topic", scope_id: U, planned: 10, attempted: 10, correct: 6, incorrect: 4, skipped: 0, accuracy: 60, total_seconds: 754, avg_seconds: 75, weak_topics: [], ...o });

export default async function () {
  await t("config: default count, count clamped to what exists, unavailable filters are ignored", () => {
    assert.equal(buildStartRequest("ssc_topic", U, opts()).count, DEFAULT_COUNT);
    assert.equal(buildStartRequest("ssc_topic", U, opts({ total: 4, by_difficulty: { easy: 4 } }), { count: 20 }).count, 4);
    assert.equal(buildStartRequest("ssc_topic", U, opts({ by_difficulty: { easy: 3 } }), { difficulty: "hard" }).difficulty, null);
    assert.equal(buildStartRequest("ssc_topic", U, opts({ by_difficulty: { easy: 3 } }), { difficulty: "easy", count: 20 }).count, 3);
    assert.equal(buildStartRequest("ssc_topic", U, opts({ papers: [{ id: "p1", exam: "x", year: 2020, tier: null, shift: null, n: 6 }] }), { paper: "nope" }).paper, null);
    assert.equal(buildStartRequest("ssc_topic", U, opts(), { count: 7 }).count, DEFAULT_COUNT);                       // only the offered counts
  });
  await t("config: only filters that would change the question set are offered (no filter sprawl)", () => {
    const none = availableFilters(opts({ total: 8, by_difficulty: { medium: 8 }, papers: [] }));
    assert.deepEqual([none.difficulties.length, none.papers.length, none.counts.length], [0, 0, 1]);   // single difficulty, no papers; only 5 < 8 is a real choice
    assert.equal(availableFilters(opts()).difficulties.length, 3);
  });
  await t("routes: scope/id whitelist, ids required exactly where needed, session id must be a uuid", () => {
    assert.deepEqual(parseNewParams({ scope: "ssc_topic", id: U }), { scope: "ssc_topic", id: U });
    assert.deepEqual(parseNewParams({ scope: "weak" }), { scope: "weak", id: null });
    for (const bad of [{ scope: "ssc_topic" }, { scope: "ssc_topic", id: "x" }, { scope: "weak", id: U }, { scope: "bogus", id: U }, {}]) assert.equal(parseNewParams(bad as any), null);
    assert.equal(parseSessionId("nope"), null); assert.equal(parseSessionId(U), U); assert.equal(practiceNewHref("ssc_topic", U), `/practice/new?scope=ssc_topic&id=${U}`);
  });
  await t("ordering: the session keeps the server's question order and the flow follows it", async () => {
    const r = await rig(); const order = r.state.session.pyq_ids; assert.equal(order.length, 4);
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) { await (i === 0 ? r.ctl.load() : r.ctl.next()); seen.push(r.state.question!.pyq_id); r.state = reduce(r.state, { t: "pick", key: "A" }); await r.ctl.submit(); }
    assert.deepEqual(seen, order); assert.equal(r.state.session.answered.length, 4);
  });
  await t("ordering: refresh resumes at the first unanswered question in the server's order", async () => {
    const r = await rig(); await r.ctl.load(); r.state = reduce(r.state, { t: "pick", key: "A" }); await r.ctl.submit();   // answer #1
    const fresh = await r.api.state(r.id); if (!fresh.ok) throw new Error("state");
    assert.equal(firstUnanswered(fresh.data), 1);
    let st = initialPState(fresh.data); const ctl2 = createPracticeController({ api: r.api, getState: () => st, dispatch: (a) => { st = reduce(st, a); }, now: () => 0 });
    await ctl2.load(); assert.equal(st.index, 1); assert.equal(st.question!.pyq_id, fresh.data.pyq_ids[1]); assert.equal(st.phase, "ready");
  });
  await t("transitions: pick only while ready; submit needs a pick; nothing changes after answering; summary is final", async () => {
    const r = await rig(); await r.ctl.load();
    let s = reduce(r.state, { t: "submitting" }); assert.equal(s.phase, "ready");                                 // no pick -> cannot submit
    s = reduce(s, { t: "pick", key: "B" }); assert.equal(s.picked, "B"); s = reduce(s, { t: "submitting" }); assert.equal(s.phase, "submitting");
    s = reduce(s, { t: "pick", key: "C" }); assert.equal(s.picked, "B");                                           // locked while submitting
    r.state = reduce(r.state, { t: "pick", key: "B" }); await r.ctl.submit(); assert.equal(r.state.phase, "answered");
    assert.equal(reduce(r.state, { t: "pick", key: "A" }).picked, r.state.picked);
    const done = reduce(r.state, { t: "summary", s: summary() }); assert.equal(done.phase, "summary");
    assert.equal(reduce(done, { t: "loaded", q: r.state.question!, at: 0 }).phase, "summary");
  });
  await t("answer secrecy: before submit the payload has no key/explanation; after submit the server returns them", async () => {
    const r = await rig(); await r.ctl.load(); const q = r.state.question!;
    assert.equal(q.answer, null); assert.equal(q.topics, null); assert.equal(q.foundation, null);
    const raw = JSON.stringify(q); assert.doesNotMatch(raw, /correct_answer|explanation|is_correct/);
    r.state = reduce(r.state, { t: "pick", key: "A" }); await r.ctl.submit();
    assert.equal(r.state.phase, "answered"); assert.equal(r.state.result!.correct_answer, "B"); assert.match(String(r.state.result!.explanation), /Fixture explanation/);
    assert.equal(r.state.result!.is_correct, false);
  });
  await t("answer secrecy: reloading an answered question shows the saved answer (server snapshot), not a fresh question", async () => {
    const r = await rig(); await r.ctl.load(); r.state = reduce(r.state, { t: "pick", key: "B" }); await r.ctl.submit();
    await r.ctl.load(0); assert.equal(r.state.phase, "answered"); assert.equal(r.state.result!.is_correct, true);
  });
  await t("duplicate submission: double click = one request; a second server call returns the ORIGINAL result", async () => {
    const r = await rig(); await r.ctl.load(); r.state = reduce(r.state, { t: "pick", key: "A" });
    await Promise.all([r.ctl.submit(), r.ctl.submit(), r.ctl.submit()]); assert.equal(r.api.control.submitCalls(), 1);
    const pyq = r.state.question!.pyq_id;
    const again = await r.api.submit(r.id, pyq, "B", 3);                        // a second tab choosing differently
    assert.ok(again.ok && again.data.duplicate === true && again.data.selected === "A" && again.data.is_correct === false);
  });
  await t("forgery/isolation: other user, foreign question, invalid option, ended session are all rejected", async () => {
    const r = await rig(); await r.ctl.load(); const pyq = r.state.question!.pyq_id;
    const bad = async (p: Promise<any>, code: string) => { const x = await p; assert.ok(!x.ok && x.code === code, `expected ${code}, got ${JSON.stringify(x).slice(0, 80)}`); };
    await bad(r.api.submit(r.id, pyq, "Z", 1), "invalid");
    await bad(r.api.submit(r.id, "99999999-9999-4999-8999-999999999999", "A", 1), "invalid");
    await bad(r.api.question(r.id, "99999999-9999-4999-8999-999999999999"), "invalid");
    r.api.control.asUser("B"); await bad(r.api.submit(r.id, pyq, "B", 1), "not_found"); await bad(r.api.question(r.id, pyq), "not_found"); await bad(r.api.state(r.id), "not_found"); await bad(r.api.finish(r.id), "not_found");
    r.api.control.asUser("A"); await r.api.finish(r.id); await bad(r.api.submit(r.id, pyq, "B", 1), "ended");
  });
  await t("errors: timeout on submit -> error + reconcile finds the answer that LANDED; network down -> retryable", async () => {
    const r = await rig(); await r.ctl.load(); const pyq = r.state.question!.pyq_id;
    r.state = reduce(r.state, { t: "pick", key: "B" }); await r.api.submit(r.id, pyq, "B", 2);               // landed on the server...
    r.api.control.failNext("timeout", "submit"); await r.ctl.submit();                                        // ...client saw a timeout
    assert.equal(r.state.phase, "answered"); assert.equal(r.state.result!.is_correct, true);
    const q2 = await rig(); await q2.ctl.load(); q2.state = reduce(q2.state, { t: "pick", key: "A" });
    q2.api.control.setNetworkDown(true); await q2.ctl.submit(); assert.equal(q2.state.phase, "error"); assert.equal(q2.state.error!.retry, "submit");
    q2.api.control.setNetworkDown(false); await q2.ctl.retry(); assert.equal(q2.state.phase, "answered");
  });
  await t("errors: question load failure is retryable; unknown session maps to not_found without leaking text", async () => {
    const r = await rig(); r.api.control.failNext("network", "question"); await r.ctl.load(); assert.equal(r.state.phase, "error"); assert.equal(r.state.error!.retry, "load");
    await r.ctl.retry(); assert.equal(r.state.phase, "ready");
    const x = await r.api.state("nope"); assert.ok(!x.ok && !/relation|violates|pg_/.test(x.error));
  });
  await t("summary: numbers are the SERVER's (never recomputed), time formatted, skipped noted, finish is idempotent", async () => {
    const r = await rig(); await r.ctl.load(); r.state = reduce(r.state, { t: "pick", key: "B" }); await r.ctl.submit(); await r.ctl.finish();
    assert.equal(r.state.phase, "summary"); const s1 = r.state.summary!; assert.equal(s1.attempted, 1); assert.equal(s1.skipped, 3);
    const again = await r.api.finish(r.id); assert.ok(again.ok && JSON.stringify(again.data) === JSON.stringify(s1));
    const v = summaryView(summary({ accuracy: 99, correct: 1, attempted: 10, incorrect: 9 }), { href: "/b", label: "Back to Study" });
    assert.equal(v.stats.find((x) => x.label === "Accuracy")!.value, "99%");                                      // shown as sent, not 10%
    assert.equal(v.stats.find((x) => x.label === "Time")!.value, "12m"); assert.equal(summaryView(summary({ accuracy: null, attempted: 0, correct: 0, incorrect: 0, skipped: 10, total_seconds: 0 }), { href: "/b", label: "x" }).stats[3].value, "—");
    assert.match(summaryView(summary({ skipped: 2, attempted: 8 }), { href: "/b", label: "x" }).incomplete!, /2 questions not answered/);
  });
  await t("summary: weak topics drive ONE primary CTA (Review weak areas); otherwise back to study; practice again is secondary", () => {
    const w = summaryView(summary({ weak_topics: [{ topic_id: U, title: "Fixture Topic", weak_reason: "low_accuracy", recent_accuracy: 33 }] }), { href: "/study/ssc_topic/x", label: "Back to Study" });
    assert.equal(w.primary.label, "Review weak areas"); assert.equal(w.primary.href, `/study/ssc_topic/${U}`); assert.deepEqual(w.secondary.map((x) => x.label), ["Practice again", "Back to Study"]); assert.match(w.revisionNote!, /revision is queued/);
    const n = summaryView(summary(), { href: "/study/ssc_topic/x", label: "Back to Study" });
    assert.equal(n.primary.label, "Back to Study"); assert.equal(n.secondary[0].label, "Practice again"); assert.equal(n.revisionNote, null);
    assert.equal(n.secondary[0].href, `/practice/new?scope=ssc_topic&id=${U}`);
  });
  await t("flow: isLast only when every question has an attempt; finishing a session with all answered goes to the summary", async () => {
    const r = await rig(); for (let i = 0; i < 4; i++) { await (i === 0 ? r.ctl.load() : r.ctl.next()); assert.equal(isLast(r.state), false); r.state = reduce(r.state, { t: "pick", key: "A" }); await r.ctl.submit(); }
    assert.equal(isLast(r.state), true); await r.ctl.next(); assert.equal(r.state.phase, "summary"); assert.equal(r.state.summary!.attempted, 4);
  });
  await t("server authority (static): no client code or action sends or computes correctness", () => {
    const root = path.join(__dirname, "../..");
    const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
    const svc = read("services/practice.ts"), act = read("app/actions/practice.ts"), api = read("lib/practice/api.ts");
    for (const [n, s] of [["service", svc], ["actions", act], ["api", api]] as const) assert.doesNotMatch(s.replace(/\/\/.*$/gm, ""), /p_correct|is_correct\s*[:=]|correct\s*:/, n + " must not carry a correctness parameter");
    for (const f of ["lib/practice/machine.ts", "lib/practice/controller.ts", "lib/practice/summary.ts", "components/practice/PracticeRunner.tsx", "components/practice/QuestionView.tsx"]) {
      const s = read(f).replace(/\/\/.*$/gm, ""); assert.doesNotMatch(s, /\.accuracy\s*=(?!=)|accuracy\s*=\s*Math|Math\.round\(\s*100/, f + " must not compute accuracy");
    }
  });

  await t("enrich: after submit the concept/topic are fetched once (they only exist server-side after the answer) without touching the result", async () => {
    const r = await rig(); await r.ctl.load();
    assert.equal(r.state.question!.topics, null);                                    // before answering: nothing that could hint at the answer
    const before = r.state.question!; r.ctl.activate();
    await Promise.resolve(); r.state = reduce(r.state, { t: "pick", key: Object.keys(before.options)[0] });
    await r.ctl.submit();
    assert.equal(r.state.phase, "answered"); assert.ok(r.state.question!.topics && r.state.question!.topics.length > 0);
    assert.equal(r.state.result!.duplicate, false);                                  // "enriched" must not turn a fresh result into a duplicate
    assert.equal(r.log.filter((a) => a.t === "enriched").length, 1);
  });
  await t("enrich: ignored unless the same question is answered (late response for an old question cannot overwrite the screen)", async () => {
    const r = await rig(); await r.ctl.load(); const q = r.state.question!;
    const stale = reduce(r.state, { t: "enriched", q: { ...q, answer: { selected: "A", is_correct: true, correct_answer: "A", explanation: null, time_taken_seconds: 1 }, topics: [{ id: "x", title: "x" }] } });
    assert.equal(stale.question!.topics, null);                                      // phase is "ready", so no enrichment
  });
}
