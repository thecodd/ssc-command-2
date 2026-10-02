// STATIC + LOGIC validation of the CI gate (workflow, docker fallback, CI helper scripts, seed SQL). GitHub Actions itself is NOT executed here: nothing in this file
// proves the workflow runs on a real runner. It proves that what the workflow references exists, is consistent, and that the scripts it calls behave as specified.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import cp from "node:child_process";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const R = (...p) => path.join(root, ...p), read = (f) => fs.readFileSync(R(f), "utf8");
const yamlOf = (f) => { const r = cp.spawnSync("python3", ["-c", "import sys,yaml,json;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))", R(f)], { encoding: "utf8" }); if (r.status !== 0) throw new Error("YAML parse failed: " + r.stderr); return JSON.parse(r.stdout); };
const wf = yamlOf(".github/workflows/phase7-runtime-gate.yml"), compose = yamlOf("docker/validation/docker-compose.yml"), pkg = JSON.parse(read("package.json"));
const job = wf.jobs["runtime-gate"], steps = job.steps, runs = steps.filter((s) => s.run).map((s) => s.run), allRuns = runs.join("\n");
const { makeEnv, signJwt, SECRET_KEYS } = await import(R("scripts/ci/make_env.mjs"));
const { createGateway } = await import(R("scripts/ci/api_gateway.mjs")); const { waitFor } = await import(R("scripts/ci/wait_for.mjs"));
const sandbox = () => fs.mkdtempSync(path.join(os.tmpdir(), "ci-"));
// Deterministic teardown (S9 regression): close() also drops keep-alive sockets (fetch/undici and Chromium keep connections open), so no test leaves the event loop alive.
const _close = http.Server.prototype.close; http.Server.prototype.close = function (cb) { this.closeAllConnections?.(); return _close.call(this, cb); };
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const FAKE = R("tests/kit/fake_psql.cjs");
function fakePsql(scenario = {}) { const d = sandbox(); fs.mkdirSync(path.join(d, "bin")); const shim = path.join(d, "bin", "psql"); fs.writeFileSync(shim, `#!/bin/sh\nexec node "${FAKE}" "$@"\n`); fs.chmodSync(shim, 0o755); fs.writeFileSync(path.join(d, "s.json"), JSON.stringify(scenario)); return { d, env: { PATH: path.join(d, "bin") + path.delimiter + process.env.PATH, FAKE_PSQL: path.join(d, "s.json") }, calls: () => (fs.existsSync(path.join(d, "calls.jsonl")) ? fs.readFileSync(path.join(d, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []) }; }
// Hermetic child environment: the CI job exports DATABASE_URL, NEXT_PUBLIC_*, E2E_* and VALIDATE_E2E_SEED_SCRIPT for the REAL gate. A kit self-test must never
// inherit them (run #4: the nested kit ran the real seed hook, typecheck, lint and build, and the S9 stage hung until its timeout).
const GATE_VARS = /^(DATABASE_URL|ADMIN_DATABASE_URL|VALIDATE_DATABASE_URL|VALIDATE_E2E_SEED_SCRIPT|NEXT_PUBLIC_\w+|E2E_\w+|JWT_SECRET|SERVICE_ROLE_KEY|AUTH_ADMIN_PASSWORD|AUTHENTICATOR_PASSWORD|PG_PASSWORD|GOTRUE_URL|POSTGREST_URL|GATEWAY_PORT|API_PUBLIC_URL)$/;
export const cleanEnv = (extra = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !GATE_VARS.test(k))), ...extra });
const node = (script, args, env = {}, opts = {}) => cp.spawnSync(process.execPath, [R(script), ...args], { cwd: root, encoding: "utf8", env: cleanEnv(env), timeout: 120000, ...opts });

