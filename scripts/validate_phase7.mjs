#!/usr/bin/env node
// Phase 7 runtime validation kit: ONE entry point. Cross-platform (Node >= 18). See docs/VALIDATION_KIT.md.
//   node scripts/validate_phase7.mjs --db-url postgres://postgres:postgres@127.0.0.1:54322/cgl_validation_scratch [--shim-auth] [--reset]
// Every stage ends PASS | FAIL | BLOCKED | NOT RUN. The verdict is READY only if every MANDATORY stage actually PASSED. The last output line is always
// "READY FOR PHASE 8" or "NOT READY FOR PHASE 8". Supporting evidence (Node tests, static SQL audit, fixture browser smoke) never counts toward readiness.
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import { Report, STATUS, root, run, has, mdTable, isWin } from "./validate/lib.mjs";
import { discoverMigrations, preflight, applyMigrations, applyShim, resetScratch, runSuite, parseDbUrl, q } from "./validate/db.mjs";
import { SUITES, checkSuite } from "./validate/sqlbuild.mjs";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n), val = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const flags = { shimAuth: flag("--shim-auth"), reset: flag("--reset"), allowRemote: flag("--allow-remote"), forceIKnow: flag("--force-i-understand-this-may-destroy-data") };
if (flag("--help")) { console.log(fs.readFileSync(path.join(root, "docs/VALIDATION_KIT.md"), "utf8").split("\n").slice(0, 60).join("\n")); process.exit(0); }
const dbUrl = val("--db-url", process.env.VALIDATE_DATABASE_URL || "");
const SKIP_APP = flag("--skip-app");   // ONLY for the kit's own self-tests (tests/kit): seed hook and app stages become NOT RUN, so the verdict can never be READY
const seedScript = val("--e2e-seed-script", process.env.VALIDATE_E2E_SEED_SCRIPT || "");   // optional hook: creates the E2E user + CI-only fixtures (e.g. scripts/ci/seed_e2e.mjs)
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.resolve(val("--out", path.join(root, "reports/phase7", stamp)));
const R = new Report(outDir), log = (n, t) => R.log(n, t);
const port = val("--port", process.env.E2E_PORT || "3100"), baseUrl = val("--base-url", process.env.E2E_BASE_URL || "");
const now = () => Date.now();
const firstLine = (s) => String(s || "").trim().split(/\r?\n/).filter(Boolean).slice(-6).join(" | ").slice(0, 400);
let dbReady = false, depsReady = false, buildOk = false, appDbOk = false;

