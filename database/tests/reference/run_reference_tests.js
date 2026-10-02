// Executable checks: (1) oracle behaves as designed, (2) TS config mirrors SQL constants, (3) emits vectors for SQL.
const assert = require("assert"), fs = require("fs"), path = require("path");
const O = require("./learning_oracle.js");
let n = 0; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const base = { status: "not_started", completion: 0, confidence: null, sessions: 0, attempts: 0, recentAcc: null, due: null, today: "2026-10-01", ratings: [], reviewsDone: 0, ladderComplete: false };
const M = (o) => O.mastery({ ...base, ...o });
const vectors = [
  ["untouched", {}, "not_started"], ["started via status", { status: "learning" }, "in_progress"], ["completion only", { completion: 30 }, "in_progress"], ["one session", { sessions: 1 }, "in_progress"],
  ["first pass only", { status: "completed", completion: 100 }, "learning"], ["confidence alone is not strong", { status: "completed", completion: 100, confidence: 5 }, "learning"],
  ["practice proves strong", { status: "completed", completion: 100, attempts: 8, recentAcc: 80, confidence: 3 }, "strong"],
  ["good accuracy, low confidence", { status: "completed", completion: 100, attempts: 8, recentAcc: 80, confidence: 2 }, "learning"],
  ["74% below strong", { status: "completed", completion: 100, attempts: 8, recentAcc: 74 }, "learning"],
  ["weak by accuracy", { status: "completed", completion: 100, attempts: 6, recentAcc: 40 }, "weak"],
  ["few attempts never weak", { status: "completed", completion: 100, attempts: 4, recentAcc: 0 }, "learning"],
  ["weak by low confidence", { status: "learning", completion: 40, confidence: 2 }, "weak"],
  ["good accuracy overrides low confidence", { status: "learning", completion: 40, confidence: 2, attempts: 6, recentAcc: 70 }, "in_progress"],
  ["two hard in a row", { status: "completed", completion: 100, ratings: ["hard", "hard", "good"] }, "weak"],
  ["hard,good,hard is not weak", { status: "completed", completion: 100, ratings: ["hard", "good", "hard"] }, "learning"],
  ["due today", { status: "completed", completion: 100, due: "2026-10-01" }, "needs_revision"], ["overdue", { status: "completed", completion: 100, due: "2026-09-20" }, "needs_revision"],
  ["not yet due", { status: "completed", completion: 100, due: "2026-10-02" }, "learning"],
  ["weak outranks needs_revision", { status: "completed", completion: 100, due: "2026-10-01", attempts: 8, recentAcc: 30 }, "weak"],
  ["mastered: ladder done, no PYQs", { status: "completed", completion: 100, ladderComplete: true, reviewsDone: 5 }, "mastered"],
  ["mastered: ladder + accuracy + confidence", { status: "completed", completion: 100, ladderComplete: true, reviewsDone: 5, attempts: 10, recentAcc: 85, confidence: 4 }, "mastered"],
  ["ladder done, accuracy 78 => strong", { status: "completed", completion: 100, ladderComplete: true, reviewsDone: 5, attempts: 10, recentAcc: 78 }, "strong"],
  ["ladder done, confidence 3, no PYQs => learning", { status: "completed", completion: 100, ladderComplete: true, reviewsDone: 5, confidence: 3 }, "learning"],
  ["no PYQs: reviewed + confident => strong", { status: "completed", completion: 100, reviewsDone: 2, confidence: 4 }, "strong"],
  ["legacy strong status", { status: "strong", completion: 100, confidence: 5, reviewsDone: 1 }, "strong"],
];
vectors.forEach(([label, o, want]) => eq(M(o), want, label));
// revision ladder vectors
const L = [1, 3, 7, 15, 30], T = "2026-10-01";
const rv = [[0, "good", L], [1, "easy", L], [3, "hard", L], [0, "hard", L], [4, "good", L], [3, "easy", L], [99, "good", L], [0, "good", [2]], [1, "good", [2, 5, 9]], [2, "easy", [2, 5, 9]]];
const want = [
  { step: 1, graduated: false, interval: 3, due: "2026-10-04" }, { step: 3, graduated: false, interval: 15, due: "2026-10-16" }, { step: 2, graduated: false, interval: 1, due: "2026-10-02" },
  { step: 0, graduated: false, interval: 1, due: "2026-10-02" }, { step: 5, graduated: true, interval: null, due: null }, { step: 5, graduated: true, interval: null, due: null },
  { step: 5, graduated: true, interval: null, due: null }, { step: 1, graduated: true, interval: null, due: null }, { step: 2, graduated: false, interval: 9, due: "2026-10-10" }, { step: 3, graduated: true, interval: null, due: null }];
