import * as fs from "fs";
import * as path from "path";
import { groupQueue, queueCounts, startHere, nextDueAfter, dueText, whyText, ladderView, ladderLabel, previewLine, previewFor, nextReviewText, historyLine, RATING_COPY } from "@/lib/revision/queue";
import { initialRState, reduce, type RAction, type RState } from "@/lib/revision/machine";
import { createReviewController } from "@/lib/revision/controller";
import { parseReviewId, parseBackToReview, revisionHref } from "@/lib/revision/routes";
import { practiceForReviewHref, parseCount } from "@/lib/practice/routes";
import { summaryView } from "@/lib/practice/summary";
import { nextStep, type StepInput } from "@/lib/study/nextStep";
import { createFakeRevisionApi } from "@/tests/fixtures/fakeRevisionApi";
import type { QueueRow } from "@/types/revision";
declare const require: any;
const root = path.join(__dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const U = "11111111-1111-4111-8111-111111111111";
const row = (o: Partial<QueueRow> & { bucket: QueueRow["bucket"] }): QueueRow => ({ schedule_id: "s" + Math.random(), entity_type: "ssc_topic", entity_id: "e", title: "T", due_date: "2026-10-01", step: 0, reason: "completion", days_overdue: 0, days_until: 0, mastery: "learning", weak_reason: null,
  confidence: null, completion: 100, last_studied_at: null, pyq_count: 0, pyq_attempts: 0, pyq_recent_accuracy: null, reviews_done: 0, last_ratings: [], ladder: [1, 3, 7, 15, 30], today: "2026-10-01", rank: 1, ...o });

function rig(opts: Parameters<typeof createFakeRevisionApi>[0] = {}, step = 0) {
  const api = createFakeRevisionApi({ step, ...opts });
  let state: RState = initialRState(step); let refreshes = 0;
  const ctl = createReviewController({ api, scheduleId: "fixture-schedule", type: "ssc_topic", id: "fixture-entity", getState: () => state, dispatch: (a: RAction) => { state = reduce(state, a); }, refresh: () => { refreshes++; } });
  return { api, ctl, get s() { return state; }, set(a: RAction) { state = reduce(state, a); }, get refreshes() { return refreshes; } };
}
const ready = (r: ReturnType<typeof rig>, pick: "hard" | "good" | "easy" = "good") => { r.set({ t: "reveal" }); r.set({ t: "pick", r: pick }); };

export default async function () {
  // ---------------- queue presentation (order is the server's) ----------------
  await t("queue: grouping keeps the server's order inside each bucket and drops nothing", () => {
    const rows = [row({ bucket: "overdue", title: "A" }), row({ bucket: "today", title: "B" }), row({ bucket: "overdue", title: "C" }), row({ bucket: "upcoming", title: "D" })];
    const g = groupQueue(rows); assert.deepEqual(g.overdue.map((r) => r.title), ["A", "C"]); assert.deepEqual(g.today.map((r) => r.title), ["B"]); assert.deepEqual(g.upcoming.map((r) => r.title), ["D"]);
    assert.equal(g.overdue.length + g.today.length + g.upcoming.length, rows.length);
    assert.deepEqual(queueCounts(rows), { overdue: 2, today: 1, upcoming: 1, due: 3 });
  });
  await t("queue: 'start here' is the FIRST due row in server order; upcoming-only means nothing to start", () => {
    const rows = [row({ bucket: "overdue", title: "first" }), row({ bucket: "today", title: "second" })];
    assert.equal(startHere(rows)!.title, "first"); assert.equal(startHere([row({ bucket: "upcoming" })]), null); assert.equal(startHere([]), null);
    assert.equal(nextDueAfter(rows, rows[0].schedule_id)!.title, "second"); assert.equal(nextDueAfter([rows[0]], rows[0].schedule_id), null);
  });
  await t("queue: UI never sorts (the helpers contain no sort call; the page contains none either)", () => {
    assert.doesNotMatch(read("lib/revision/queue.ts"), /\.sort\(|toSorted\(/); assert.doesNotMatch(read("app/(app)/revision/page.tsx"), /\.sort\(|toSorted\(/);
    assert.doesNotMatch(read("services/revision.ts"), /\.sort\(|toSorted\(/);
  });
  await t("queue: overdue/today/upcoming labels and 'why it is here' come from server fields", () => {
    assert.equal(dueText(row({ bucket: "overdue", days_overdue: 2 })), "Overdue by 2 days"); assert.equal(dueText(row({ bucket: "overdue", days_overdue: 1 })), "Overdue by 1 day");
    assert.equal(dueText(row({ bucket: "today" })), "Due today"); assert.equal(dueText(row({ bucket: "upcoming", days_until: 1 })), "Due tomorrow"); assert.match(dueText(row({ bucket: "upcoming", days_until: 5, due_date: "2026-10-06" })), /^Due /);
    assert.match(whyText(row({ bucket: "today", mastery: "weak", weak_reason: "hard_streak" })), /Hard review twice/);
    assert.match(whyText(row({ bucket: "today", mastery: "weak", weak_reason: "low_accuracy", pyq_attempts: 10, pyq_recent_accuracy: 30 })), /Weak PYQ performance \(30%/);
    assert.equal(whyText(row({ bucket: "today", reason: "weakness" })), "Weak PYQ performance"); assert.equal(whyText(row({ bucket: "today", reason: "manual" })), "You asked to revise this");
    assert.equal(whyText(row({ bucket: "today", reviews_done: 0 })), "First review after completing it"); assert.equal(whyText(row({ bucket: "today", reviews_done: 3 })), "Scheduled review");
  });
  await t("queue: empty state is real (no rows -> nothing to start, zero counts)", () => { assert.equal(startHere([]), null); assert.deepEqual(queueCounts([]), { overdue: 0, today: 0, upcoming: 0, due: 0 }); });

  // ---------------- ladder + preview: the user's own numbers ----------------
  await t("ladder: shows the USER's ladder with done/current/todo, default and customised", () => {
    assert.equal(ladderLabel(ladderView([1, 3, 7, 15, 30], 2)), "1 day done, 3 days done, 7 days current, 15 days, 30 days");
    assert.deepEqual(ladderView([2, 5, 20], 1).map((s) => [s.days, s.state]), [[2, "done"], [5, "current"], [20, "todo"]]);
    assert.deepEqual(ladderView([2, 5, 20], 3).map((s) => s.state), ["done", "done", "done"]);       // graduated
    assert.deepEqual(ladderView([], 0), []);
  });
  await t("preview: intervals shown are whatever the server (oracle here) returned for THIS ladder; no 1/3/7/15/30 constants in the components", async () => {
    const custom = createFakeRevisionApi({ ladder: [2, 5, 20], step: 1 }); const st = (await custom.state("fixture-schedule")); assert.ok(st.ok);
    const p = (st as any).data.preview;
    assert.match(previewLine(previewFor(p, "hard")), /in 2 days/); assert.match(previewLine(previewFor(p, "good")), /in 20 days/); assert.match(previewLine(previewFor(p, "easy")), /ladder complete/);
    for (const f of ["components/revision/RatingControls.tsx", "components/revision/ReviewRunner.tsx", "components/revision/ResultView.tsx", "components/revision/LadderStrip.tsx", "lib/revision/queue.ts", "lib/revision/machine.ts", "lib/revision/controller.ts"])
      assert.doesNotMatch(read(f).replace(/\/\/.*$/gm, ""), /\b(1|3|7|15|30)\s*,\s*(3|7|15|30)\b/, f);
  });
  await t("preview: services call revision_next() and the client never computes a date/interval", () => {
    const svc = read("services/revision.ts"); assert.match(svc, /rpc\("revision_next"/); assert.match(svc, /rpc\("lc_default_ladder"/);
    for (const f of ["components/revision/ReviewRunner.tsx", "components/revision/RatingControls.tsx", "components/revision/ResultView.tsx", "lib/revision/machine.ts", "lib/revision/controller.ts"]) assert.doesNotMatch(read(f), /Date\.now\(|new Date\(|setDate\(|addDays/, f);
    assert.match(nextReviewText({ graduated: false, intervalDays: 3, dueDate: "2026-10-04" }), /^in 3 days/); assert.equal(nextReviewText({ graduated: true, intervalDays: null, dueDate: null }), "ladder complete");
  });

  // ---------------- rating copy / states ----------------
  await t("rating: Hard/Good/Easy wording is spelled out (meaning does not depend on colour) and Hard explains the consequence", () => {
    assert.equal(RATING_COPY.hard.meaning, "I struggled or couldn't recall"); assert.equal(RATING_COPY.good.meaning, "I remembered with some effort"); assert.equal(RATING_COPY.easy.meaning, "I recalled this confidently");
    assert.equal(RATING_COPY.hard.consequence, "Let's bring this back sooner.");
    const c = read("components/revision/RatingControls.tsx"); assert.match(c, /type="radio"/); assert.match(c, /Selected/); assert.match(c, /min-h-\[72px\]/);
  });
  await t("history line: date, rating and what it set next", () => {
    assert.match(historyLine({ reviewed_on: "2026-09-28", rating: "good", interval_days_after: 7, graduated: false }), /Good, next in 7d/); assert.match(historyLine({ reviewed_on: "2026-09-28", rating: "easy", interval_days_after: null, graduated: true }), /ladder complete/);
  });

  // ---------------- review machine ----------------
  await t("machine: recall comes first. Nothing can be picked or submitted before the material is revealed", () => {
    let s = initialRState(2); s = reduce(s, { t: "pick", r: "good" }); assert.equal(s.picked, null); assert.equal(s.phase, "recall"); assert.equal(reduce(s, { t: "submitting" }).phase, "recall");
    s = reduce(s, { t: "reveal" }); assert.equal(s.phase, "material"); s = reduce(s, { t: "pick", r: "hard" }); assert.equal(s.picked, "hard");
  });
  await t("machine: cannot submit without a rating; stale/fail/dismiss transitions", () => {
    let s = reduce(initialRState(0), { t: "reveal" }); assert.equal(reduce(s, { t: "submitting" }).phase, "material");
    s = reduce(reduce(s, { t: "pick", r: "easy" }), { t: "submitting" }); assert.equal(s.phase, "submitting");
    const f = reduce(s, { t: "fail", code: "network", message: "m" }); assert.equal(f.phase, "error"); assert.equal(reduce(f, { t: "dismiss" }).phase, "material"); assert.equal(reduce(f, { t: "dismiss" }).picked, "easy");
    const st = reduce(s, { t: "stale", fresh: null, message: "x" }); assert.equal(st.phase, "stale"); assert.equal(st.picked, null);
  });

  // ---------------- controller: duplicates, stale, two tabs ----------------
  await t("review: Good -> server result (next date, graduated=false), ONE call, refresh once", async () => {
    const r = rig({}, 1); ready(r); await r.ctl.submit();
    assert.equal(r.s.phase, "done"); assert.equal(r.s.outcome!.intervalDays, 7); assert.equal(r.s.outcome!.dueDate, "2099-01-17");   // step 1 + good = step 2 = 7 days on 1-3-7-15-30 assert.equal(r.api.control.submits().length, 1); assert.equal(r.refreshes, 1);
    assert.equal(r.api.control.submits()[0].expectedStep, 1);
  });
  await t("review: Easy skips a step; Hard steps back and uses the SHORTEST interval; neither resets history (step floor 0)", async () => {
    const e = rig({}, 1); ready(e, "easy"); await e.ctl.submit(); assert.equal(e.s.outcome!.step, 3); assert.equal(e.s.outcome!.intervalDays, 15);
    const h = rig({}, 2); ready(h, "hard"); await h.ctl.submit(); assert.equal(h.s.outcome!.step, 1); assert.equal(h.s.outcome!.intervalDays, 1);
    const z = rig({}, 0); ready(z, "hard"); await z.ctl.submit(); assert.equal(z.s.outcome!.step, 0);
  });
  await t("review: customised ladder is honoured end-to-end (intervals and graduation)", async () => {
    const r = rig({ ladder: [2, 5, 20] }, 1); ready(r, "good"); await r.ctl.submit(); assert.equal(r.s.outcome!.intervalDays, 20);
    const g = rig({ ladder: [2, 5, 20] }, 2); ready(g, "good"); await g.ctl.submit(); assert.equal(g.s.outcome!.graduated, true); assert.equal(g.s.outcome!.dueDate, null);
  });
  await t("review: graduation is reported, the item is not removed from learning (no extra graduation logic client-side)", async () => {
    const r = rig({}, 4); ready(r, "good"); await r.ctl.submit(); assert.equal(r.s.outcome!.graduated, true);
    assert.equal(nextReviewText({ graduated: true, intervalDays: null, dueDate: null }), "ladder complete"); assert.match(read("components/revision/ResultView.tsx"), /stays in your study list/);
  });
  await t("review: double click / double tap / Enter-repeat sends ONE request", async () => {
    const r = rig({ latencyMs: 5 }); ready(r); await Promise.all([r.ctl.submit(), r.ctl.submit(), r.ctl.submit()]); assert.equal(r.api.control.submits().length, 1); assert.equal(r.s.phase, "done");
  });
  await t("review: second tab already reviewed -> 'already updated elsewhere', fresh state shown, nothing overwritten", async () => {
    const r = rig({}, 1); ready(r); r.api.control.otherTabReviews("good");           // another tab got there first (step is now 2)
    await r.ctl.submit(); assert.equal(r.s.phase, "stale"); assert.equal(r.s.notice, "This revision was already updated elsewhere."); assert.equal(r.s.fresh!.step, 2); assert.equal(r.api.control.reviews(), 1); assert.equal(r.refreshes, 1);
  });
  await t("review: stale page after the ladder finished elsewhere -> stale with done=true", async () => {
    const r = rig({}, 4); ready(r); r.api.control.otherTabReviews("good"); await r.ctl.submit(); assert.equal(r.s.phase, "stale"); assert.equal(r.s.fresh!.done, true);
  });
  await t("review: a response lost AFTER the write landed is detected by re-reading (no second review)", async () => {
    const r = rig({}, 1); ready(r); r.api.control.landThenFail("timeout"); await r.ctl.submit();
    assert.equal(r.s.phase, "stale"); assert.match(r.s.notice!, /saved/); assert.equal(r.api.control.reviews(), 1);
  });
  await t("review: a plain network failure keeps the rating and offers retry; retry succeeds once", async () => {
    const r = rig({}, 0); ready(r, "good"); r.api.control.failNext("network"); await r.ctl.submit();
    assert.equal(r.s.phase, "error"); await r.ctl.retry(); assert.equal(r.s.phase, "done"); assert.equal(r.api.control.reviews(), 1);
  });

  // ---------------- routes ----------------
  await t("routes: review id must be a uuid; 'back' is whitelisted to /revision/<uuid> only; count is 1..50", () => {
    assert.equal(parseReviewId(U), U); assert.equal(parseReviewId("nope"), null); assert.equal(parseReviewId(undefined), null);
    assert.equal(parseBackToReview(`/revision/${U}`), `/revision/${U}`); for (const bad of ["https://evil.test", "//evil.test", "/revision/abc", `/revision/${U}/x`, `/study/ssc_topic/${U}`, "", null, undefined]) assert.equal(parseBackToReview(bad as any), null, String(bad));
    assert.equal(parseCount("5"), 5); assert.equal(parseCount("0"), null); assert.equal(parseCount("51"), null); assert.equal(parseCount("x"), null);
    assert.equal(revisionHref(U), `/revision/${U}`);
  });
  await t("PYQ mini-session: link carries 5 questions and a safe way back; summary's ONE primary action returns to the revision", () => {
    const h = practiceForReviewHref("ssc_topic", U, revisionHref(U)); assert.match(h, /scope=ssc_topic/); assert.match(h, /count=5/); assert.match(h, new RegExp(`back=/revision/${U}`));
    const summary: any = { id: "x", state: "completed", scope_type: "ssc_topic", scope_id: U, total: 5, attempted: 5, correct: 2, incorrect: 3, accuracy: 40, seconds: 90, weak_topics: [{ topic_id: U, title: "Weak", accuracy: 20, attempts: 5 }], revision: null };
    const v = summaryView(summary, { href: `/revision/${U}`, label: "Back to revision" }, true);
    assert.equal(v.primary.label, "Back to revision"); assert.equal(v.primary.href, `/revision/${U}`);
    const plain = summaryView(summary, { href: "/study", label: "Back to Study" }, false); assert.equal(plain.primary.label, "Review weak areas");
  });

  // ---------------- Study Mode integration ----------------
  await t("study mode: due/overdue revision -> ONE primary action 'Review' to the review route (before and after studying); no inline rating remains", () => {
    const base: StepInput = { phase: "idle", mastery: "needs_revision", completion: 100, revision: { state: "due", scheduleId: U, step: 1, dueDate: "2026-10-01", daysUntil: 0, reason: "completion" }, pyq: { total: 0, attempted: 0, accuracyPct: null }, practiceHref: null, foundation: { unfinished: 0, href: null }, upNext: null };
    for (const phase of ["idle", "ended"] as const) { const s = nextStep({ ...base, phase }); assert.equal(s.cta.kind, "link"); assert.equal((s.cta as any).href, `/revision/${U}`); assert.equal((s.cta as any).label, "Review"); }
    assert.equal(nextStep({ ...base, revision: { ...base.revision, state: "overdue", daysUntil: -2 } }).title, "Revision overdue");
    assert.equal(fs.existsSync(path.join(root, "components/study/RatingStrip.tsx")), false);
    for (const f of fs.readdirSync(path.join(root, "components/study"))) assert.doesNotMatch(read("components/study/" + f), /RatingStrip|reviewRevision|progress\.rate/, f);
  });
  await t("study mode: studying/finishing never touches the ladder; scheduled state is shown, 'schedule' only when none", () => {
    assert.doesNotMatch(read("lib/study/controller.ts") + read("services/study.ts") + read("app/actions/study.ts"), /review_revision|reviewRevision/);
    const card = read("components/study/RevisionCard.tsx"); assert.match(card, /revision\.state === "none"/); assert.match(card, /Review early/); assert.match(card, /LadderStrip/); assert.match(card, /RevisionHistory/);
  });
  await t("dashboard + daily focus: counts and 'start' come from revision_queue(); focus logic is not duplicated in TS", () => {
    const d = read("services/dashboard.ts"); assert.match(d, /getRevisionQueue/); assert.match(d, /startHere/); assert.doesNotMatch(d, /\.sort\(|overdue_revision|due_revision/);
    const page = read("app/(app)/dashboard/page.tsx"); assert.match(page, /Start revision/); assert.match(page, /You&apos;re caught up/); assert.doesNotMatch(page, /dueRevisions/);
    const sql = read("database/migrations/010_learning_signals.sql"); assert.match(sql, /'overdue_revision'/); assert.match(sql, /'due_revision'/);
  });
  await t("empty states: queue page offers a next action (study / practice) and has no blank dead end", () => {
    const p = read("app/(app)/revision/page.tsx"); assert.match(p, /You&apos;re caught up\./); assert.match(p, /Study a topic/); assert.match(p, /Practice PYQs/); assert.match(p, /No revisions yet/);
  });

  // ---------------- server-side contract + mobile structure ----------------
  await t("contract: RPC names/args used by services/revision.ts match the SQL (revision_queue, revision_next, review_revision, schedule_revision, lc_default_ladder)", () => {
    const sql = ["008_revision_engine.sql", "013_revision_queue.sql", "005_integrity_indexes.sql"].map((f) => read("database/migrations/" + f)).join("\n");
    assert.match(sql, /function public\.revision_next\(p_step int, p_rating text, p_ladder int\[\], p_today date\)/); assert.match(sql, /function public\.revision_queue\(\)/);
    assert.match(sql, /function public\.review_revision\(p_schedule uuid, p_rating text, p_expected_step int, p_confidence int/); assert.match(sql, /function public\.lc_default_ladder\(\)/);
    const svc = read("services/revision.ts"); assert.match(svc, /p_schedule: scheduleId, p_rating: rating, p_expected_step: expectedStep, p_confidence/); assert.match(svc, /p_step: step, p_rating: r, p_ladder: ladder, p_today: today/);
  });
  await t("013_revision_queue.sql: read-only INVOKER, ordering = bucket > oldest due > weak > lower mastery; registered in the privilege matrix", () => {
    const s = read("database/migrations/013_revision_queue.sql").replace(/--.*$/gm, "");
    assert.match(s, /security invoker/); assert.doesNotMatch(s, /security definer/); assert.doesNotMatch(s, /\b(insert|update|delete)\b\s/i);
    assert.match(s, /case q\.bk when 'overdue' then 0 when 'today' then 1 else 2 end, q\.due, \(q\.ms = 'weak'\) desc/);
    assert.match(read("database/security/function_matrix.js"), /revision_queue:/); assert.match(read("database/migrations/014_function_privileges.sql"), /revision_queue/);
  });
  await t("review runner: the controller's identity does not depend on the router object (a re-created controller would drop an in-flight result)", () => {
    const r = read("components/revision/ReviewRunner.tsx"); const m = /createReviewController\(\{[\s\S]*?\}\), \[([^\]]*)\]\)/.exec(r);
    assert.ok(m, "useMemo deps not found"); assert.doesNotMatch(m![1], /router/); assert.match(r, /routerRef\.current\.refresh\(\)/);
  });
  await t("mobile structure: review action area is fixed + safe-area on phones, 44px+ targets, no horizontal overflow guards, details in a bottom sheet", () => {
    const r = read("components/revision/ReviewRunner.tsx"); assert.match(r, /fixed inset-x-0 bottom-0/); assert.match(r, /pb-\[env\(safe-area-inset-bottom\)\]/); assert.match(r, /lg:static/); assert.match(r, /pb-36/); assert.match(r, /<Sheet open=\{details\}/);
    assert.match(r, /pt-\[env\(safe-area-inset-top\)\]/); assert.match(r, /break-words/); assert.match(r, /lg:grid-cols-\[minmax\(0,1fr\)_300px\]/); assert.match(r, /min-w-0/); assert.match(r, /aria-keyshortcuts="Escape"/);
    assert.match(read("components/revision/RatingControls.tsx"), /grid gap-2 sm:grid-cols-3/);
    const q = read("app/(app)/revision/page.tsx"); assert.match(q, /btn-primary/); assert.match(q, /break-words/);
  });
}