// ------------------------------------------------------------------ 1 environment
{
  const missing = [], info = [];
  const nodeMajor = +process.versions.node.split(".")[0]; info.push(`node ${process.version}`); if (nodeMajor < 18) missing.push("Node >= 18");
  const npm = run("npm", ["--version"]); if (npm.code !== 0) missing.push("npm"); else info.push(`npm ${npm.stdout.trim()}`);
  const ps = has("psql") ? run("psql", ["--version"]).stdout.trim() : null; if (!ps) missing.push("psql (PostgreSQL client)"); else info.push(ps);
  info.push(has("supabase") ? "supabase CLI " + run("supabase", ["--version"]).stdout.trim() : "supabase CLI not installed (optional)");
  info.push(`platform ${process.platform}/${process.arch}`);
  R.add({ id: "1", title: "Environment check", status: missing.length ? STATUS.BLOCKED : STATUS.PASS, detail: missing.length ? `missing: ${missing.join(", ")}` : info.join("; "), items: info });
}
// ------------------------------------------------------------------ 2 dependencies
{
  const need = ["next", "typescript", "eslint", "react", "react-dom", "@supabase/supabase-js", "tailwindcss"], miss = need.filter((n) => !fs.existsSync(path.join(root, "node_modules", n, "package.json")));
  depsReady = miss.length === 0;
  R.add({ id: "2", title: "Dependency check", status: depsReady ? STATUS.PASS : STATUS.BLOCKED, detail: depsReady ? "project dependencies are installed" : `BLOCKED - dependencies unavailable (missing in node_modules: ${miss.join(", ")}). Run \`npm ci\` (or \`npm install\`) with registry access.` });
}
// ------------------------------------------------------------------ 3 migration ordering
const mig = discoverMigrations();
R.add({ id: "3", title: "Migration ordering check (001..014, contiguous, 014 last)", status: mig.problems.length ? STATUS.FAIL : STATUS.PASS, detail: mig.problems.length ? mig.problems.join("; ") : `${mig.list.length} migrations: ${mig.list[0].file} ... ${mig.list.at(-1).file}`, items: mig.list.map((m) => `${m.num} ${m.file} sha256:${m.sha.slice(0, 12)}`) });
// supporting: suite files fresh
{
  const bad = Object.keys(SUITES).map((k) => checkSuite(k)).filter((r) => !r.ok);
  R.add({ id: "S1", title: "SQL suite files are up to date with their sources (node scripts/validate/sqlbuild.mjs --check)", category: "SUPPORTING", mandatory: false, status: bad.length ? STATUS.FAIL : STATUS.PASS, detail: bad.length ? bad.map((b) => `${b.key}: ${b.why}`).join("; ") + "  (rebuild: node scripts/validate/sqlbuild.mjs)" : "phase4, phase6, phase7, security suites are identical to a fresh build" });
}
// ------------------------------------------------------------------ 4a preflight, 4b migrations
const pre = preflight(dbUrl, flags);
{
  const s = R.add({ id: "4a", title: "Database preflight + scratch-safety", status: pre.status, detail: pre.detail, items: Object.entries(pre.info).map(([k, v]) => `${k}: ${JSON.stringify(v)}`) });
  if (pre.status === STATUS.PASS) {
    let prep = null;
    if (flags.reset && !pre.info.ledger) { prep = resetScratch(dbUrl); if (prep.code !== 0) { s.status = STATUS.FAIL; s.detail = "reset failed: " + firstLine(prep.stderr); } }
    if (s.status === STATUS.PASS && !pre.info.supabase && flags.shimAuth) { const sh = applyShim(dbUrl); if (sh.code !== 0) { s.status = STATUS.FAIL; s.detail = "plain-Postgres shim failed: " + firstLine(sh.stderr); } }
  }
}
let migResults = [];
if (R.stages.at(-1).status === STATUS.PASS && !mig.problems.length) {
  const t0 = now(); migResults = applyMigrations(dbUrl, mig.list, R, log);
  const bad = migResults.find((m) => m.status === STATUS.FAIL || m.status === STATUS.BLOCKED), allPass = migResults.every((m) => m.status === STATUS.PASS);
  dbReady = allPass;
  R.add({ id: "4b", title: "Migration application (001..014, once each, in order, stop on first failure)", status: allPass ? STATUS.PASS : bad ? bad.status : STATUS.NOT_RUN,
    detail: allPass ? `all ${migResults.length} migrations applied/verified in ${now() - t0} ms` : bad ? `migration ${bad.num} (${bad.file}): ${bad.detail}` : "not run", items: migResults.map((m) => `${m.num} ${m.status}${m.ms !== undefined ? ` ${m.ms}ms` : ""} ${m.file}${m.detail ? " :: " + m.detail : ""}`), log: bad?.log });
} else {
  const why = R.stages.at(-1).status === STATUS.PASS ? "migration ordering check failed" : `blocked by stage 4a: ${pre.detail}`;
  R.add({ id: "4b", title: "Migration application (001..014, once each, in order, stop on first failure)", status: pre.status === STATUS.FAIL || mig.problems.length ? STATUS.NOT_RUN : STATUS.BLOCKED, detail: why, items: mig.list.map((m) => `${m.num} ${pre.status === STATUS.FAIL ? "NOT RUN" : "BLOCKED"} ${m.file}`) });
}
// ------------------------------------------------------------------ 5-7 SQL suites (+ security regression)
const suiteStages = [["5", "phase4", "Phase 4 SQL suite"], ["6", "phase6", "Phase 6 SQL suite"], ["7", "phase7", "Phase 7 SQL suite"], ["7b", "security", "Security regression SQL suite"]];
for (const [id, key, title] of suiteStages) {
  if (!dbReady) { R.add({ id, title, status: pre.status === STATUS.FAIL || R.stages.find((s) => s.id === "4b")?.status === STATUS.FAIL ? STATUS.NOT_RUN : STATUS.BLOCKED, detail: "requires migrations 001..014 applied to a real database (stage 4b)" }); continue; }
  const r = runSuite(dbUrl, { key, file: SUITES[key].out }, log);
  R.add({ id, title, status: r.status, detail: r.detail, items: (r.items || []).map((f) => `FAILED #${f.n} ${f.label}${f.detail ? " [" + f.detail.slice(0, 200) + "]" : ""}`), log: r.log, ms: r.ms, counts: r.total !== undefined ? { passed: r.passed, failed: r.failed, total: r.total } : undefined });
}
// ------------------------------------------------------------------ S8 read-only runtime diagnostics (whatever the suites did): overloads, volatility, privileges, auth.uid(), triggers, policies
if (dbReady && !flag("--skip-supporting")) {
  const dg = run("psql", [dbUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", path.join(root, "database/tests/diagnostics/runtime_diagnostics.sql")]);
  const lf = log("diagnostics.log", `exit=${dg.code}\n${dg.stdout}\n${dg.stderr}`);
  R.add({ id: "S8", title: "Read-only runtime diagnostics of the scratch database (logs/diagnostics.log; asserts nothing)", category: "SUPPORTING", mandatory: false, status: dg.code === 0 ? STATUS.PASS : STATUS.FAIL, detail: dg.code === 0 ? "diagnostics captured" : firstLine(dg.stderr), log: lf });
}
// ------------------------------------------------------------------ 7c optional E2E seed hook (CI-only fixtures; runs AFTER the SQL suites so it cannot influence them)
{
  const id = "7c", title = "E2E seed hook (CI-only user + fixtures for the real-browser stage)";
  if (SKIP_APP) R.add({ id, title, mandatory: false, status: STATUS.NOT_RUN, detail: "skipped by --skip-app (kit self-test run)" });
  else if (!seedScript) R.add({ id, title, mandatory: false, status: STATUS.NOT_RUN, detail: "no seed hook configured (--e2e-seed-script / VALIDATE_E2E_SEED_SCRIPT): seed the E2E user's data manually" });
  else if (!dbReady) R.add({ id, title, status: STATUS.BLOCKED, detail: "requires a validated database (stage 4b)" });
  else if (!fs.existsSync(path.resolve(root, seedScript))) R.add({ id, title, status: STATUS.FAIL, detail: `seed script not found: ${seedScript}` });
  else {
    const r = run(process.execPath, [path.resolve(root, seedScript)], { env: { DATABASE_URL: dbUrl, VALIDATE_DATABASE_URL: dbUrl }, timeoutMs: 5 * 60 * 1000 });
    const lf = log("e2e_seed.log", `exit=${r.code}\n${r.stdout}\n${r.stderr}`);
    R.add({ id, title, status: r.code === 0 ? STATUS.PASS : r.code === 3 ? STATUS.BLOCKED : STATUS.FAIL, detail: firstLine(r.code === 0 ? r.stdout : r.stderr || r.stdout), log: lf });
  }
}
// ------------------------------------------------------------------ 8-10 typecheck / lint / build (REAL commands only)
const npmStage = (id, title, script) => {
  if (SKIP_APP) return R.add({ id, title, status: STATUS.NOT_RUN, detail: "skipped by --skip-app (kit self-test run; never a gate run)" });
  if (!depsReady) return R.add({ id, title, status: STATUS.BLOCKED, detail: "BLOCKED - dependencies unavailable (stage 2). No stub is substituted." });
  const r = run("npm", ["run", script], { env: { NEXT_TELEMETRY_DISABLED: "1" } }); const lf = log(`${script}.log`, `$ npm run ${script}\nexit=${r.code} ${r.ms}ms\n${r.stdout}\n${r.stderr}`);
  const errs = (r.stdout + r.stderr).match(/error TS\d+/g)?.length;
  return R.add({ id, title, status: r.code === 0 ? STATUS.PASS : STATUS.FAIL, detail: r.code === 0 ? `npm run ${script} exited 0 in ${r.ms} ms` : `npm run ${script} exited ${r.code}${errs ? `, ${errs} TypeScript errors` : ""}: ${firstLine(r.stderr || r.stdout)}`, log: lf, ms: r.ms });
};
npmStage("8", "Typecheck (npm run typecheck)", "typecheck");
npmStage("9", "Lint (npm run lint)", "lint");
buildOk = npmStage("10", "Production build (npm run build)", "build").status === STATUS.PASS;

// ------------------------------------------------------------------ 11 real browser + accessibility against the running app
async function realBrowser() {
  if (SKIP_APP) { for (const [id, title] of [["11", "Real browser validation (real routes, 5 viewports)"], ["11b", "Accessibility checks on the real app"]]) R.add({ id, title, status: STATUS.NOT_RUN, detail: "skipped by --skip-app (kit self-test run; never a gate run)" }); return; }
  const blockers = [];
  if (!buildOk) blockers.push("production build did not pass (stage 10)");
  if (!dbReady) blockers.push("no validated database (stage 4b)");
  const seedStage = R.stages.find((s) => s.id === "7c"); if (seedStage && seedStage.mandatory && seedStage.status !== STATUS.PASS) blockers.push(`E2E seed hook did not pass (stage 7c: ${seedStage.status})`);
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey) blockers.push("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set (they must point at the SAME scratch database and be set before the build)");
  if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) blockers.push("E2E_EMAIL / E2E_PASSWORD not set (a scratch user with seeded study data; see docs/VALIDATION_KIT.md)");
  const mk = (id, title, status, detail, extra = {}) => R.add({ id, title, status, detail, ...extra });
  if (blockers.length) { mk("11", "Real browser validation (real routes, 5 viewports)", STATUS.BLOCKED, blockers.join("; ")); mk("11b", "Accessibility checks on the real app", STATUS.BLOCKED, "requires stage 11 prerequisites"); return; }
  let server = null, url = baseUrl;
  if (!url) {
    server = cp.spawn(isWin ? "npm.cmd" : "npm", ["run", "start", "--", "-p", port], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
    let slog = ""; server.stdout.on("data", (d) => (slog += d)); server.stderr.on("data", (d) => (slog += d)); url = `http://127.0.0.1:${port}`;
    let up = false; for (let i = 0; i < 60 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); try { const r = await fetch(url + "/login"); up = r.status < 500; } catch {} }
    log("next_start.log", slog);
    if (!up) { server.kill(); mk("11", "Real browser validation (real routes, 5 viewports)", STATUS.FAIL, "next start did not become ready within 60 s (see next_start.log)"); mk("11b", "Accessibility checks on the real app", STATUS.NOT_RUN, "server not up"); return; }
  }
  const json = path.join(outDir, "e2e.json");
  const r = run("npm", ["run", "--silent", "e2e:real", "--", "--base-url", url, "--out", json], { env: { E2E_BASE_URL: url, E2E_ARTIFACTS_DIR: path.join(outDir, "e2e-artifacts") }, timeoutMs: 20 * 60 * 1000 });
  log("e2e.log", `exit=${r.code}\n${r.stdout}\n${r.stderr}`); server?.kill();
  let res = null; try { res = JSON.parse(fs.readFileSync(json, "utf8")); } catch {}
  if (!res) { mk("11", "Real browser validation (real routes, 5 viewports)", r.code === 3 ? STATUS.BLOCKED : STATUS.FAIL, "the browser harness produced no result file: " + firstLine(r.stderr || r.stdout), { log: "logs/e2e.log" }); mk("11b", "Accessibility checks on the real app", STATUS.NOT_RUN, "no result file"); return; }
  const agg = (items) => items.some((i) => i.status === STATUS.FAIL) ? STATUS.FAIL : items.some((i) => i.status === STATUS.BLOCKED) ? STATUS.BLOCKED : items.some((i) => i.status === STATUS.NOT_RUN) ? STATUS.NOT_RUN : STATUS.PASS;
  const fmt = (i) => `${i.status} ${i.name}${i.detail ? " :: " + i.detail : ""}`;
  mk("11", "Real browser validation (real routes, 5 viewports)", agg(res.routes), `${res.routes.filter((i) => i.status === STATUS.PASS).length}/${res.routes.length} route/viewport/flow checks passed`, { items: res.routes.map(fmt), log: "logs/e2e.log" });
  mk("11b", "Accessibility checks on the real app", agg(res.a11y), `${res.a11y.filter((i) => i.status === STATUS.PASS).length}/${res.a11y.length} passed`, { items: res.a11y.map(fmt) });
}
await realBrowser();

