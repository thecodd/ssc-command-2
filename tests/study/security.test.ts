// STATIC checks over the SQL text (no Postgres is available). They catch drift between migrations, the function matrix and the app code.
// They do NOT prove the database behaves this way: that needs database/tests/phase6 run on a real project.
import * as fs from "fs";
import * as path from "path";
declare const require: any;
const root = path.join(__dirname, "../..");
const { collect } = require(path.join(root, "database/security/build_privileges.js"));
const matrix = require(path.join(root, "database/security/function_matrix.js"));
const mig = (f: string) => fs.readFileSync(path.join(root, "database/migrations", f), "utf8");
const strip = (s: string) => s.replace(/--.*$/gm, "");
const fns: { name: string; sd: boolean; pinned: boolean; body: string; trigger: boolean }[] = collect();

export default async function () {
  await t("matrix: every function in migrations 001-012 is classified, and no classification is stale", () => {
    const names = new Set(fns.map((f) => f.name));
    assert.deepEqual(fns.filter((f) => !matrix[f.name]).map((f) => f.name), []);
    assert.deepEqual(Object.keys(matrix).filter((k) => !names.has(k)), []);
  });
  await t("search_path: every SECURITY DEFINER function pins it", () => {
    assert.deepEqual(fns.filter((f) => f.sd && !f.pinned).map((f) => f.name), []);
  });
  await t("definer functions that take a user/session id are never client-callable", () => {
    const risky = fns.filter((f) => f.sd && /\(\s*[^)]*\bp_(uid|user)\b/.test(f.body.slice(0, 400)) || (f.sd && /^_close_session/.test(f.name)));
    assert.ok(risky.length >= 6);
    for (const f of risky) assert.ok(["internal", "trigger", "service"].includes(matrix[f.name].cls), `${f.name} takes a user id but is ${matrix[f.name].cls}`);
  });
  await t("client RPCs derive identity from the session; admin RPCs check admin first", () => {
    for (const f of fns.filter((x) => x.sd && matrix[x.name].cls === "rpc")) assert.match(f.body, /_require_uid\(\)/, f.name);
    for (const f of fns.filter((x) => matrix[x.name].cls === "admin")) assert.match(f.body, /is_admin\(\)|_import_admin\(\)/, f.name);
    for (const f of fns.filter((x) => matrix[x.name].cls === "admin")) assert.ok(f.sd, f.name);
  });
  await t("triggers and internal helpers are not granted to clients by 014; service-only stay service-only", () => {
    const g = mig("014_function_privileges.sql");
    const granted = new Set([...g.matchAll(/'public\.(\w+)\(/g)].map((m) => m[1]));
    for (const f of fns) {
      const cls = matrix[f.name].cls;
      if (["internal", "trigger", "service"].includes(cls) && cls !== "service") assert.ok(!granted.has(f.name), `${f.name} (${cls}) must not be in the grant lists`);
      if (["rpc", "admin", "rls", "pure"].includes(cls)) assert.ok(granted.has(f.name), `${f.name} missing from the client grant list`);
    }
    const authBlock = g.slice(g.indexOf("2a."), g.indexOf("2b."));
    for (const n of ["study_sweep_stale", "entities_integrity_report", "entity_accessible", "_close_session"]) assert.ok(!authBlock.includes(`public.${n}(`), n);
  });
  await t("014 is the LAST migration, revokes by default, and asserts anon/PUBLIC/search_path in SQL", () => {
    const files = fs.readdirSync(path.join(root, "database/migrations")).filter((f) => /^\d+_/.test(f)).sort();
    assert.equal(files[files.length - 1], "014_function_privileges.sql");
    const g = strip(mig("014_function_privileges.sql"));
    assert.match(g, /revoke all on function %s from public, anon, authenticated/); assert.match(g, /alter default privileges in schema public revoke execute on functions/);
    assert.match(g, /has_function_privilege\('anon'/); assert.match(g, /prosecdef and has_function_privilege\('authenticated'/); assert.match(g, /search_path=%/);
    assert.match(g, /deptype = 'e'/);                                       // extension functions (pg_trgm) are not revoked
  });
  await t("answer key: pyqs SELECT is column-limited and the key columns are not in the list", () => {
    const s = strip(mig("012_practice_security_search.sql"));
    assert.match(s, /revoke select on public\.pyqs from authenticated/);
    const grant = /grant select \(([^)]*)\) on public\.pyqs to authenticated/.exec(s);
    assert.ok(grant); const cols = grant![1].split(",").map((c) => c.trim());
    for (const secret of ["correct_answer", "explanation", "content_hash"]) assert.ok(!cols.includes(secret), secret);
    for (const needed of ["id", "question", "options", "owner_id", "archived", "paper_id", "difficulty_level"]) assert.ok(cols.includes(needed), needed);
  });
  await t("answer key: practice_question reveals key/explanation/topics only behind the attempt check", () => {
    const s = strip(mig("012_practice_security_search.sql"));
    const fn = s.slice(s.indexOf("function public.practice_question"), s.indexOf("function public.finish_practice"));
    assert.match(fn, /user_id = v_uid/); assert.match(fn, /array_position\(s\.pyq_ids, p_pyq\)/);
    assert.match(fn, /case when a\.id is null then null else jsonb_build_object\('selected'/);
    const afterIf = fn.slice(fn.indexOf("if a.id is not null then"));
    assert.ok(afterIf.indexOf("v_topics") < afterIf.indexOf("end if;") && afterIf.indexOf("v_found") < afterIf.indexOf("end if;"));
    const before = fn.slice(0, fn.indexOf("if a.id is not null then")); assert.doesNotMatch(before, /correct_answer|explanation/);
  });
  await t("app code never reads key columns from pyqs (only the RPC results carry them)", () => {
    const hits: string[] = [];
    (function walk(d: string) { for (const f of fs.readdirSync(d)) { if (["node_modules", ".next", ".git", "database", "tests", "docs"].includes(f)) continue; const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) { const s = fs.readFileSync(p, "utf8"); if (/from\(["']pyqs["']\)/.test(s) || /pyqs\([^)]*(correct_answer|explanation)/.test(s)) hits.push(p); } } })(root);
    assert.deepEqual(hits, []);
  });
  await t("grading and ownership live in submit_pyq_answer (no correctness parameter, session ownership, membership, one attempt per question)", () => {
    const s = strip(mig("009_pyq_practice.sql"));
    const fn = s.slice(s.indexOf("function public.submit_pyq_answer"), s.indexOf("function public.finish_practice"));
    assert.match(fn.slice(0, 200), /submit_pyq_answer\(p_session uuid, p_pyq uuid, p_selected text, p_time_seconds int/); assert.doesNotMatch(fn.slice(0, 200), /correct|is_correct/);
    assert.match(fn, /id = p_session and user_id = v_uid for update/); assert.match(fn, /p_pyq = any \(s\.pyq_ids\)/); assert.match(fn, /p_selected = y\.correct_answer/); assert.match(fn, /on conflict \(session_id, pyq_id\)/);
    assert.match(s, /create unique index if not exists pyq_attempts_session_pyq_key on public\.pyq_attempts \(session_id, pyq_id\)/);
    assert.match(s, /grant select on public\.pyq_attempts to authenticated/); assert.doesNotMatch(s, /grant (insert|update|delete)[^;]*pyq_attempts/i);
    assert.match(s, /pyq_ids uuid\[\] not null check \(cardinality\(pyq_ids\) between 1 and 200\)/);          // ordered snapshot
  });
  await t("search: archived / unpublished content is excluded for non-admins at every level; admins keep visibility", () => {
    const s = strip(mig("012_practice_security_search.sql"));
    const fn = s.slice(s.indexOf("function public.global_search"));
    assert.match(fn, /public\.is_admin\(\) as adm/);
    for (const kind of ["book", "chapter", "concept", "ssc_subject", "ssc_topic", "ssc_subtopic", "pyq"]) {
      const seg = fn.slice(fn.indexOf(`select '${kind}'::text`)); const where = seg.slice(seg.indexOf("where"), seg.indexOf("order by"));
      assert.match(where, /p\.adm or/, kind + " keeps admin visibility"); assert.match(where, /archived/, kind + " excludes archived");
    }
    assert.match(fn.slice(fn.indexOf("'chapter'"), fn.indexOf("'concept'")), /b\.status = 'published'/);          // the leak: an archived BOOK leaves its chapters unflagged
    assert.match(fn.slice(fn.indexOf("'ssc_topic'"), fn.indexOf("'ssc_subtopic'")), /x\.status = 'published'/);
  });
  await t("practice filters: start_practice resumes only the same scope AND filters; unknown scope/filters are validated in SQL", () => {
    const s = strip(mig("012_practice_security_search.sql"));
    assert.match(s, /s\.difficulty is not distinct from p_difficulty and s\.paper_id is not distinct from p_paper/);
    assert.match(s, /_practice_check_scope\(v_uid, p_scope, p_scope_id\)/); assert.match(s, /p_count := least\(greatest\(coalesce\(p_count, 10\), 1\), 50\)/);
  });
  await t("012: has_valid_key is maintained by the trigger, readable, and counts/lists filter on it (so counts match what Practice can serve)", () => {
    const s = strip(mig("012_practice_security_search.sql"));
    assert.match(s, /add column if not exists has_valid_key boolean not null default false/);
    assert.match(s, /new\.has_valid_key := coalesce\(public\.pyq_answer_valid\(new\.options, new\.correct_answer\), false\)/);
    assert.match(s, /before insert or update on public\.pyqs/);
    const grant = /grant select \(([^)]*)\) on public\.pyqs to authenticated/.exec(s)![1];
    assert.ok(grant.includes("has_valid_key"));
    for (const fn of ["topic_pyq_stats", "subject_pyq_counts", "topic_pyqs"]) {
      const seg = s.slice(s.indexOf(`function public.${fn}`)); const body = seg.slice(0, seg.indexOf("$$;", seg.indexOf("as $$")));
      assert.match(body, /has_valid_key/, fn); assert.match(body, /not y\.archived/, fn); assert.match(body, /security invoker/, fn); assert.doesNotMatch(body, /correct_answer/, fn);
    }
  });
  await t("014 and the matrix doc are in sync with function_matrix.js (regenerating changes nothing)", () => {
    const cp = require("child_process");
    const f013 = path.join(root, "database/migrations/014_function_privileges.sql"), fdoc = path.join(root, "docs/SECURITY_FUNCTION_MATRIX.md");
    const before = [fs.readFileSync(f013, "utf8"), fs.readFileSync(fdoc, "utf8")];
    cp.execFileSync("node", [path.join(root, "database/security/build_privileges.js")], { cwd: root, stdio: "pipe" });
    assert.equal(fs.readFileSync(f013, "utf8") === before[0], true); assert.equal(fs.readFileSync(fdoc, "utf8") === before[1], true);
  });
  await t("phase6 SQL tests exist, cover the required areas, and are built from the harness (NOT executed here)", () => {
    const sql = fs.readFileSync(path.join(root, "database/tests/phase6/12_practice_security.sql"), "utf8");
    for (const area of ["cannot read correct_answer", "B cannot submit into A session", "duplicate submit", "graded correct BY THE SERVER", "cannot INSERT an attempt directly", "order preserved", "search hides a chapter whose BOOK is archived", "executable by anon or PUBLIC", "ENDED session"]) assert.ok(sql.includes(area), area);
    assert.ok((sql.match(/check_\(/g) ?? []).length >= 60);
  });
  await t("dev preview is isolated from production: page.dev.tsx + pageExtensions, and nothing else imports tests/fixtures (two dev previews)", () => {
    const cfg = fs.readFileSync(path.join(root, "next.config.mjs"), "utf8");
    assert.match(cfg, /pageExtensions: dev \? \["tsx", "ts", "dev\.tsx"\] : \["tsx", "ts"\]/);
    assert.ok(fs.existsSync(path.join(root, "app/(focus)/dev/study-preview/page.dev.tsx")));
    assert.ok(!fs.existsSync(path.join(root, "app/(focus)/dev/study-preview/page.tsx")));
    const importers: string[] = [];
    (function walk(d: string) { for (const f of fs.readdirSync(d)) { if (["node_modules", ".next", ".git", "tests", "database", "docs"].includes(f)) continue; const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && /@\/tests\//.test(fs.readFileSync(p, "utf8"))) importers.push(path.relative(root, p).split(path.sep).join("/")); } })(root);
    assert.deepEqual(importers.sort(), ["app/(focus)/dev/revision-preview/page.dev.tsx", "app/(focus)/dev/study-preview/page.dev.tsx"]);
  });
  await t("014: assertions compare RESOLVED OIDs, not regprocedure text (the first real run failed on text normalisation)", () => {
    const g = strip(mig("014_function_privileges.sql"));
    assert.doesNotMatch(g, /regprocedure\s*::\s*text/i); assert.doesNotMatch(g, /<>\s*all\s*\(\s*array\[/i); assert.match(g, /p\.oid\s*<>\s*all\s*\(\s*v_allowed\s*\)/);
    assert.match(g, /v_sig := to_regprocedure\(v_name\);[\s\S]*v_allowed := v_allowed \|\| v_sig::oid;/); assert.match(g, /allow-list entry not found/);
  });
  await t("014: the admin RPCs (set_publish_status, verify_source, set_exam_official, import_*) are on the SAME allow-list the grants use, enum types schema-qualified", () => {
    const g = mig("014_function_privileges.sql"); const lists = [...g.matchAll(/array\[([\s\S]*?)\]\s*loop/g)].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    const both = lists.filter((l) => l.includes("public.revision_queue()")), grant = both[0];
    assert.equal(both.length, 2, "one list for the GRANTS and one for the ASSERTION"); assert.deepEqual(both[0], both[1], "the assertion must resolve exactly the list that was granted");
    for (const s of ["public.set_publish_status(text, uuid, public.publish_status_t)", "public.verify_source(uuid, boolean)", "public.set_exam_official(uuid, boolean)", "public.import_create_run(text, text, jsonb, boolean)", "public.import_apply_run(uuid)"]) assert.ok(grant!.includes(s), s);
    for (const s of grant!) for (const m of s.matchAll(/\b(entity_t|publish_status_t|difficulty_t|session_state_t)\b/g)) assert.ok(s.includes("public." + m[1]), `${s}: ${m[1]} is not schema-qualified`);
  });
  await t("014: the generator is idempotent (a second regeneration is byte-identical) and the static audit (types, OIDs, allow-list) is clean", () => {
    const cp = require("child_process"), f = path.join(root, "database/migrations/014_function_privileges.sql"), d = path.join(root, "docs/SECURITY_FUNCTION_MATRIX.md");
    cp.execFileSync("node", [path.join(root, "database/security/build_privileges.js")], { cwd: root, stdio: "pipe" }); const a = [fs.readFileSync(f, "utf8"), fs.readFileSync(d, "utf8")];
    cp.execFileSync("node", [path.join(root, "database/security/build_privileges.js")], { cwd: root, stdio: "pipe" }); assert.equal(fs.readFileSync(f, "utf8") === a[0] && fs.readFileSync(d, "utf8") === a[1], true);
    const r = cp.spawnSync("node", [path.join(root, "database/security/static_audit.cjs")], { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, r.stdout);
  });
  await t("014: authenticated/anon lose TRUNCATE, REFERENCES and TRIGGER on every public table (RLS cannot protect against TRUNCATE) and 014 asserts it", () => {
    const g = strip(mig("014_function_privileges.sql"));
    assert.match(g, /revoke truncate, references, trigger on all tables in schema public from anon, authenticated;/); assert.match(g, /alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;/);
    assert.match(g, /has_table_privilege\(rl\.rolname, c\.oid, 'truncate, references, trigger'\)/); assert.match(g, /still has TRUNCATE\/REFERENCES\/TRIGGER/);
    const all = fs.readdirSync(path.join(root, "database/migrations")).map((f) => strip(mig(f))).join("\n"); assert.doesNotMatch(all, /grant[^;]*\btruncate\b[^;]*to\s+(anon|authenticated)/i);
  });
  await t("SQL test harness rules are encoded: STABLE functions are evaluated by rows_as, errors are recorded, and no suite checks a write and its effect in ONE statement", () => {
    const h = fs.readFileSync(path.join(root, "database/tests/phase4/00_harness.sql"), "utf8");
    assert.match(h, /select count\(t\) from \(select q::text as t from \(/); assert.doesNotMatch(h, /execute 'select count\(\*\) from \(' \|\| stmt/); assert.match(h, /create temp table t_errors/); assert.match(h, /create temp table t_ret/);
    for (const f of ["phase6/12_practice_security.sql", "phase7/13_revision.sql", "security/14_security_regression.sql"]) {
      const sql = fs.readFileSync(path.join(root, "database/tests", f), "utf8");
      for (const m of sql.matchAll(/select pg_temp\.check_\('([^']*(?:''[^']*)*)'([\s\S]*?)\);\n/g)) {
        const body = m[2]; const writes = /(?:rows_as|owner_try)\([^;]*?(review_revision|schedule_revision|set_progress|submit_pyq_answer|start_practice|insert into|update \w+ set|delete from)/.test(body);
        const expectsSuccess = /(>= 0|>= 1| = 1\b|in \(0, -1\))\s*(and|\))/.test(body.replace(/= -1/g, ""));
        const readsState = /\(select [^()]*from (revision_schedule|revision_reviews|user_progress|chapters|books|pyqs|pyq_attempts|practice_sessions|study_sessions|profiles)\b/.test(body);
        if (writes && expectsSuccess && readsState && !/= -1/.test(body)) assert.fail(`${f}: "${m[1].slice(0, 80)}" writes and reads its own effect in ONE statement (a SELECT cannot see rows written by a volatile function in the same statement)`);
      }
    }
  });
  await t("external links: only absolute http(s) URLs become hrefs; every external <a> opens with noopener", () => {
    const { safeExternalUrl } = require(path.join(root, "lib/url"));
    assert.equal(safeExternalUrl("https://ssc.gov.in/notice.pdf"), "https://ssc.gov.in/notice.pdf");
    assert.equal(safeExternalUrl(" http://example.com "), "http://example.com/");
    for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", " javascript:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "//evil.example", "/relative", "ftp://x.example", "", null, undefined]) assert.equal(safeExternalUrl(bad as string), null, String(bad));
    for (const f of ["app/(app)/resources/page.tsx", "components/curriculum/NotesPanel.tsx", "components/study/sections.tsx", "components/study/NotesSheet.tsx"]) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      assert.doesNotMatch(src, /href=\{\s*(r|m)\.url\b/, `${f}: a raw stored URL must not reach href`);
      for (const a of src.match(/<a [^>]*target="_blank"[^>]*>/g) ?? []) assert.match(a, /rel="[^"]*noopener/, `${f}: ${a.slice(0, 80)}`);
    }
    for (const f of ["services/workspace.ts", "services/content.ts"]) assert.match(fs.readFileSync(path.join(root, f), "utf8"), /safeExternalUrl\(i\.url\)/, `${f} validates with the same rule it renders with`);
  });
}
