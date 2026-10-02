// Tests for the validation kit's OWN logic against a fake psql (see fake_psql.cjs). These prove the orchestration behaves as specified; they say NOTHING about PostgreSQL.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const db = await import(path.join(root, "scripts/validate/db.mjs"));
const lib = await import(path.join(root, "scripts/validate/lib.mjs"));
const URL_OK = "postgres://postgres:pw@127.0.0.1:5432/cgl_validation_scratch";
function env(scenario) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "kit-")); fs.mkdirSync(path.join(d, "bin"));
  const shim = path.join(d, "bin", "psql"); fs.writeFileSync(shim, `#!/bin/sh\nexec node "${path.join(root, "tests/kit/fake_psql.cjs")}" "$@"\n`); fs.chmodSync(shim, 0o755);
  fs.writeFileSync(path.join(d, "scenario.json"), JSON.stringify(scenario)); process.env.PATH = path.join(d, "bin") + path.delimiter + process.env.PATH.split(path.delimiter).filter((p) => !p.includes("kit-")).join(path.delimiter); process.env.FAKE_PSQL = path.join(d, "scenario.json");
  return { d, calls: () => (fs.existsSync(path.join(d, "calls.jsonl")) ? fs.readFileSync(path.join(d, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []) };
}
const flags = { shimAuth: false, reset: false, allowRemote: false, forceIKnow: false };

test("migrations: discovery finds 001..014 contiguous with 014 (privileges) last", () => {
  const m = db.discoverMigrations(); assert.deepEqual(m.problems, []); assert.equal(m.list.length, 14); assert.equal(m.list[0].num, "001"); assert.match(m.list.at(-1).file, /^014_.*privilege/);
  assert.ok(m.list.every((x) => /^[0-9a-f]{64}$/.test(x.sha)));
});
test("preflight: scratch local DB passes; version/roles/ledger read through psql booleans t/f correctly", () => {
  env({ supabase: true, ledger: false, tables: 0 }); const r = db.preflight(URL_OK, flags); assert.equal(r.status, "PASS", r.detail); assert.equal(r.info.supabase, true); assert.equal(r.info.ledger, false); assert.equal(r.info.serverNum, 150004);
  env({ supabase: true, ledger: true, tables: 40 }); const r2 = db.preflight(URL_OK, flags); assert.equal(r2.status, "PASS", "a database this kit created (ledger present) is recognised even with tables"); assert.equal(r2.info.ledger, true);
});
test("preflight SAFETY: refuses production-looking, non-scratch, remote and pre-populated databases unless explicitly flagged", () => {
  env({ db: "postgres", tables: 0 }); assert.match(db.preflight("postgres://u:p@127.0.0.1/postgres", flags).detail, /SAFETY REFUSAL.*does not look like scratch/);
  env({ db: "cgl_validation_scratch" }); assert.match(db.preflight("postgres://u:p@db.abcdefgh.supabase.co:5432/cgl_validation_scratch", flags).detail, /HOSTED/);
  env({ db: "cgl_validation_scratch" }); assert.match(db.preflight("postgres://u:p@10.1.2.3:5432/cgl_validation_scratch", flags).detail, /not local: pass --allow-remote/);
  env({ db: "cgl_validation_scratch", tables: 12 }); assert.match(db.preflight(URL_OK, flags).detail, /already has 12 tables.*--reset/);
  env({ db: "cgl_validation_scratch", tables: 12 }); assert.equal(db.preflight(URL_OK, { ...flags, reset: true }).status, "PASS");
  env({ db: "postgres" }); assert.equal(db.preflight("postgres://u:p@127.0.0.1/postgres", { ...flags, forceIKnow: true }).status, "PASS");
  env({ db: "cgl_validation_scratch" }); assert.equal(db.preflight(URL_OK, flags).refused, undefined);
  env({ db: "postgres" }); assert.equal(db.preflight("postgres://u:p@127.0.0.1/postgres", flags).refused, true);
});
test("preflight: environment problems are BLOCKED, not FAIL; old servers FAIL; missing Supabase pieces explain the shim", () => {
  env({ connFail: true }); const c = db.preflight(URL_OK, flags); assert.equal(c.status, "BLOCKED"); assert.match(c.detail, /cannot connect/);
  env({ serverNum: 140009, serverVersion: "14.9" }); const o = db.preflight(URL_OK, flags); assert.equal(o.status, "FAIL"); assert.match(o.detail, /15\+ required/);
  env({ supabase: false, roles: "" }); const p = db.preflight(URL_OK, flags); assert.equal(p.status, "BLOCKED"); assert.match(p.detail, /--shim-auth/);
  env({ supabase: false, roles: "" }); assert.equal(db.preflight(URL_OK, { ...flags, shimAuth: true }).status, "PASS");
  assert.equal(db.preflight("", flags).status, "BLOCKED"); assert.equal(db.preflight("not a url", flags).status, "FAIL");
});
test("applyMigrations: each exactly once and in order; ledger rows written; elapsed recorded", () => {
  const e = env({}); const logs = []; const m = db.discoverMigrations().list; const r = db.applyMigrations(URL_OK, m, null, (n, t) => (logs.push(n), n));
  assert.equal(r.length, 14); assert.ok(r.every((x) => x.status === "PASS")); assert.deepEqual(e.calls().filter((c) => c.migration).map((c) => c.migration), m.map((x) => x.file));
  assert.equal(e.calls().filter((c) => c.sql?.startsWith("insert into public._cgl_validation_ledger")).length, 14); assert.ok(r.every((x) => typeof x.ms === "number"));
});
test("applyMigrations: stops at the first failing migration, preserves the SQL error, marks the rest NOT RUN", () => {
  const e = env({ failMigration: "005" }); const m = db.discoverMigrations().list; const r = db.applyMigrations(URL_OK, m, null, (n) => n);
  assert.deepEqual(r.map((x) => x.status), ["PASS", "PASS", "PASS", "PASS", "FAIL", ...Array(9).fill("NOT RUN")]); assert.match(r[4].detail, /SQL ERROR \(whole migration rolled back\).*syntax error at or near "selct"/);
  assert.deepEqual(e.calls().filter((c) => c.migration).map((c) => c.migration.slice(0, 3)), ["001", "002", "003", "004", "005"]);
});
test("applyMigrations: connection loss is BLOCKED (environment), not FAIL", () => { env({ connFail: true }); const r = db.applyMigrations(URL_OK, db.discoverMigrations().list.slice(0, 2), null, (n) => n); assert.equal(r[0].status, "BLOCKED"); assert.match(r[0].detail, /ENVIRONMENT/); assert.equal(r[1].status, "NOT RUN"); });
test("applyMigrations: already-applied migrations are verified by checksum, not re-run; a modified file FAILS", () => {
  const m = db.discoverMigrations().list.slice(0, 3); const rows = m.map((x) => `${x.num}|${x.sha}`); let e = env({ ledgerRows: rows });
  let r = db.applyMigrations(URL_OK, m, null, (n) => n); assert.ok(r.every((x) => x.status === "PASS")); assert.equal(e.calls().filter((c) => c.migration).length, 0);
  e = env({ ledgerRows: [rows[0], `002|${"0".repeat(64)}`, rows[2]] }); r = db.applyMigrations(URL_OK, m, null, (n) => n); assert.equal(r[1].status, "FAIL"); assert.match(r[1].detail, /checksum differs/); assert.equal(r[2].status, "NOT RUN");
});
function suite(content) { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "suite-")), "s.sql"); fs.writeFileSync(f, content); return { key: "t", file: f }; }
test("runSuite: marker queries are injected BEFORE the final ROLLBACK; pass requires all checks passed, rolled back, non-zero total", () => {
  const e = env({}); const r = db.runSuite(URL_OK, suite("begin;\nselect 1;\nrollback;\n"), (n) => n); assert.equal(r.status, "PASS", r.detail); assert.equal(r.total, 20);
  const sent = fs.readFileSync(path.join(e.d, "suite_stdin.sql"), "utf8"); assert.ok(sent.indexOf("CGL_RESULT") < sent.toLowerCase().lastIndexOf("rollback;")); assert.ok(sent.trimEnd().toLowerCase().endsWith("rollback;"));
});
test("runSuite: a failed check is a FAIL with the first failing label; a SQL error is a FAIL distinct from an environment BLOCKED", () => {
  env({ suite: "fail" }); const f = db.runSuite(URL_OK, suite("begin;\nrollback;"), (n) => n); assert.equal(f.status, "FAIL"); assert.match(f.detail, /1 of 10 checks FAILED.*#7 SEC something is wrong/); assert.equal(f.items.length, 1);
  env({ suite: "sqlerror" }); const s = db.runSuite(URL_OK, suite("begin;\nrollback;"), (n) => n); assert.equal(s.status, "FAIL"); assert.match(s.detail, /SQL ERROR while running the suite.*does not exist/);
  env({ suite: "noresult" }); assert.match(db.runSuite(URL_OK, suite("begin;\nrollback;"), (n) => n).detail, /no result table/);
  env({ suite: "zero" }); assert.match(db.runSuite(URL_OK, suite("begin;\nrollback;"), (n) => n).detail, /0 checks|recorded 0/);
  env({ connFail: true }); assert.equal(db.runSuite(URL_OK, suite("begin;\nrollback;"), (n) => n).status, "BLOCKED");
});
test("runSuite: dirty database before, leaked fixtures after, and a suite without ROLLBACK are all refused/failed", () => {
  env({ leftoverPre: 3 }); assert.match(db.runSuite(URL_OK, suite("begin;\nrollback;"), (n) => n).detail, /not in a clean state/);
  env({ leftoverPost: 2 }); assert.match(db.runSuite(URL_OK, suite("begin;\nrollback;"), (n) => n).detail, /did not roll back/);
  env({}); assert.match(db.runSuite(URL_OK, suite("begin;\nselect 1;"), (n) => n).detail, /no final ROLLBACK/);
});
test("verdict: READY only when every mandatory stage PASSED; BLOCKED / NOT RUN / FAIL each prevent it; supporting stages never grant it", () => {
  const mk = () => new lib.Report(fs.mkdtempSync(path.join(os.tmpdir(), "rep-")));
  let r = mk(); r.add({ id: "1", title: "a", status: "PASS" }); r.add({ id: "2", title: "b", status: "PASS" }); assert.equal(r.verdict().ready, true);
  for (const st of ["BLOCKED", "NOT RUN", "FAIL"]) { r = mk(); r.add({ id: "1", title: "a", status: "PASS" }); r.add({ id: "2", title: "b", status: st }); assert.equal(r.verdict().ready, false, st); }
  r = mk(); r.add({ id: "1", title: "a", status: "BLOCKED" }); r.add({ id: "S", title: "s", category: "SUPPORTING", mandatory: false, status: "PASS" }); assert.equal(r.verdict().ready, false);
  r = mk(); r.add({ id: "1", title: "a", status: "PASS" }); r.add({ id: "S", title: "s", category: "SUPPORTING", mandatory: false, status: "FAIL" }); assert.equal(r.verdict().ready, false, "a failing supporting stage still blocks readiness");
});
test("entry point in THIS environment: ends with NOT READY, never PASSes a stage it could not execute, and exits non-zero", () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(DATABASE_URL|VALIDATE_\w+|NEXT_PUBLIC_\w+|E2E_\w+)$/.test(k)));
  const out = cp.spawnSync(process.execPath, [path.join(root, "scripts/validate_phase7.mjs"), "--skip-supporting", "--skip-app", "--out", fs.mkdtempSync(path.join(os.tmpdir(), "out-"))], { cwd: root, encoding: "utf8", env, timeout: 120000 });
  assert.equal(out.status, 1); assert.equal(out.stdout.trim().split("\n").at(-1), "NOT READY FOR PHASE 8");
  for (const s of ["8 Typecheck", "9 Lint", "10 Production build", "11 Real browser", "11b Accessibility"]) assert.match(out.stdout, new RegExp(`\\[NOT RUN \\] ${s}`), s);
  if (!fs.existsSync(path.join(root, "node_modules/next"))) assert.match(out.stdout, /\[BLOCKED \] 2 Dependency check/);
});
