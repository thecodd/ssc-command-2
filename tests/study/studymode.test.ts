import * as fs from "fs";
import * as path from "path";
import { createController } from "@/lib/study/controller";
import { initialState, reduce, type MAction, type MState } from "@/lib/study/sessionMachine";
import { createFakeStudyApi } from "@/tests/fixtures/fakeStudyApi";
declare const require: any;
const root = path.join(__dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const ls = (d: string) => fs.readdirSync(path.join(root, d)).filter((f) => /\.tsx?$/.test(f)).map((f) => `${d}/${f}`);

export default async function () {
  await t("study QA: no client duration ever reaches the server (api.finish/heartbeat/pause carry only ids)", () => {
    const api = read("lib/study/api.ts");
    assert.match(api, /finish\(session: string, type: EntityType, id: string, confidence\?: number\)/);
    assert.doesNotMatch(api.slice(api.indexOf("interface StudyApi"), api.indexOf("API_TIMEOUT_MS")), /seconds|duration|elapsed/i);
    const act = read("app/actions/study.ts"), svc = read("services/study.ts");
    assert.doesNotMatch(act + svc, /p_seconds|p_elapsed|p_duration/); assert.doesNotMatch(act, /seconds|elapsed/);
  });
  await t("study QA: components read time only from the monotonic clock (no Date.now / new Date for timing)", () => {
    for (const f of ls("components/study")) assert.doesNotMatch(read(f), /Date\.now\(|new Date\(/, f);
    assert.doesNotMatch(read("lib/study/sessionMachine.ts"), /Date\.now\(|new Date\(/);
  });
  await t("study QA: every study mutation is a keyed/in-flight guarded call (no raw api.* writes in onClick handlers)", () => {
    for (const f of ["components/study/ProgressCard.tsx", "components/study/RevisionCard.tsx", "components/study/SubtopicChecklist.tsx"]) assert.doesNotMatch(read(f), /await api\.(setProgress|scheduleRevision|reviewRevision)/, f);
    assert.match(read("components/study/FocusAction.tsx"), /if \(busy\) return/);
  });
  await t("study QA: server actions validate type + uuid before any RPC and never echo raw errors", () => {
    const a = read("app/actions/study.ts");
    assert.match(a, /parseStudyType/); assert.match(a, /isUuid/); assert.match(a, /userMessage\(code\)/); assert.doesNotMatch(a, /e\.message|error\.message/);
  });
  await t("study QA: React StrictMode (effect cleanup then setup on the same controller) does not leave the session stuck in 'recovering'", async () => {
    const api = createFakeStudyApi({ clock: () => 0, resumeFor: { type: "ssc_topic", id: "i", elapsedSeconds: 5 } });
    let state: MState = initialState(true); const acts: MAction[] = [];
    const ctl = createController({ api, type: "ssc_topic", id: "i", getState: () => state, dispatch: (a) => { acts.push(a); state = reduce(state, a); }, now: () => 0, refresh: () => {} });
    ctl.activate(); void ctl.reconcile("recover"); ctl.dispose();      // mount, StrictMode unmount ...
    ctl.activate(); await ctl.reconcile("recover");                      // ... mount again
    assert.equal(state.phase, "running");
  });
  await t("study QA: a duplicate tab sees the other tab's pause on its next heartbeat; a finished session ends the summary for both", async () => {
    const api = createFakeStudyApi({ clock: () => 0 });
    const mk = () => { let st: MState = initialState(false); const c = createController({ api, type: "ssc_topic", id: "i", getState: () => st, dispatch: (a) => { st = reduce(st, a); }, now: () => 0, refresh: () => {} }); return { c, get st() { return st; } }; };
    const t1 = mk(), t2 = mk();
    await t1.c.start(); await t2.c.start();                              // second tab gets the SAME session (idempotent start)
    assert.equal(t1.st.session!.id, t2.st.session!.id);
    await t2.c.pause(); await t1.c.heartbeat(); assert.equal(t1.st.phase, "paused");
    await t2.c.resume(); await t2.c.finish(); await t1.c.heartbeat();
    assert.equal(t1.st.phase, "ended"); assert.equal(t1.st.ended!.byUs, false);
  });
  await t("study QA: starting/pausing/finishing a session never calls the revision RPCs (the ladder is only touched by schedule/review)", () => {
    const flow = read("lib/study/controller.ts") + read("services/study.ts");
    assert.doesNotMatch(flow, /scheduleRevision|reviewRevision|schedule_revision|review_revision/);
    const sql = read("database/migrations/008_revision_engine.sql");
    assert.match(sql, /progress_seed_revision/); assert.match(sql, /transition|first completion|status (<>|!=) 'completed'/i);
  });
  await t("contract: top-level columns and embedded tables named in the study/practice services' select() strings exist in the migrations", () => {
    const tables = require(path.join(root, "database/security/schema_model.js")) as Record<string, Set<string>>;
    const problems: string[] = [];
    for (const f of ["services/studyContext.ts", "services/study.ts", "services/studyHub.ts", "services/revision.ts", "services/practice.ts", "services/progress.ts", "services/content.ts"]) {
      const src = read(f);
      for (const m of src.matchAll(/\.from\("(\w+)"\)\s*\.(?:select|update|insert)\(\s*(?:"([^"]*)"|`([^`]*)`)/g)) {
        const table = m[1], sel = (m[2] ?? m[3] ?? "").replace(/\$\{[^}]*\}/g, "");
        if (!tables[table]) { problems.push(`${f}: unknown table ${table}`); continue; }
        let depth = 0, cur = ""; const top: string[] = [], nested: string[] = [];
        for (const ch of sel) { if (ch === "(") { depth++; if (depth === 1) { nested.push(cur.trim()); cur = ""; } continue; } if (ch === ")") { depth--; continue; } if (depth > 0) continue; if (ch === ",") { top.push(cur.trim()); cur = ""; } else cur += ch; }
        top.push(cur.trim());
        for (const c of top.filter(Boolean)) { const col = c.split(":").pop()!.replace(/!inner/, "").trim(); if (col && !tables[table].has(col) && !tables[col]) problems.push(`${f}: ${table}.${col} does not exist`); }
        for (const n of nested) { const name = n.replace(/!inner/, "").split(",").pop()!.trim(); if (name && !tables[name]) problems.push(`${f}: embedded ${name} is not a table`); }
      }
    }
    assert.deepEqual(problems, []);
  });
}
