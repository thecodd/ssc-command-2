import { nextStep, type StepInput } from "@/lib/study/nextStep";
import { explainMastery } from "@/lib/learning/rules";
import { LEARNING } from "@/lib/learning/config";
import { revisionLabel } from "@/lib/study/labels";
import { classifyError, userMessage } from "@/lib/study/errors";
import { FIXTURES } from "@/tests/fixtures/study";
import { parseStudyType, studyHref } from "@/lib/study/routes";
import { isUuid } from "@/lib/filters";
import * as fs from "fs";
import * as path from "path";
const none = { state: "none", scheduleId: null, step: null, dueDate: null, daysUntil: null, reason: null } as const;
const base: StepInput = { phase: "idle", mastery: "learning", completion: 100, revision: none, pyq: { total: 0, attempted: 0, accuracyPct: null }, practiceHref: null, foundation: { unfinished: 0, href: null }, upNext: null };
const step = (o: Partial<StepInput>) => nextStep({ ...base, ...o });
export default async function () {
  await t("nextStep: precedence due revision > weak > not started > unfinished > practice > schedule > move on", () => {
    const due = { ...none, state: "due", scheduleId: "x", step: 1, daysUntil: 0 } as const;
    assert.equal(step({ revision: due, mastery: "weak" }).code, "revise");
    assert.equal(step({ mastery: "weak", pyq: { total: 5, attempted: 5, accuracyPct: 20 }, practiceHref: "/p" }).code, "fix_weak");
    assert.equal(step({ mastery: "weak" }).code, "restudy");
    assert.equal(step({ mastery: "not_started", completion: 0 }).code, "start");
    assert.equal(step({ mastery: "not_started", completion: 0, foundation: { unfinished: 2, href: "/f" } }).code, "foundation");
    assert.equal(step({ mastery: "in_progress", completion: 80 }).code, "continue");
    assert.equal(step({ pyq: { total: 10, attempted: 0, accuracyPct: null }, practiceHref: "/p" }).code, "practice");
    assert.equal(step({}).code, "schedule");
    assert.equal(step({ revision: { ...none, state: "scheduled", daysUntil: 3, dueDate: "2026-10-04" }, upNext: { title: "Percentage", href: "/s" } }).code, "move_on");
    assert.equal(step({ revision: { ...none, state: "graduated" } }).code, "all_clear");
  });
  await t("nextStep: exactly one primary CTA, session phases override, ended+due asks for a rating, remaining % wording", () => {
    assert.equal(step({ phase: "running" }).cta.kind, "finish"); assert.equal(step({ phase: "paused" }).cta.kind, "resume");
    assert.equal(step({ phase: "ended", revision: { ...none, state: "due", scheduleId: "x", step: 0, daysUntil: 0 } }).code, "rate");   // Phase 7: rating lives in /revision/<id>; Study Mode links there
    assert.match(step({ phase: "ended", mastery: "in_progress", completion: 80 }).title, /remaining 20%/);
  });
  await t("nextStep: practice label follows PRACTICE_READY (Practice now that the screen exists)", () => {
    const s = step({ pyq: { total: 10, attempted: 0, accuracyPct: null }, practiceHref: "/p" });
    assert.match(s.title, /^Practice 10 PYQs$/);
  });
  await t("explainMastery: reasons come from signals and quote the config thresholds", () => {
    const sg = { mastery: "weak", weak_reason: "low_accuracy", pyq_attempts: 10, pyq_recent_accuracy: 30, pyq_count: 20, confidence: 3, completion: 100, revision_due_date: null, today: "2026-10-01", reviews_done: 0, ladder_complete: false } as const;
    const w = explainMastery(sg as any); assert.match(w.detail, /30%/); assert.match(w.detail, new RegExp(`${LEARNING.weakAccuracy}%`));
    assert.match(explainMastery({ ...sg, mastery: "needs_revision", revision_due_date: "2026-09-29" } as any).detail, /2 days ago/);
    assert.match(explainMastery({ ...sg, mastery: "needs_revision", revision_due_date: "2026-10-01" } as any).detail, /due today/);
    assert.match(explainMastery({ ...sg, mastery: "mastered", ladder_complete: true } as any).detail, /ladder is complete/);
    assert.equal(explainMastery(null).headline, "Not started");
    // below the minimum attempts accuracy must not be quoted as a reason
    assert.doesNotMatch(explainMastery({ ...sg, pyq_attempts: 3 } as any).detail, /30%/);
  });
  await t("config mirror: thresholds shown in explanations equal the SQL lc_* constants", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../../database/migrations/005_integrity_indexes.sql"), "utf8");
    const v = (fn: string) => Number(new RegExp(`function public\\.${fn}\\(\\)[^$]*\\$\\$ select (\\d+) \\$\\$`).exec(sql)?.[1]);
    assert.equal(v("lc_min_attempts"), LEARNING.minAttemptsForAccuracy); assert.equal(v("lc_weak_accuracy"), LEARNING.weakAccuracy);
    assert.equal(v("lc_strong_accuracy"), LEARNING.strongAccuracy); assert.equal(v("lc_mastered_accuracy"), LEARNING.masteredAccuracy); assert.equal(v("lc_weak_confidence"), LEARNING.weakConfidence);
  });
  await t("revisionLabel: none / scheduled / due / overdue / graduated", () => {
    assert.equal(revisionLabel(none as any), "No revision scheduled");
    assert.match(revisionLabel({ ...none, state: "scheduled", dueDate: "2026-10-04", daysUntil: 3 } as any), /^Next revision: in 3 days/);
    assert.match(revisionLabel({ ...none, state: "scheduled", dueDate: "2026-10-02", daysUntil: 1 } as any), /tomorrow/);
    assert.equal(revisionLabel({ ...none, state: "due", daysUntil: 0 } as any), "Revision due today");
    assert.match(revisionLabel({ ...none, state: "overdue", daysUntil: -2 } as any), /overdue by 2 days/);
    assert.equal(revisionLabel({ ...none, state: "graduated" } as any), "Revision ladder complete");
  });
  await t("classifyError: PG codes first, never leaks raw text", () => {
    assert.equal(classifyError({ code: "P0002", message: "relation foo" }), "not_found"); assert.equal(classifyError({ code: "55000" }), "ended");
    assert.equal(classifyError({ code: "40001" }), "conflict"); assert.equal(classifyError({ code: "22023" }), "invalid"); assert.equal(classifyError({ code: "42501" }), "auth");
    assert.equal(classifyError(new Error("TypeError: fetch failed")), "network"); assert.equal(classifyError(new Error("You're signed out. Sign in again.")), "auth");
    assert.equal(classifyError({ message: 'duplicate key value violates "pk_x"' }), "unknown");
    assert.doesNotMatch(userMessage("unknown"), /duplicate|violates|relation|pk_/);
  });
  await t("routes: only the three entity types are valid; ids must be uuids", () => {
    assert.equal(parseStudyType("ncert_chapter"), "ncert_chapter"); assert.equal(parseStudyType("ssc_subtopic"), "ssc_subtopic");
    assert.equal(parseStudyType("ssc_subject"), null); assert.equal(parseStudyType("../x"), null); assert.equal(parseStudyType(undefined), null);
    assert.equal(isUuid("not-a-uuid"), false); assert.equal(studyHref("ssc_topic", "abc"), "/study/ssc_topic/abc");
  });
  await t("fixtures: every fixture title is labelled Fixture (can't pass as syllabus data)", () => {
    for (const [k, c] of Object.entries(FIXTURES)) {
      assert.match(c.entity.title, /Fixture/, k);
      for (const l of [...c.foundation, ...c.sscTopics]) assert.match(l.title, /Fixture/, k + ":" + l.title);
      for (const s of c.subtopics) assert.match(s.title, /Fixture/, k);
    }
  });
  await t("production code never imports fixtures (except the dev-only preview route)", () => {
    const bad: string[] = [];
    (function walk(d: string) { for (const f of fs.readdirSync(d)) { if (["node_modules", ".next", ".git", "tests"].includes(f)) continue; const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && /@\/tests\//.test(fs.readFileSync(p, "utf8")) && !p.includes("dev/study-preview") && !p.includes("dev/revision-preview")) bad.push(p); } })(path.join(__dirname, "../.."));
    assert.deepEqual(bad, []);
  });
}
