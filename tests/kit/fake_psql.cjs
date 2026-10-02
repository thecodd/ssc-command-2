#!/usr/bin/env node
// TEST DOUBLE for `psql`, used ONLY by tests/kit/kit.test.mjs to exercise the validation kit's orchestration logic (safety rules, ledger, stop-on-first-failure,
// result parsing, exit-code mapping). It is not PostgreSQL and proves nothing about any migration or test suite. Like real psql, `-A -t` prints booleans as t/f.
const fs = require("fs"), path = require("path");
const sc = JSON.parse(fs.readFileSync(process.env.FAKE_PSQL, "utf8")), dir = path.dirname(process.env.FAKE_PSQL);
const args = process.argv.slice(2), at = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const rec = (o) => fs.appendFileSync(path.join(dir, "calls.jsonl"), JSON.stringify(o) + "\n");
if (args[0] === "--version") { console.log("psql (PostgreSQL) 15.4"); process.exit(0); }
if (sc.connFail) { console.error('psql: error: connection to server at "127.0.0.1", port 5432 failed: Connection refused'); process.exit(2); }
const sql = at("-c"), file = at("-f");
const meta = { url: args[0], argv: args.slice(1).map((a) => (/^(authenticator|auth_admin)_password=/.test(a) ? a.split("=")[0] + "=<hidden>" : a)).filter((a) => a !== "-X").slice(0, 14) };
rec(meta);
if (sql) {
  rec({ sql: sql.slice(0, 120), ...meta });
  const out = (s) => { console.log(s); process.exit(0); };
  const bool = (v) => (/::text/.test(sql) ? String(!!v) : v ? "t" : "f");     // real psql -A -t prints t/f unless the query casts to text
  if (/from pg_database/.test(sql)) out(sc.dbExists ? "1" : "");
  if (/^select id from auth\.users where email/.test(sql)) out(sc.uid ?? "00000000-0000-4000-8000-0000000000aa");
  if (/server_version_num/.test(sql)) out(`${sc.serverNum ?? 150004}|${sc.serverVersion ?? "15.4"}|${sc.db ?? "cgl_validation_scratch"}`);
  if (/from pg_roles/.test(sql)) out(sc.roles ?? "anon,authenticated,service_role");
  if (/to_regnamespace\('auth'\)/.test(sql)) out(bool(sc.supabase ?? true));
  if (/pg_available_extensions/.test(sql)) out(sc.pgTrgm === false ? "0" : "1");
  if (/from pg_tables/.test(sql)) out(String(sc.tables ?? 0));
  if (/to_regclass\('public\._cgl_validation_ledger'\)/.test(sql)) out(bool(sc.ledger));
  if (/select version, sha256 from/.test(sql)) out((sc.ledgerRows ?? []).join("\n"));
  if (/chapters where title like 'TEST %'/.test(sql)) { const f = path.join(dir, "leftover_calls"); const n = fs.existsSync(f) ? +fs.readFileSync(f, "utf8") : 0; fs.writeFileSync(f, String(n + 1)); out(String(n === 0 ? (sc.leftoverPre ?? 0) : (sc.leftoverPost ?? 0))); }
  process.exit(0);                                              // create table / insert ledger / reset: succeed silently
}
if (file && file !== "-") {                                     // a migration
  const base = path.basename(file); rec({ migration: base, ...meta });
  if (sc.failMigration && base.startsWith(sc.failMigration)) { console.error(`psql:${file}:12: ERROR:  syntax error at or near "selct"\nLINE 1: selct 1;\n        ^`); process.exit(3); }
  process.exit(0);
}
if (file === "-") {                                             // a suite on stdin
  const stdin = fs.readFileSync(0, "utf8"); fs.writeFileSync(path.join(dir, "suite_stdin.sql"), stdin);
  if (sc.suite === "sqlerror") { console.error("psql:<stdin>:88: ERROR:  function public.nope() does not exist"); process.exit(3); }
  if (sc.suite === "noresult") process.exit(0);
  if (sc.suite === "fail") { console.log("CGL_RESULT|9|1|10\nCGL_FAIL|7|SEC something is wrong|detail text"); process.exit(0); }
  if (sc.suite === "zero") { console.log("CGL_RESULT|0|0|0"); process.exit(0); }
  console.log("CGL_RESULT|20|0|20"); process.exit(0);
}
process.exit(0);
