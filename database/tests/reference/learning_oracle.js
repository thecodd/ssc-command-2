// REFERENCE ORACLE (test-only). The production rules live in SQL (010 + 008). This file re-states them independently so that
//   (a) they can be executed and asserted in Node right now, and
//   (b) gen_vectors.js emits the SAME vectors as SQL assertions, so the database must agree with the oracle.
// Constants are read from migration 005 (lc_* functions), never retyped.
const fs = require("fs"), path = require("path");
const sql005 = fs.readFileSync(path.join(__dirname, "../../migrations/005_integrity_indexes.sql"), "utf8");
const lc = (name) => { const m = sql005.match(new RegExp(`function public\\.lc_${name}\\(\\)[^$]*\\$\\$ select ([^$]+?) \\$\\$`)); if (!m) throw new Error("lc_" + name + " not found"); return m[1].trim(); };
const num = (n) => Number(lc(n));
const C = { minAttempts: num("min_attempts"), weakAcc: num("weak_accuracy"), strongAcc: num("strong_accuracy"), masteredAcc: num("mastered_accuracy"),
  weakConf: num("weak_confidence"), strongConf: num("strong_confidence"), hardStreak: num("hard_streak"), stepGood: num("step_good"), stepEasy: num("step_easy"),
  defaultLadder: JSON.parse(lc("default_ladder").replace(/'\{(.*)\}'.*/, "[$1]")) };

const isDone = (s) => s === "completed" || s === "strong";
function weakReason(s) {
  const accKnown = s.attempts >= C.minAttempts && s.recentAcc !== null;
  if (accKnown && s.recentAcc < C.weakAcc) return "low_accuracy";
  if (s.ratings.length >= C.hardStreak && s.ratings.slice(0, C.hardStreak).every((r) => r === "hard")) return "hard_streak";
  if (s.confidence !== null && s.confidence <= C.weakConf && !accKnown) return "low_confidence";
  return null;
}
function mastery(s) {
  const started = s.status !== "not_started" || s.completion > 0 || s.sessions > 0 || s.attempts > 0;
  if (!started) return "not_started";
  if (weakReason(s)) return "weak";
  if (s.due && s.due <= s.today) return "needs_revision";
  if (!isDone(s.status)) return "in_progress";
  const acc = s.attempts >= C.minAttempts ? s.recentAcc : null;
  const confAtLeast = (m) => s.confidence === null || s.confidence >= m;
  if (s.ladderComplete && (s.attempts === 0 || (acc !== null && acc >= C.masteredAcc)) && confAtLeast(C.strongConf)) return "mastered";
  if ((acc !== null && acc >= C.strongAcc && confAtLeast(3)) || (s.attempts === 0 && s.reviewsDone >= 1 && s.confidence !== null && s.confidence >= C.strongConf)) return "strong";
  return "learning";
}
const addDays = (d, n) => { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
function nextReview(step, rating, ladder, today) {
  const n = ladder.length, at = Math.max(Math.min(step, n - 1), 0);
  const tgt = rating === "easy" ? at + C.stepEasy : rating === "good" ? at + C.stepGood : Math.max(at - 1, 0);
  if (tgt > n - 1) return { step: n, graduated: true, interval: null, due: null };
  const interval = rating === "hard" ? ladder[0] : ladder[tgt];
  return { step: tgt, graduated: false, interval, due: addDays(today, interval) };
}
module.exports = { C, weakReason, mastery, nextReview, addDays };