rv.forEach(([s, r, l], i) => eq(O.nextReview(s, r, l, T), want[i], `ladder ${s}/${r}/${l}`));
eq(O.nextReview(1, "good", [2, 5, 9], "2026-12-30").due, "2027-01-08", "year boundary");
// constants mirror: SQL lc_* <-> lib/learning/config.ts
const cfg = fs.readFileSync(path.join(__dirname, "../../../lib/learning/config.ts"), "utf8");
const ts = (k) => Number(cfg.match(new RegExp(k + ":\\s*(\\d+)"))[1]);
const mirror = { minAttemptsForAccuracy: O.C.minAttempts, recentWindow: 10, weakAccuracy: O.C.weakAcc, strongAccuracy: O.C.strongAcc, masteredAccuracy: O.C.masteredAcc, weakConfidence: O.C.weakConf,
  strongConfidence: O.C.strongConf, hardStreakForWeak: O.C.hardStreak, stepOnGood: O.C.stepGood, stepOnEasy: O.C.stepEasy };
for (const [k, v] of Object.entries(mirror)) eq(ts(k), v, "config.ts " + k + " must equal SQL lc_*");
const sql005 = fs.readFileSync(path.join(__dirname, "../../migrations/005_integrity_indexes.sql"), "utf8");
const sqlNum = (nm) => Number(sql005.match(new RegExp(`lc_${nm}\\(\\)[^$]*\\$\\$ select (\\d+) \\$\\$`))[1]);
eq(ts("recentWindow"), sqlNum("recent_window"), "recent window"); eq(ts("maxIntervals"), sqlNum("max_intervals"), "max intervals"); eq(ts("maxIntervalDays"), sqlNum("max_interval_days"), "max interval days");
eq(ts("staleSessionSeconds"), sqlNum("stale_seconds"), "stale"); eq(ts("staleCreditSeconds"), sqlNum("stale_credit_seconds"), "credit"); eq(ts("minCountedSessionSeconds"), sqlNum("min_session_seconds"), "min session");
eq(ts("maxSessionSeconds"), sqlNum("max_session_seconds"), "max session"); eq(ts("focusMaxItems"), sqlNum("focus_max"), "focus max");
eq(JSON.stringify(O.C.defaultLadder), "[1,3,7,15,30]", "default ladder");

// emit SQL vectors (mastery + revision) so the DATABASE is held to the oracle
const q = (v) => (v === null ? "null" : typeof v === "string" ? `'${v}'` : String(v));
const arr = (a) => `'{${a.join(",")}}'::text[]`;
let out = "-- GENERATED by database/tests/reference/run_reference_tests.js from learning_oracle.js. Do not edit by hand.\n";
vectors.forEach(([label, o]) => {
  const s = { ...base, ...o }, w = O.mastery(s);
  out += `select pg_temp.check_('mastery: ${label.replace(/'/g, "")}', public.learning_mastery(${q(s.status)}, ${s.completion}, ${q(s.confidence)}, ${s.sessions}, ${s.attempts}, ${q(s.recentAcc)}::numeric, ${s.due ? `date '${s.due}'` : "null::date"}, date '${s.today}', ${arr(s.ratings)}, ${s.reviewsDone}, ${s.ladderComplete}) = '${w}');\n`;
});
rv.forEach(([s, r, l], i) => {
  const w = want[i];
  out += `select pg_temp.check_('revision_next: step ${s} ${r} ladder {${l}}', (select (x.step = ${w.step} and x.graduated = ${w.graduated} and x.interval_days is not distinct from ${q(w.interval)} and x.due_date is not distinct from ${w.due ? `date '${w.due}'` : "null::date"}) from public.revision_next(${s}, '${r}', array[${l}], date '${T}') x));\n`;
});
fs.writeFileSync(path.join(__dirname, "generated_vectors.sql"), out);
console.log(n + " oracle/mirror assertions passed; " + (vectors.length + rv.length) + " SQL vectors generated");