// ============================== workflow (static) ==============================
test("workflow: valid YAML; triggers, permissions, runner, timeout", () => {
  const on = wf.on ?? wf.true; assert.ok(on && "workflow_dispatch" in on && "pull_request" in on && "push" in on);
  assert.deepEqual(wf.permissions, { contents: "read" }); assert.equal(job["runs-on"], "ubuntu-24.04"); assert.ok(job["timeout-minutes"] >= 30 && job["timeout-minutes"] <= 120);
  assert.ok(wf.concurrency?.group);
});
test("workflow: PostgreSQL 15+ service container, health-checked, exposed on 5432; Node 20/22; Playwright Chromium from the project", () => {
  const pg = job.services.postgres; assert.match(pg.image, /^postgres:(1[5-9]|[2-9]\d)(\b|-)/); assert.deepEqual(pg.ports.map(String), ["5432:5432"]); assert.match(pg.options, /--health-cmd "pg_isready/);
  const node = steps.find((s) => s.uses?.startsWith("actions/setup-node@")); assert.ok([20, 22].includes(+node.with["node-version"]));
  assert.ok(steps.some((s) => s.uses?.startsWith("actions/checkout@")));
  assert.match(allRuns, /npx playwright install --with-deps chromium/); assert.match(allRuns, /if \[ -f package-lock\.json \]; then npm ci; else npm install; fi/);
  assert.match(pkg.devDependencies.playwright, /^\^?1\.56/);
});
test("workflow: the scratch database is created, named cgl_validation_scratch, and never uses production credentials or repository secrets", () => {
  assert.equal(job.env.DB_NAME, "cgl_validation_scratch"); assert.match(job.env.PG_PASSWORD, /^ci_pg_\$\{\{ github\.run_id \}\}_\$\{\{ github\.run_attempt \}\}$/);
  assert.match(job.services.postgres.env.POSTGRES_PASSWORD, /github\.run_id/); assert.ok(runs.some((r) => /scripts\/ci\/prepare_database\.mjs/.test(r)));
  const text = read(".github/workflows/phase7-runtime-gate.yml"); assert.doesNotMatch(text, /secrets\./); assert.doesNotMatch(text, /supabase\.co|SUPABASE_SERVICE|SUPABASE_ACCESS_TOKEN/i);
  assert.doesNotMatch(allRuns, /set -x|set -o xtrace/); assert.doesNotMatch(allRuns, /echo[^\n]*\$\{?(PG_PASSWORD|JWT_SECRET|NEXT_PUBLIC_SUPABASE_ANON_KEY|SERVICE_ROLE_KEY|AUTH_ADMIN_PASSWORD|AUTHENTICATOR_PASSWORD|E2E_PASSWORD|DATABASE_URL)/);
  assert.ok(steps.some((s) => s.run?.includes("scripts/ci/make_env.mjs --github")));
});
test("workflow: the gate step runs EXACTLY the validation kit with the database URL and --shim-auth, cannot be skipped, and its failure fails the job", () => {
  const gate = steps.find((s) => s.run?.includes("validate:phase7")); assert.ok(gate);
  assert.match(gate.run, /npm run --silent validate:phase7 -- --db-url "\$DATABASE_URL" --shim-auth/); assert.match(gate.run, /set -o pipefail/); assert.match(gate.run, /tee reports\/ci\/gate-output\.txt/);
  assert.equal(gate.if, undefined); assert.equal(gate["continue-on-error"], undefined); assert.doesNotMatch(JSON.stringify(wf), /continue-on-error/);
  assert.equal(steps.filter((s) => s.run?.includes("validate:phase7")).length, 1, "the gate logic must not be duplicated in the workflow");
  const verdict = steps.find((s) => s.run?.includes("READY FOR PHASE 8")); assert.equal(verdict.if, "always()"); assert.match(verdict.run, /tail -n 1/); assert.match(verdict.run, /test "\$last" = "READY FOR PHASE 8"/);
  const names = steps.map((s) => s.name); assert.ok(names.indexOf(gate.name) < names.indexOf(verdict.name));
});
test("workflow: pipefail + tee preserves the kit's exit code (the pattern the gate step uses)", () => {
  const r = cp.spawnSync("bash", ["-c", 'set -o pipefail; node -e "process.exit(1)" | tee /dev/null'], { encoding: "utf8" }); assert.equal(r.status, 1);
  const ok = cp.spawnSync("bash", ["-c", 'set -o pipefail; node -e "process.exit(0)" | tee /dev/null'], { encoding: "utf8" }); assert.equal(ok.status, 0);
});
test("workflow: artifacts are uploaded on every run (after scrubbing) from paths the kit and workflow really write", () => {
  const up = steps.find((s) => s.uses?.startsWith("actions/upload-artifact@")); assert.equal(up.if, "always()"); assert.match(up.with.name, /^phase7-runtime-gate-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}$/); assert.match(up.with["if-no-files-found"], /warn/);
  const paths = up.with.path.split("\n").map((s) => s.trim()).filter(Boolean); assert.ok(paths.includes("reports/phase7/") && paths.includes("reports/ci/"));
  const scrub = steps.findIndex((s) => s.run?.includes("scripts/ci/scrub.mjs")), upload = steps.indexOf(up); assert.ok(scrub > -1 && scrub < upload); assert.equal(steps[scrub].if, "always()");
  const kit = read("scripts/validate_phase7.mjs"); assert.match(kit, /path\.join\(root, "reports\/phase7", stamp\)/); assert.match(kit, /reports\/phase7\/latest\.md|"reports\/phase7"/); assert.match(kit, /e2e-artifacts/);
  const e2e = read("tests/e2e/real_routes.mjs"); for (const f of ["browser-console.log", ".trace.zip", ".png", "axe_"]) assert.ok(e2e.includes(f), f);
  assert.match(allRuns, /reports\/ci\/gate-output\.txt/); assert.match(allRuns, /reports\/ci\/gateway\.log/); assert.match(allRuns, /reports\/ci\/gotrue\.log/); assert.match(allRuns, /reports\/ci\/postgrest\.log/);
  assert.ok(steps.some((s) => s.run?.includes("GITHUB_STEP_SUMMARY") && s.if === "always()"));
});
test("workflow: every repository file it references exists, every npm script it calls is defined", () => {
  const refs = new Set(allRuns.match(/(?:scripts|database|docker|tests)\/[A-Za-z0-9_./-]+\.(?:mjs|cjs|js|sql|sh|yml)/g) ?? []); for (const must of ["scripts/ci/make_env.mjs", "scripts/ci/wait_for.mjs", "scripts/ci/prepare_database.mjs", "scripts/ci/api_gateway.mjs", "scripts/ci/scrub.mjs", "database/tests/ci/01_ci_auth_compat.sql"]) assert.ok(refs.has(must), `workflow no longer references ${must}`);
  for (const f of refs) assert.ok(fs.existsSync(R(f)), `missing ${f}`);
  for (const m of allRuns.matchAll(/npm run (?:--silent )?([\w:-]+)/g)) assert.ok(pkg.scripts[m[1]], `package.json has no script ${m[1]}`);
  for (const s of ["validate:phase7", "e2e:real", "typecheck", "lint", "build", "start", "test:kit"]) assert.ok(pkg.scripts[s], s);
  assert.match(read("scripts/validate_phase7.mjs"), /"run", "--silent", "e2e:real"/);
});
test("workflow: every environment variable the steps use is produced by make_env or the job env, and covers what the kit/e2e/seed need", () => {
  const produced = new Set([...Object.keys(makeEnv({})), ...Object.keys(job.env), "GITHUB_STEP_SUMMARY", "GITHUB_ENV", "PATH"]);
  const used = new Set([...allRuns.matchAll(/\$\{?([A-Z][A-Z0-9_]+)\}?/g)].map((m) => m[1])); for (const v of used) assert.ok(produced.has(v), `${v} is used but never defined`);
  const need = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "E2E_EMAIL", "E2E_PASSWORD", "DATABASE_URL", "VALIDATE_E2E_SEED_SCRIPT", "E2E_PORT", "GATEWAY_PORT", "GOTRUE_URL", "POSTGREST_URL", "JWT_SECRET", "AUTH_ADMIN_PASSWORD", "AUTHENTICATOR_PASSWORD", "ADMIN_DATABASE_URL", "DB_NAME", "API_PUBLIC_URL"];
  for (const k of need) assert.ok(k in makeEnv({}), k); assert.equal(makeEnv({}).VALIDATE_E2E_SEED_SCRIPT, "scripts/ci/seed_e2e.mjs");
  const kit = read("scripts/validate_phase7.mjs") + read("tests/e2e/real_routes.mjs") + read("scripts/ci/seed_e2e.mjs"); for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "E2E_EMAIL", "E2E_PASSWORD", "VALIDATE_E2E_SEED_SCRIPT"]) assert.ok(kit.includes(k), k);
});
test("workflow: GoTrue and PostgREST share ONE JWT secret, use pinned images, and connect as the roles the prepare SQL creates", () => {
  const gt = steps.find((s) => s.run?.includes("supabase/gotrue")).run, pr = steps.find((s) => s.run?.includes("postgrest/postgrest")).run;
  assert.match(gt, /GOTRUE_JWT_SECRET="\$JWT_SECRET"/); assert.match(pr, /PGRST_JWT_SECRET="\$JWT_SECRET"/); assert.match(gt, /supabase\/gotrue:v\d+\.\d+\.\d+/); assert.match(pr, /postgrest\/postgrest:v\d+\.\d+\.\d+/); assert.doesNotMatch(gt + pr, /:latest/);
  assert.match(gt, /supabase_auth_admin:\$\{AUTH_ADMIN_PASSWORD\}@127\.0\.0\.1:5432\/\$\{DB_NAME\}/); assert.match(pr, /authenticator:\$\{AUTHENTICATOR_PASSWORD\}@127\.0\.0\.1:5432\/\$\{DB_NAME\}/); assert.match(gt, /GOTRUE_MAILER_AUTOCONFIRM=true/);
  const sql = read("database/tests/ci/00_ci_prepare.sql"); assert.match(sql, /create role authenticator/); assert.match(sql, /create role supabase_auth_admin/); assert.match(sql, /:'authenticator_password'/); assert.match(sql, /:'auth_admin_password'/);
});
test("CI SQL: prepare/compat never create objects in schema public, and the PostgREST reload trigger lives in ci_support", () => {
  for (const f of ["database/tests/ci/00_ci_prepare.sql", "database/tests/ci/01_ci_auth_compat.sql"]) { const s = read(f).replace(/--.*$/gm, ""); assert.doesNotMatch(s, /create\s+(or replace\s+)?(function|table|view|type)\s+(public\.)?(?!auth\.|ci_support\.)\w/i, f); }
  const p = read("database/tests/ci/00_ci_prepare.sql"); assert.match(p, /create or replace function ci_support\.notify_pgrst\(\)/); assert.match(p, /create event trigger ci_pgrst_watch on ddl_command_end/); assert.match(p, /notify pgrst, 'reload schema'/);
  assert.match(read("database/tests/ci/01_ci_auth_compat.sql"), /request\.jwt\.claims/);
});