// ------------------------------------------------------------------ supporting evidence (never counts toward readiness)
if (!flag("--skip-supporting")) {
  const sup = (id, title, fn) => { const r = fn(); R.add({ id, title, category: "SUPPORTING", mandatory: false, ...r }); };
  sup("S2", "Static SQL audit over migrations 001-014 (NOT execution)", () => { const r = run(process.execPath, ["database/security/static_audit.cjs"]); const lf = log("static_audit.log", r.stdout + r.stderr); return { status: r.code === 0 ? STATUS.PASS : STATUS.FAIL, detail: firstLine(r.stdout) || firstLine(r.stderr), log: lf }; });
  sup("S7", "Hook dependency + eslint-directive check (approximation of react-hooks/exhaustive-deps; the real lint is stage 9)", () => { const r = run(process.execPath, ["scripts/lint/hook_deps_check.cjs"]); return { status: r.code === 0 ? STATUS.PASS : STATUS.FAIL, detail: firstLine(r.stdout) || firstLine(r.stderr) }; });
  sup("S9", "Kit + CI-gate self-tests incl. the gateway CORS check in real Chromium (npm run test:kit)", () => { const r = run("npm", ["run", "--silent", "test:kit"], { timeoutMs: 600000 }); log("kit_tests.log", r.stdout + r.stderr); const m = /# pass (\d+)[\s\S]*?# fail (\d+)/.exec(r.stdout); return { status: r.code === 0 ? STATUS.PASS : STATUS.FAIL, detail: m ? `${m[1]} passed, ${m[2]} failed` : firstLine(r.stderr || r.stdout) }; });
  sup("S3", "014_function_privileges.sql + matrix doc regenerate byte-identically", () => {
    const f1 = path.join(root, "database/migrations/014_function_privileges.sql"), f2 = path.join(root, "docs/SECURITY_FUNCTION_MATRIX.md"); const b = [fs.readFileSync(f1, "utf8"), fs.readFileSync(f2, "utf8")];
    const r = run(process.execPath, ["database/security/build_privileges.js"]); const a = [fs.readFileSync(f1, "utf8"), fs.readFileSync(f2, "utf8")];
    return { status: r.code === 0 && a[0] === b[0] && a[1] === b[1] ? STATUS.PASS : STATUS.FAIL, detail: r.code !== 0 ? firstLine(r.stderr) : a[0] === b[0] && a[1] === b[1] ? "regeneration changed nothing" : "regeneration CHANGED the committed files (they were stale; they have now been rewritten: review git diff)" };
  });
  sup("S4", "Node tests (node tests/study/run.js)", () => { const r = run(process.execPath, ["tests/study/run.js"]); const m = /(\d+) passed, (\d+) failed/.exec(r.stdout); log("node_tests.log", r.stdout + r.stderr); return { status: r.code === 0 ? STATUS.PASS : STATUS.FAIL, detail: m ? `${m[1]} passed, ${m[2]} failed` : firstLine(r.stderr || r.stdout) }; });
  sup("S5", "Reference oracle (node database/tests/reference/run_reference_tests.js)", () => { const r = run(process.execPath, ["database/tests/reference/run_reference_tests.js"]); return { status: r.code === 0 ? STATUS.PASS : STATUS.FAIL, detail: firstLine(r.stdout) || firstLine(r.stderr) }; });
  sup("S6", "Fixture component smoke in Chromium (NOT real-route validation)", () => {
    if (!has("python3") && !has("python")) return { status: STATUS.BLOCKED, detail: "python3 with playwright not available" };
    const b = run(process.execPath, ["tests/browser/build.js"]); if (b.code !== 0) return { status: STATUS.BLOCKED, detail: "smoke bundle could not be built (needs globally installed react, react-dom, esbuild via tsx): " + firstLine(b.stderr) };
    const g = run(process.execPath, ["tests/browser/gen.js"]); const p = run(has("python3") ? "python3" : "python", ["tests/browser/run.py"], { timeoutMs: 280000 }); log("fixture_smoke.log", b.stdout + g.stdout + p.stdout + p.stderr);
    const m = /(\d+) passed, (\d+) failed, of (\d+)/.exec(p.stdout); return m ? { status: +m[2] === 0 ? STATUS.PASS : STATUS.FAIL, detail: `${m[1]} passed, ${m[2]} failed of ${m[3]} (fixture data, fake APIs, no CSS)` } : { status: STATUS.BLOCKED, detail: firstLine(p.stderr || p.stdout) };
  });
}

// ------------------------------------------------------------------ 12 report
const v = R.verdict();
const md = [];
md.push(`# Phase 7 validation run ${stamp}`, "", `Verdict: **${v.ready ? "READY FOR PHASE 8" : "NOT READY FOR PHASE 8"}**`, "", "Legend: PASS = executed and succeeded; FAIL = executed and failed; BLOCKED = could not be executed (environment); NOT RUN = skipped because a prerequisite did not pass. Only MANDATORY stages decide readiness; SUPPORTING stages are evidence only.", "");
md.push("## Stages", "", mdTable(R.stages.map((s) => [s.id, s.title, s.category + (s.mandatory ? " (mandatory)" : ""), s.status, s.detail]), ["#", "Stage", "Category", "Status", "Detail"]), "");
const m4 = R.stages.find((s) => s.id === "4b"); md.push("## Migrations", "", mdTable(m4.items.map((i) => { const [num, st, ...rest] = i.split(" "); return [num, st, rest.join(" ")]; }), ["#", "Status", "Detail"]), "");
md.push("## SQL suites", "", mdTable(R.stages.filter((s) => ["5", "6", "7", "7b"].includes(s.id)).map((s) => [s.title, s.status, s.counts ? `${s.counts.passed}/${s.counts.total} passed, ${s.counts.failed} failed` : "0 executed", s.detail]), ["Suite", "Status", "Counts", "Detail"]), "");
for (const s of R.stages.filter((x) => x.items.length && !["4b", "3"].includes(x.id))) md.push(`### ${s.id} ${s.title}`, "", ...s.items.slice(0, 200).map((i) => `- ${i}`), "");
md.push("## Why the verdict is what it is", "", v.ready ? "Every mandatory stage executed and passed." : v.notPass.map((s) => `- stage ${s.id} ${s.title}: **${s.status}** (${s.detail.split("\n")[0].slice(0, 200)})`).join("\n"), "");
fs.writeFileSync(path.join(outDir, "report.md"), md.join("\n")); fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ stamp, verdict: v.ready ? "READY FOR PHASE 8" : "NOT READY FOR PHASE 8", stages: R.stages }, null, 1));
if (!argv.includes("--out")) { fs.mkdirSync(path.join(root, "reports/phase7"), { recursive: true }); fs.copyFileSync(path.join(outDir, "report.md"), path.join(root, "reports/phase7/latest.md")); }   // runs with an explicit --out (self-tests) never touch latest.md
R.add({ id: "12", title: "Report generation", status: STATUS.PASS, detail: path.relative(root, path.join(outDir, "report.md")) });
console.log(`\nReport: ${path.relative(root, path.join(outDir, "report.md"))}`);
console.log(v.ready ? "READY FOR PHASE 8" : "NOT READY FOR PHASE 8");
process.exit(v.ready ? 0 : 1);