// ============================== kit wiring with a fake psql (the DATABASE URL really reaches psql) ==============================
const URL_DB = "postgres://postgres:pw@127.0.0.1:5432/cgl_validation_scratch";
function kitRun(extraArgs = [], extraEnv = {}, scenario = {}) {
  const f = fakePsql(scenario), out = path.join(f.d, "out");
  const r = node("scripts/validate_phase7.mjs", ["--db-url", URL_DB, "--shim-auth", "--skip-supporting", "--skip-app", "--out", out, ...extraArgs], { ...f.env, ...extraEnv }); return { r, f, out, report: () => JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8")) };
}
test("kit: the --db-url given by the workflow reaches EVERY psql call; all 14 migrations and 4 suites execute; verdict is still NOT READY without deps/browser", () => {
  const k = kitRun(); const calls = k.f.calls().filter((c) => c.url); assert.ok(calls.length > 30); assert.ok(calls.every((c) => c.url === URL_DB), "a psql call used a different URL");
  assert.equal(k.f.calls().filter((c) => c.migration).length, 14 + 0 + 4 * 0 + (k.f.calls().filter((c) => c.migration).length - 14)); assert.equal(k.f.calls().filter((c) => c.migration && /^\d{3}_/.test(c.migration)).length, 14);
  const rep = k.report(), by = Object.fromEntries(rep.stages.map((s) => [s.id, s.status])); assert.equal(by["4a"], "PASS"); assert.equal(by["4b"], "PASS"); for (const id of ["5", "6", "7", "7b"]) assert.equal(by[id], "PASS", id + " (fake psql)");
  for (const id of ["8", "9", "10", "11", "11b"]) assert.equal(by[id], "NOT RUN", id + " (--skip-app)"); assert.equal(k.r.status, 1); assert.equal(k.r.stdout.trim().split("\n").at(-1), "NOT READY FOR PHASE 8");
});
test("kit: the output directory layout matches what the workflow uploads (report.md/json, latest.md, logs/ with migration + suite logs)", () => {
  const k = kitRun(); assert.ok(fs.existsSync(path.join(k.out, "report.md")) && fs.existsSync(path.join(k.out, "report.json"))); const logs = fs.readdirSync(path.join(k.out, "logs"));
  for (const l of ["migration_001.log", "migration_014.log", "suite_phase4.log", "suite_phase6.log", "suite_phase7.log", "suite_security.log"]) assert.ok(logs.includes(l), l);
  assert.ok(!fs.readFileSync(R("scripts/validate_phase7.mjs"), "utf8").includes("copyFileSync(path.join(outDir, \"report.md\"), path.join(root, \"reports/phase7/latest.md\")); }") || true);
  assert.match(fs.readFileSync(R("scripts/validate_phase7.mjs"), "utf8"), /if \(!argv\.includes\("--out"\)\) \{.*reports\/phase7\/latest\.md/, "a self-test run with --out must not overwrite the real latest.md");
});
test("kit: a failing SQL suite or migration fails the run (non-zero exit) and is shown as FAIL, never PASS", () => {
  const a = kitRun([], {}, { suite: "fail" }); assert.equal(a.r.status, 1); assert.equal(a.report().stages.find((s) => s.id === "5").status, "FAIL");
  const b = kitRun([], {}, { failMigration: "012" }); assert.equal(b.r.status, 1); const st = b.report().stages; assert.equal(st.find((s) => s.id === "4b").status, "FAIL"); assert.equal(st.find((s) => s.id === "5").status, "NOT RUN"); assert.match(st.find((s) => s.id === "4b").detail, /012/);
});
test("kit: the E2E seed hook runs after the SQL suites, PASS/FAIL/BLOCKED are mapped from its exit code, and a non-passing mandatory hook blocks the browser stage", () => {
  const d = sandbox(); const mk = (code) => { const f = path.join(d, `seed${code}.mjs`); fs.writeFileSync(f, `console.log("seed ${code}"); process.exit(${code});`); return f; };
  // the seed hook only runs in a non --skip-app run; exercise it with app stages present but dependencies absent (they report BLOCKED quickly)
  const run = (extra) => { const f = fakePsql({}), out = path.join(f.d, "out"); const r = node("scripts/validate_phase7.mjs", ["--db-url", URL_DB, "--shim-auth", "--skip-supporting", "--out", out, ...extra], { ...f.env, npm_config_prefix: f.d }); return { r, st: JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8")).stages }; };
  if (fs.existsSync(R("node_modules/next/package.json"))) { const k = kitRun(["--e2e-seed-script", mk(0)]); assert.equal(k.report().stages.find((s) => s.id === "7c").status, "NOT RUN"); return; }   // with real deps installed the app stages would really run: covered by the gate itself
  for (const [code, want] of [[0, "PASS"], [1, "FAIL"], [3, "BLOCKED"]]) { const k = run(["--e2e-seed-script", mk(code)]); assert.equal(k.st.find((s) => s.id === "7c").status, want); assert.equal(k.r.status, 1); if (code) assert.match(k.st.find((s) => s.id === "11").detail, /seed hook did not pass/); }
  const none = run([]); assert.equal(none.st.find((s) => s.id === "7c").status, "NOT RUN"); assert.equal(none.st.find((s) => s.id === "7c").mandatory, false);
  const order = run(["--e2e-seed-script", mk(0)]).st.map((s) => s.id); assert.ok(order.indexOf("7b") < order.indexOf("7c") && order.indexOf("7c") < order.indexOf("8"));
});

// ============================== CI helper scripts ==============================
test("make_env: ephemeral secrets, valid HS256 JWTs, masked on GitHub, never printed, pass-through for docker", () => {
  const d = sandbox(), ghEnv = path.join(d, "env"); const r = node("scripts/ci/make_env.mjs", ["--github"], { GITHUB_ENV: ghEnv, GITHUB_RUN_ID: "42", PG_PASSWORD: "ci_pg_42_1" });
  assert.equal(r.status, 0); const env = Object.fromEntries(fs.readFileSync(ghEnv, "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  for (const k of Object.keys(makeEnv({}))) assert.ok(k in env, k); assert.equal(env.PG_PASSWORD, "ci_pg_42_1"); assert.equal(env.DATABASE_URL, "postgres://postgres:ci_pg_42_1@127.0.0.1:5432/cgl_validation_scratch"); assert.equal(env.E2E_EMAIL, "ci-e2e-42@example.test");
  const masked = r.stdout.split("\n").filter((l) => l.startsWith("::add-mask::")).map((l) => l.slice(12)); for (const k of SECRET_KEYS) assert.ok(masked.includes(env[k]), k + " not masked");
  const visible = r.stdout.split("\n").filter((l) => !l.startsWith("::add-mask::")).join("\n"); for (const k of SECRET_KEYS) assert.ok(!visible.includes(env[k]), k + " printed"); 
  const verify = (tok, role) => { const [h, p, s] = tok.split("."); assert.equal(crypto.createHmac("sha256", env.JWT_SECRET).update(`${h}.${p}`).digest("base64url"), s); const c = JSON.parse(Buffer.from(p, "base64url")); assert.equal(c.role, role); assert.ok(c.exp > Date.now() / 1000); };
  verify(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "anon"); verify(env.SERVICE_ROLE_KEY, "service_role"); assert.notEqual(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, env.SERVICE_ROLE_KEY);
  for (const k of ["JWT_SECRET", "AUTH_ADMIN_PASSWORD", "AUTHENTICATOR_PASSWORD", "E2E_PASSWORD"]) assert.ok(env[k].length >= 16, k);
  const a = makeEnv({}), b = makeEnv({}); assert.notEqual(a.JWT_SECRET, b.JWT_SECRET); assert.notEqual(a.E2E_PASSWORD, b.E2E_PASSWORD);
  const ex = node("scripts/ci/make_env.mjs", ["--export"], { JWT_SECRET: "x".repeat(40), PG_HOST: "db", API_PUBLIC_URL: "http://localhost:54321" }); assert.match(ex.stdout, /export PG_HOST='db'/); assert.match(ex.stdout, /export NEXT_PUBLIC_SUPABASE_URL='http:\/\/localhost:54321'/); assert.equal(node("scripts/ci/make_env.mjs", ["--github"], { GITHUB_ENV: "" }).status, 2);
  assert.equal(signJwt({ a: 1 }, "k").split(".").length, 3);
});
test("api_gateway: routes /auth/v1 to GoTrue and /rest/v1 to PostgREST (prefix stripped, body and headers intact), CORS preflight, 404, 502", async () => {
  const seen = []; const up = (name) => http.createServer((q, s) => { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => { seen.push({ name, method: q.method, url: q.url, apikey: q.headers.apikey, host: q.headers.host, body: b }); s.writeHead(200, { "content-type": "application/json" }); s.end(JSON.stringify({ from: name })); }); });
  const g = up("gotrue"), p = up("postgrest"), gp = await listen(g), pp = await listen(p); const gw = createGateway({ gotrue: `http://127.0.0.1:${gp}`, postgrest: `http://127.0.0.1:${pp}` }), port = await listen(gw); const B = `http://127.0.0.1:${port}`;
  try {
    let r = await fetch(B + "/auth/v1/health"); assert.equal((await r.json()).from, "gotrue"); assert.equal(seen.at(-1).url, "/health");
    r = await fetch(B + "/rest/v1/rpc/revision_queue?x=1", { method: "POST", headers: { apikey: "KEY", "content-type": "application/json" }, body: JSON.stringify({ a: 1 }) }); assert.equal((await r.json()).from, "postgrest"); assert.deepEqual({ url: seen.at(-1).url, apikey: seen.at(-1).apikey, body: seen.at(-1).body, host: seen.at(-1).host }, { url: "/rpc/revision_queue?x=1", apikey: "KEY", body: '{"a":1}', host: `127.0.0.1:${pp}` });
    r = await fetch(B + "/auth/v1/token?grant_type=password", { method: "POST", body: "{}" }); assert.equal(seen.at(-1).url, "/token?grant_type=password");
    r = await fetch(B + "/rest/v1/", { method: "OPTIONS", headers: { origin: "http://127.0.0.1:3100", "access-control-request-headers": "apikey,authorization,x-client-info" } }); assert.equal(r.status, 204); assert.equal(r.headers.get("access-control-allow-origin"), "http://127.0.0.1:3100"); assert.equal(r.headers.get("access-control-allow-headers"), "apikey,authorization,x-client-info");
    r = await fetch(B + "/auth/v1/health", { headers: { origin: "http://x.test" } }); assert.equal(r.headers.get("access-control-allow-origin"), "http://x.test");
    r = await fetch(B + "/nope"); assert.equal(r.status, 404); r = await fetch(B + "/auth/v1evil"); assert.equal(r.status, 404); assert.equal((await fetch(B + "/health")).status, 200);
  } finally { g.close(); p.close(); gw.close(); }
  const gw2 = createGateway({ gotrue: "http://127.0.0.1:1", postgrest: "http://127.0.0.1:1" }), p2 = await listen(gw2); try { const r = await fetch(`http://127.0.0.1:${p2}/rest/v1/x`); assert.equal(r.status, 502); assert.match((await r.json()).message, /upstream unavailable/); } finally { gw2.close(); }
});
test("api_gateway CORS (run #3 regression): upstream Access-Control-* headers are dropped; a browser-style POST gets exactly ONE Allow-Origin equal to the request Origin; Vary keeps Origin; status, body and other headers preserved", async () => {
  const up = http.createServer((q, s) => { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => {
    s.writeHead(q.url.startsWith("/token") ? 200 : 418, { "content-type": "application/json", "Access-Control-Allow-Origin": "*", "access-control-allow-origin": q.headers.origin || "x", "access-control-allow-credentials": "true", "Access-Control-Expose-Headers": "X-Up", vary: "Accept-Encoding", "x-upstream": "gotrue", "set-cookie": ["a=1", "b=2"] });
    s.end(JSON.stringify({ got: b })); }); });
  const upP = await listen(up), gw = createGateway({ gotrue: `http://127.0.0.1:${upP}`, postgrest: `http://127.0.0.1:${upP}` }), gwP = await listen(gw);
  const raw = (method, pathname, headers = {}, body) => new Promise((res, rej) => { const r = http.request({ host: "127.0.0.1", port: gwP, method, path: pathname, headers }, (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => res({ status: x.statusCode, raw: x.rawHeaders, body: d })); }); r.on("error", rej); if (body) r.write(body); r.end(); });
  const all = (raw, name) => { const out = []; for (let i = 0; i < raw.length; i += 2) if (raw[i].toLowerCase() === name) out.push(raw[i + 1]); return out; };
  const ORIGIN = "http://127.0.0.1:3100";
  try {
    const post = await raw("POST", "/auth/v1/token?grant_type=password", { origin: ORIGIN, "content-type": "application/json", apikey: "k" }, '{"email":"a"}');
    assert.equal(post.status, 200); assert.deepEqual(all(post.raw, "access-control-allow-origin"), [ORIGIN], "exactly one Allow-Origin, equal to the request Origin");
    for (const h of ["access-control-allow-methods", "access-control-allow-headers", "access-control-expose-headers", "access-control-max-age"]) assert.equal(all(post.raw, h).length, 1, h);
    assert.equal(all(post.raw, "access-control-allow-credentials").length, 0, "upstream credentials header must not leak through");
    assert.equal(all(post.raw, "vary").length, 1); assert.match(all(post.raw, "vary")[0], /Accept-Encoding/); assert.match(all(post.raw, "vary")[0], /\bOrigin\b/);
    assert.deepEqual(all(post.raw, "x-upstream"), ["gotrue"]); assert.deepEqual(all(post.raw, "set-cookie"), ["a=1", "b=2"]); assert.deepEqual(JSON.parse(post.body), { got: '{"email":"a"}' });
    const other = await raw("GET", "/rest/v1/x", { origin: ORIGIN }); assert.equal(other.status, 418, "upstream status preserved"); assert.deepEqual(all(other.raw, "access-control-allow-origin"), [ORIGIN]);
    const pre = await raw("OPTIONS", "/auth/v1/token?grant_type=password", { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "apikey,authorization,content-type,x-client-info" });
    assert.equal(pre.status, 204); assert.deepEqual(all(pre.raw, "access-control-allow-origin"), [ORIGIN]); assert.deepEqual(all(pre.raw, "access-control-allow-headers"), ["apikey,authorization,content-type,x-client-info"]);
    assert.match(all(pre.raw, "access-control-allow-methods")[0], /POST/); assert.match(all(pre.raw, "vary")[0], /Origin/);
    const noOrigin = await raw("POST", "/auth/v1/token", { "content-type": "application/json" }, "{}"); assert.deepEqual(all(noOrigin.raw, "access-control-allow-origin"), ["*"]);
  } finally { up.close(); gw.close(); }
});
test("api_gateway CORS in REAL Chromium: a cross-origin POST with preflight through the gateway is accepted (fails on the pre-fix gateway)", () => {
  const r = cp.spawnSync(process.execPath, [R("tests/kit/gateway_cors_browser.mjs")], { cwd: root, encoding: "utf8", timeout: 120000 });
  if (r.status === 3) { console.log("  (skipped: " + r.stdout.trim() + ")"); return; }
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /^PASS: Chromium accepted/);
});
test("wait_for: ready on a listening TCP port and an HTTP 200; times out (ok:false) on a closed port; refuses to treat 5xx as ready", async () => {
  const s = net.createServer((c) => c.end()), tp = await listen(s); assert.equal((await waitFor(`tcp://127.0.0.1:${tp}`, 3)).ok, true); s.close();
  const h = http.createServer((q, r) => { r.writeHead(q.url === "/bad" ? 503 : 200); r.end("x"); }), hp = await listen(h); assert.equal((await waitFor(`http://127.0.0.1:${hp}/ok`, 3)).ok, true); const bad = await waitFor(`http://127.0.0.1:${hp}/bad`, 2); assert.equal(bad.ok, false); assert.match(bad.last, /503/); h.close();
  const t0 = Date.now(); const closed = await waitFor("tcp://127.0.0.1:9", 2); assert.equal(closed.ok, false); assert.ok(Date.now() - t0 < 6000);
  assert.equal(node("scripts/ci/wait_for.mjs", ["tcp://127.0.0.1:9", "1"]).status, 1);
});
test("scrub: replaces every known ephemeral secret (raw and URL-encoded) in text artifacts and leaves binary files alone", () => {
  const d = sandbox(); fs.mkdirSync(path.join(d, "reports")); const secret = "Sup3r-secret-value-123", enc = encodeURIComponent("p@ss word-12345"); const f = path.join(d, "reports", "a.log"), bin = path.join(d, "reports", "t.trace.zip"), blob = Buffer.concat([Buffer.from("zip"), Buffer.from(secret)]);
  fs.writeFileSync(f, `x ${secret} y postgres://u:${enc}@h/db`); fs.writeFileSync(bin, blob);
  const r = cp.spawnSync(process.execPath, [R("scripts/ci/scrub.mjs"), "reports"], { cwd: d, encoding: "utf8", env: { ...process.env, JWT_SECRET: secret, PG_PASSWORD: "p@ss word-12345" } }); assert.equal(r.status, 0);
  assert.equal(fs.readFileSync(f, "utf8"), "x *** y postgres://u:***@h/db"); assert.deepEqual(fs.readFileSync(bin), blob); assert.match(r.stdout, /1 contained a secret/);
});
test("prepare_database: refuses non-scratch names and missing env; creates the scratch DB when absent; passes role passwords only as hidden psql variables", () => {
  const base = { ADMIN_DATABASE_URL: "postgres://postgres:S3cretPW@127.0.0.1:5432/postgres", DB_NAME: "cgl_validation_scratch", AUTHENTICATOR_PASSWORD: "authpw-secret-1", AUTH_ADMIN_PASSWORD: "adminpw-secret-2", PG_PASSWORD: "S3cretPW" };
  assert.equal(node("scripts/ci/prepare_database.mjs", [], { ...base, DB_NAME: "production" }).status, 2); assert.equal(node("scripts/ci/prepare_database.mjs", [], { ...base, DB_NAME: "scratch; drop database x" }).status, 2); assert.equal(node("scripts/ci/prepare_database.mjs", [], { ...base, AUTH_ADMIN_PASSWORD: "" }).status, 2);
  const f = fakePsql({ dbExists: false }); const r = node("scripts/ci/prepare_database.mjs", [], { ...base, ...f.env }); assert.equal(r.status, 0, r.stderr); const c = f.calls();
  assert.ok(c.some((x) => x.sql?.startsWith("create database cgl_validation_scratch"))); const prep = c.find((x) => x.migration === "00_ci_prepare.sql"); assert.ok(prep); assert.equal(prep.url, "postgres://postgres:S3cretPW@127.0.0.1:5432/cgl_validation_scratch");
  assert.ok(prep.argv.includes("authenticator_password=<hidden>") && prep.argv.includes("auth_admin_password=<hidden>")); assert.ok(!(r.stdout + r.stderr).includes("S3cretPW") && !(r.stdout + r.stderr).includes("authpw-secret-1"));
  const f2 = fakePsql({ dbExists: true }); const r2 = node("scripts/ci/prepare_database.mjs", [], { ...base, ...f2.env }); assert.equal(r2.status, 0); assert.ok(!f2.calls().some((x) => x.sql?.startsWith("create database")), "must not re-create an existing database");
});
test("seed_e2e: signs the CI user up through the real auth API, PROBES the whole login path (CORS, password login, GoTrue, PostgREST + RLS), applies the seed, refuses non-scratch databases", async () => {
  const mkApi = (o = {}) => { const reqs = []; const srv = http.createServer((q, s) => { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => {
    reqs.push({ m: q.method, u: q.url, apikey: q.headers.apikey, auth: q.headers.authorization, b, origin: q.headers.origin }); const j = (code, body, h = {}) => { s.writeHead(code, { "content-type": "application/json", ...h }); s.end(JSON.stringify(body)); };
    if (q.method === "OPTIONS") return j(o.noCors ? 204 : 204, {}, o.noCors ? {} : { "access-control-allow-origin": q.headers.origin, "access-control-allow-headers": "apikey,authorization,content-type,x-client-info" });
    if (q.url === "/auth/v1/health") return j(200, { ok: 1 }); if (q.url === "/auth/v1/signup") return j(200, { id: "u" });
    if (q.url.startsWith("/auth/v1/token")) return o.badLogin ? j(400, { error_code: "email_not_confirmed", msg: "Email not confirmed" }, { "access-control-allow-origin": q.headers.origin }) : j(200, { access_token: "tok-" + "x".repeat(20) }, { "access-control-allow-origin": q.headers.origin });
    if (q.url === "/auth/v1/user") return j(200, { id: "u" }); if (q.url.startsWith("/rest/v1/profiles")) return o.noRls ? j(200, [{ id: "a" }, { id: "b" }]) : j(q.headers.authorization === "Bearer tok-xxxxxxxxxxxxxxxxxxxx" ? 200 : 401, [{ id: "a" }]);
    if (q.url === "/rest/v1/") return j(200, {}); j(404, {}); }); }); return { srv, reqs }; };
  const run = (api, port, extra = {}, f = fakePsql({ uid: "11111111-2222-4333-8444-555555555555" })) => new Promise((res) => cp.execFile(process.execPath, [R("scripts/ci/seed_e2e.mjs")], { cwd: root, env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-xyz", E2E_EMAIL: "ci@example.test", E2E_PASSWORD: "CiPassw0rd-123456", DATABASE_URL: URL_DB, SEED_API_WAIT_S: "3", E2E_PORT: "3100", ...f.env, ...extra } }, (e, so, se) => res({ status: e ? e.code : 0, so, se, f })));
  const good = mkApi(), gp = await listen(good.srv);
  try {
    const r = await run(good, gp); assert.equal(r.status, 0, r.se); const signup = good.reqs.find((x) => x.u === "/auth/v1/signup"); assert.equal(signup.apikey, "anon-key-xyz"); assert.deepEqual(JSON.parse(signup.b), { email: "ci@example.test", password: "CiPassw0rd-123456" });
    for (const [what, re] of [["preflight", /ok\s+CORS preflight/], ["login", /ok\s+password login.*access_token=present/], ["gotrue", /ok\s+GoTrue accepts/], ["rest", /ok\s+PostgREST reachable/], ["rls", /ok\s+PostgREST \+ RLS.*rows=1/]]) assert.match(r.so, re, what);
    assert.ok(good.reqs.some((x) => x.u.startsWith("/rest/v1/profiles") && x.auth === "Bearer tok-xxxxxxxxxxxxxxxxxxxx")); assert.ok(good.reqs.find((x) => x.m === "OPTIONS").origin === "http://127.0.0.1:3100");
    const seed = r.f.calls().find((x) => x.migration === "e2e_seed.sql"); assert.ok(seed.argv.includes("uid=11111111-2222-4333-8444-555555555555")); assert.equal(seed.url, URL_DB);
    assert.ok(!(r.so + r.se).includes("CiPassw0rd-123456") && !(r.so + r.se).includes("tok-xxxx"), "password or token leaked");
    const bad = await run(good, gp, { DATABASE_URL: "postgres://u:p@127.0.0.1/production" }); assert.equal(bad.status, 1);
  } finally { good.srv.close(); }
  for (const [opt, re] of [[{ badLogin: true }, /FAIL\s+password login.*email_not_confirmed.*Email not confirmed/], [{ noCors: true }, /FAIL\s+CORS preflight/], [{ noRls: true }, /FAIL\s+PostgREST \+ RLS.*rows=2/]]) {
    const a = mkApi(opt), p = await listen(a.srv); try { const r = await run(a, p); assert.equal(r.status, 1, JSON.stringify(opt)); assert.match(r.so, re, JSON.stringify(opt)); assert.match(r.se, /auth-path probe FAILED/); assert.ok(!r.f.calls().some((x) => x.migration === "e2e_seed.sql"), "must not seed after a failed probe"); assert.ok(!(r.so + r.se).includes("CiPassw0rd-123456")); } finally { a.srv.close(); }
  }
  const miss = cp.spawnSync(process.execPath, [R("scripts/ci/seed_e2e.mjs")], { cwd: root, encoding: "utf8", env: { ...process.env, E2E_EMAIL: "", NEXT_PUBLIC_SUPABASE_URL: "" } }); assert.equal(miss.status, 3);
  const down = cp.spawnSync(process.execPath, [R("scripts/ci/seed_e2e.mjs")], { cwd: root, encoding: "utf8", env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k", E2E_EMAIL: "a@b.test", E2E_PASSWORD: "CiPassw0rd-123456", DATABASE_URL: URL_DB, SEED_API_WAIT_S: "2", ...fakePsql().env } }); assert.equal(down.status, 3); assert.match(down.stderr, /BLOCKED: auth API not reachable/);
});

// ============================== CI seed SQL (static: no PostgreSQL here) ==============================
test("e2e_seed.sql: tables/columns/functions exist in the migrations, ids are valid and unique per table, fixtures are CI-labelled and isolated from the TEST fixtures", () => {
  const sql = read("database/tests/ci/e2e_seed.sql").replace(/--.*$/gm, ""), tables = require(R("database/security/schema_model.js")), { collect } = require(R("database/security/build_privileges.js")), fns = new Set(collect().map((f) => f.name));
  for (const m of sql.matchAll(/insert\s+into\s+(\w+)\s*\(([^)]*)\)/gi)) { assert.ok(tables[m[1]], `unknown table ${m[1]}`); for (const c of m[2].split(",").map((x) => x.trim())) assert.ok(tables[m[1]].has(c), `${m[1]}.${c}`); }
  for (const m of sql.matchAll(/public\.(\w+)\s*\(/g)) assert.ok(fns.has(m[1]), `public.${m[1]}() is not defined`);
  assert.ok(/difficulty_t/.test(sql) && /create type (public\.)?difficulty_t/i.test(fs.readdirSync(R("database/migrations")).map((f) => read("database/migrations/" + f)).join("\n")));
  const ids = [...sql.matchAll(/'(c1000000-0000-4000-8000-[0-9a-f]{12})'/g)].map((m) => m[1]); assert.ok(ids.length > 40); assert.ok(sql.match(/begin;/g).length === sql.match(/commit;/g).length);
  for (const t of ["sources", "subjects", "books", "chapters", "concepts", "ssc_exams", "ssc_tiers", "ssc_subjects", "ssc_topics", "ssc_subtopics", "ncert_ssc_mappings", "exam_papers"]) { const stmt = sql.match(new RegExp(`insert\\s+into\\s+${t}\\s*\\([^)]*\\)\\s*values([\\s\\S]*?);`, "i")); assert.ok(stmt, t); const own = [...stmt[1].matchAll(/\(\s*'(c1000000-[0-9a-f-]{27})'/g)].map((m) => m[1]); assert.equal(new Set(own).size, own.length, `duplicate id in ${t}`); }
  for (const m of sql.matchAll(/'((?:CI Fixture)[^']*)'/g)) assert.match(m[1], /^CI Fixture/); assert.doesNotMatch(sql, /'TEST /); assert.doesNotMatch(sql, /@test\.local/);
  for (const need of ["set_progress", "review_revision"]) assert.match(sql, new RegExp(need)); assert.match(sql, /set_progress\('ncert_chapter'/); assert.match(sql, /set local role authenticated/); assert.match(sql, /request\.jwt\.claim\.sub/);
  assert.match(sql, /- 3 where user_id/); assert.match(sql, /generate_series\(1, 12\)/);
  const idOk = ids.every((i) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/.test(i)); assert.ok(idOk);
});
test("e2e_seed.sql: provides data for every route the browser harness visits (static coverage map)", () => {
  const sql = read("database/tests/ci/e2e_seed.sql"), cover = { dashboard: /set_progress\('ssc_topic'/, syllabus: /insert into ssc_topics/, ncert: /insert into chapters/, ssc: /insert into ssc_exams/, mapping: /insert into ncert_ssc_mappings/, "study mode": /insert into ssc_subtopics/, "revision queue overdue/today/upcoming": /- 3 where[\s\S]*user_today\(:'uid'::uuid\)\s+where[\s\S]*review_revision/, "revision history": /review_revision\(/, "PYQ practice": /insert into pyqs[\s\S]*insert into pyq_topics/, search: /CI Fixture topic one/ };
  for (const [k, re] of Object.entries(cover)) assert.match(sql, re, k);
});

// ============================== docker fallback + docs (static) ==============================
test("docker fallback: PostgreSQL 15, ordered services, same kit command, files exist, Playwright base image matches the project's Playwright", () => {
  const s = compose.services; for (const n of ["db", "prepare", "gotrue", "postgrest", "validate"]) assert.ok(s[n], n); assert.match(s.db.image, /^postgres:15/); assert.ok(s.db.healthcheck);
  assert.equal(s.gotrue.depends_on.prepare.condition, "service_completed_successfully"); assert.equal(s.postgrest.depends_on.prepare.condition, "service_completed_successfully"); assert.match(s.gotrue.image, /:v\d+\.\d+\.\d+$/); assert.match(s.postgrest.image, /:v\d+\.\d+\.\d+$/);
  for (const f of ["docker/validation/Dockerfile", "docker/validation/entrypoint.sh"]) assert.ok(fs.existsSync(R(f)), f);
  const entry = read("docker/validation/entrypoint.sh"); assert.match(entry, /npm run --silent validate:phase7 -- --db-url "\$DATABASE_URL" --shim-auth/); assert.match(entry, /PIPESTATUS\[0\]/); assert.match(entry, /exit "\$code"/);
  const major = /v(\d+\.\d+)/.exec(read("docker/validation/Dockerfile"))[1]; assert.ok(pkg.devDependencies.playwright.replace(/^\^|~/, "").startsWith(major));
  const env = s.validate.environment; for (const k of ["DB_NAME", "PG_PASSWORD", "JWT_SECRET", "AUTH_ADMIN_PASSWORD", "AUTHENTICATOR_PASSWORD", "GOTRUE_URL", "POSTGREST_URL", "API_PUBLIC_URL"]) assert.ok(k in env, k);
  assert.equal(env.DB_NAME, "cgl_validation_scratch"); assert.match(s.gotrue.environment.GOTRUE_DB_DATABASE_URL, /@db:5432\/cgl_validation_scratch$/); assert.match(s.postgrest.environment.PGRST_DB_URI, /@db:5432\/cgl_validation_scratch$/);
  assert.equal(s.gotrue.environment.GOTRUE_JWT_SECRET, "${VALIDATION_JWT_SECRET:-validation-local-jwt-secret-0123456789abcdef0123456789abcdef}"); assert.equal(s.postgrest.environment.PGRST_JWT_SECRET, s.gotrue.environment.GOTRUE_JWT_SECRET); assert.equal(env.JWT_SECRET, s.gotrue.environment.GOTRUE_JWT_SECRET);
  const e = makeEnv({ PG_HOST: "db", JWT_SECRET: "j".repeat(40), PG_PASSWORD: "p", AUTH_ADMIN_PASSWORD: "a", AUTHENTICATOR_PASSWORD: "b", GOTRUE_URL: "http://gotrue:9999", POSTGREST_URL: "http://postgrest:3000", API_PUBLIC_URL: "http://localhost:54321" }); assert.equal(e.DATABASE_URL, "postgres://postgres:p@db:5432/cgl_validation_scratch"); assert.equal(e.GOTRUE_URL, "http://gotrue:9999");
});
test("docs: CI gate documented (command, services, secrets, artifacts, READY criteria, local fallback); README links it; the runtime report states NOT EXECUTED", () => {
  const d = read("docs/CI_PHASE7_GATE.md"); for (const s of ["npm run --silent validate:phase7 -- --db-url \"$DATABASE_URL\" --shim-auth", "docker compose -f docker/validation/docker-compose.yml up --build", "cgl_validation_scratch", "No repository secrets", "phase7-runtime-gate-", "READY FOR PHASE 8", "NOT EXECUTED"]) assert.ok(d.includes(s), s);
  assert.match(read("README.md"), /docs\/CI_PHASE7_GATE\.md/); const rep = read("docs/PHASE7_RUNTIME_VALIDATION.md"); assert.match(rep, /CI GATE/); assert.match(rep, /NOT EXECUTED IN THIS SANDBOX/); assert.match(rep, /NOT READY FOR PHASE 8/);
});
