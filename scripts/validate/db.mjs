// Database side of the validation kit: preflight + safety, migration discovery/ordering/apply, SQL suite runner. Everything runs through `psql`.
import fs from "node:fs";
import path from "node:path";
import { run, has, root, sha256, STATUS } from "./lib.mjs";

const MIG_DIR = path.join(root, "database/migrations");
const SCRATCH_NAME = /(scratch|test|validat|tmp|temp|ci)/i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[?::1\]?|host\.docker\.internal|)$/i;
const HOSTED = /(supabase\.co|supabase\.com|pooler\.supabase|neon\.tech|rds\.amazonaws|azure\.com|render\.com|railway)/i;
export const LEDGER = "public._cgl_validation_ledger";

export function parseDbUrl(url) {
  try { const u = new URL(url); return { host: u.hostname, port: u.port || "5432", db: decodeURIComponent(u.pathname.replace(/^\//, "")), user: decodeURIComponent(u.username) }; }
  catch { return null; }
}
/** psql wrapper. Exit 2 = could not connect (environment); 3 = SQL error under ON_ERROR_STOP (script). */
export function psql(url, args, input) { return run("psql", [url, "-X", "-v", "ON_ERROR_STOP=1", ...args], { input }); }
export const q = (url, sql) => { const r = psql(url, ["-q", "-A", "-t", "-c", sql]); return { ...r, rows: r.stdout.split(/\r?\n/).filter(Boolean) }; };

// ---------------------------------------------------------------- migrations (no database needed)
export function discoverMigrations() {
  const files = fs.existsSync(MIG_DIR) ? fs.readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort() : [];
  const problems = [], list = [];
  for (const f of files) {
    const m = /^(\d{3})_([a-z0-9_]+)\.sql$/.exec(f);
    if (!m) { problems.push(`unexpected file name: ${f} (want NNN_name.sql)`); continue; }
    const buf = fs.readFileSync(path.join(MIG_DIR, f)); list.push({ n: +m[1], num: m[1], file: f, path: path.join(MIG_DIR, f), sha: sha256(buf), bytes: buf.length });
  }
  const nums = list.map((x) => x.n);
  if (!nums.length) problems.push("no migrations found");
  else {
    for (let i = 0; i < nums.length; i++) if (nums[i] !== i + 1) { problems.push(`order/gap problem at position ${i + 1}: found ${String(nums[i]).padStart(3, "0")} (expected ${String(i + 1).padStart(3, "0")})`); break; }
    const dup = nums.filter((n, i) => nums.indexOf(n) !== i); if (dup.length) problems.push(`duplicate migration number(s): ${[...new Set(dup)].join(", ")}`);
    if (nums.at(-1) !== 14) problems.push(`expected the last migration to be 014, found ${String(nums.at(-1)).padStart(3, "0")}`);
    if (list.at(-1) && !/privilege/.test(list.at(-1).file)) problems.push("the LAST migration must be the generated function-privilege migration (it re-derives every EXECUTE grant)");
  }
  return { list, problems };
}

// ---------------------------------------------------------------- preflight + safety
/** Returns {status, detail, info, safe}. Never modifies anything. */
export function preflight(url, flags) {
  const info = { psql: null, supabaseCli: null, server: null, serverNum: null, supabase: null, roles: [], extensions: {}, ledger: null, publicTables: null, db: null, host: null };
  if (!has("psql")) return { status: STATUS.BLOCKED, detail: "psql is not installed (install the PostgreSQL client 15+)", info };
  info.psql = run("psql", ["--version"]).stdout.trim();
  if (has("supabase")) info.supabaseCli = run("supabase", ["--version"]).stdout.trim();
  if (!url) return { status: STATUS.BLOCKED, detail: "no database URL: set VALIDATE_DATABASE_URL (or --db-url) to a SCRATCH database", info };
  const u = parseDbUrl(url); if (!u) return { status: STATUS.FAIL, detail: "VALIDATE_DATABASE_URL is not a valid postgres:// URL", info };
  info.db = u.db; info.host = u.host;
  const c = q(url, "select current_setting('server_version_num'), current_setting('server_version'), current_database()");
  if (c.code !== 0) return { status: STATUS.BLOCKED, detail: `cannot connect to ${u.host}:${u.port}/${u.db} (${(c.stderr || c.error || "").trim().split("\n")[0]})`, info };
  const [num, ver, db] = c.rows[0].split("|"); info.serverNum = +num; info.server = ver;
  if (info.serverNum < 150000) return { status: STATUS.FAIL, detail: `PostgreSQL ${ver} is too old: 15+ required`, info };
  const one = (sql) => q(url, sql).rows[0] ?? "";
  info.roles = one("select string_agg(rolname, ',') from pg_roles where rolname in ('anon','authenticated','service_role')").split(",").filter(Boolean);
  info.supabase = one("select (to_regnamespace('auth') is not null and to_regprocedure('auth.uid()') is not null and to_regclass('auth.users') is not null)::text") === "true";
  info.extensions.pg_trgm = one("select count(*) from pg_available_extensions where name = 'pg_trgm'") !== "0";
  info.publicTables = +one("select count(*) from pg_tables where schemaname = 'public'");
  info.ledger = one(`select (to_regclass('${LEDGER}') is not null)::text`) === "true";
  // ---- SAFETY: scratch database only
  const reasons = [];
  const recognised = info.ledger;                      // a ledger created by this kit marks the database as validation scratch
  const nameOk = SCRATCH_NAME.test(db), local = LOCAL_HOST.test(u.host);
  if (HOSTED.test(u.host) && !flags.forceIKnow) reasons.push(`host ${u.host} looks like a HOSTED database; refusing (pass --force-i-understand-this-may-destroy-data only for a throw-away project)`);
  if (!recognised && !nameOk && !flags.forceIKnow) reasons.push(`database name "${db}" does not look like scratch (needs scratch/test/validate/tmp/ci in the name) and it has not been used by this kit before`);
  if (!recognised && nameOk && !local && !flags.allowRemote && !flags.forceIKnow) reasons.push(`host ${u.host} is not local: pass --allow-remote to confirm this scratch database is not production`);
  if (!recognised && info.publicTables > 0 && !flags.reset && !flags.forceIKnow) reasons.push(`the public schema already has ${info.publicTables} tables and was not created by this kit: pass --reset to wipe it (scratch only)`);
  if (reasons.length) return { status: STATUS.FAIL, detail: "SAFETY REFUSAL: " + reasons.join("; "), info, refused: true };
  const missing = []; for (const r of ["anon", "authenticated", "service_role"]) if (!info.roles.includes(r)) missing.push(`role ${r}`); if (!info.supabase) missing.push("auth.users/auth.uid()");
  if (!info.extensions.pg_trgm) missing.push("extension pg_trgm (install postgresql-contrib)");
  if (missing.length && !(flags.shimAuth && !missing.includes("extension pg_trgm (install postgresql-contrib)")))
    return { status: STATUS.BLOCKED, detail: `target is not Supabase-compatible, missing: ${missing.join(", ")}. On PLAIN PostgreSQL pass --shim-auth (applies database/tests/bootstrap/plain_postgres_shim.sql); never on Supabase.`, info };
  return { status: STATUS.PASS, detail: `PostgreSQL ${ver} on ${u.host}/${u.db}; ${info.supabase ? "Supabase-style auth present" : "plain Postgres (shim will be applied)"}; ledger=${info.ledger}; public tables=${info.publicTables}`, info };
}
export function resetScratch(url) {
  return psql(url, ["-q", "-c", "drop schema if exists public cascade; create schema public; grant usage on schema public to anon, authenticated, service_role; grant all on schema public to postgres; alter default privileges in schema public grant all on tables to anon, authenticated, service_role; alter default privileges in schema public grant all on sequences to anon, authenticated, service_role; alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;"]);
}
export const applyShim = (url) => psql(url, ["-q", "-f", path.join(root, "database/tests/bootstrap/plain_postgres_shim.sql")]);

// ---------------------------------------------------------------- migration application (exactly once, in order, stop on first failure)
function firstError(text) { const lines = text.split(/\r?\n/); const i = lines.findIndex((l) => /ERROR:|FATAL:|psql:.*error/i.test(l)); return i < 0 ? lines.filter(Boolean).slice(-3).join(" | ") : lines.slice(i, i + 4).join(" | "); }
export function applyMigrations(url, migs, report, log) {
  q(url, `create table if not exists ${LEDGER} (version text primary key, filename text not null, sha256 text not null, applied_at timestamptz not null default now(), elapsed_ms int not null)`);
  const ledger = new Map(q(url, `select version, sha256 from ${LEDGER} order by version`).rows.map((r) => r.split("|")));
  const results = []; let stop = false;
  for (const m of migs) {
    if (stop) { results.push({ ...m, status: STATUS.NOT_RUN, detail: "not run: an earlier migration failed" }); continue; }
    if (ledger.has(m.num)) {
      if (ledger.get(m.num) !== m.sha) { results.push({ ...m, status: STATUS.FAIL, detail: "file changed after it was applied to this database (checksum differs): reset the scratch database" }); stop = true; continue; }
      results.push({ ...m, status: STATUS.PASS, detail: "already applied by this kit (checksum verified, not re-run)", ms: 0 }); continue;
    }
    const r = run("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-1", "-f", m.path]);
    const logFile = log(`migration_${m.num}.log`, `$ psql -1 -f ${m.file}\nexit=${r.code} elapsed=${r.ms}ms\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`);
    if (r.code === 0) {
      const ins = psql(url, ["-q", "-c", `insert into ${LEDGER}(version, filename, sha256, elapsed_ms) values ('${m.num}', '${m.file}', '${m.sha}', ${r.ms})`]);
      if (ins.code !== 0) { results.push({ ...m, status: STATUS.FAIL, ms: r.ms, log: logFile, detail: "applied but the ledger write failed: " + firstError(ins.stderr) }); stop = true; continue; }
      results.push({ ...m, status: STATUS.PASS, ms: r.ms, log: logFile, detail: r.stderr.trim() ? "notices: " + r.stderr.trim().split("\n").length + " line(s) in log" : "" });
    } else {
      const env = r.code === 2 || r.error;     // 2 = connection problem
      results.push({ ...m, status: env ? STATUS.BLOCKED : STATUS.FAIL, ms: r.ms, log: logFile, detail: (env ? "ENVIRONMENT: " : "SQL ERROR (whole migration rolled back): ") + firstError(r.stderr || r.error || "") }); stop = true;
    }
  }
  return results;
}

// ---------------------------------------------------------------- SQL suites
const MARKERS = `
select 'CGL_RESULT|' || count(*) filter (where passed) || '|' || count(*) filter (where not passed) || '|' || count(*) from t_results;
select 'CGL_FAIL|' || n || '|' || label || '|' || coalesce(detail, '') from t_results where not passed order by n;
select 'CGL_ERR|' || n || '|' || coalesce(uid::text, 'owner/anon') || '|' || coalesce(sqlstate, '') || '|' || coalesce(message, '') || '|' || coalesce(stmt, '') from t_errors order by n;
`;
const LEFTOVER = `select (select count(*) from public.chapters where title like 'TEST %') + (select count(*) from public.books where title like 'TEST %') + (select count(*) from public.ssc_topics where title like 'TEST %') + (select count(*) from auth.users where email like '%@test.local')`;
export function runSuite(url, suite, log) {
  const file = suite.file; if (!fs.existsSync(file)) return { status: STATUS.FAIL, detail: `suite file missing: ${path.relative(root, file)} (run: node scripts/validate/sqlbuild.mjs)` };
  const pre = q(url, LEFTOVER);
  if (pre.code !== 0) return { status: pre.code === 2 || pre.error ? STATUS.BLOCKED : STATUS.FAIL, detail: (pre.code === 2 ? "ENVIRONMENT: " : "precheck SQL error (were migrations applied?): ") + firstError(pre.stderr) };
  if (+pre.rows[0] !== 0) return { status: STATUS.FAIL, detail: `database is not in a clean state: ${pre.rows[0]} leftover TEST rows from an earlier run (the suites must roll back)` };
  let sql = fs.readFileSync(file, "utf8"); const i = sql.toLowerCase().lastIndexOf("rollback;");
  if (i < 0) return { status: STATUS.FAIL, detail: "suite has no final ROLLBACK; refusing to run (it would leave fixtures behind)" };
  sql = sql.slice(0, i) + MARKERS + sql.slice(i);
  const r = psql(url, ["-q", "-A", "-t", "-f", "-"], sql);
  const logFile = log(`suite_${suite.key}.log`, `exit=${r.code} elapsed=${r.ms}ms\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`);
  const out = { log: logFile, ms: r.ms, items: [] };
  const errs = [...r.stdout.matchAll(/^CGL_ERR\|(.*)$/gm)].map((m) => m[1]); if (errs.length) log(`suite_${suite.key}.errors.log`, `Every error the SQL test helpers swallowed (n|uid|sqlstate|message|statement). Most are EXPECTED (negative tests); read them next to a failing check.\n` + errs.join("\n"));
  if (r.code === 2 || r.error) return { ...out, status: STATUS.BLOCKED, detail: "ENVIRONMENT: " + firstError(r.stderr || r.error) };
  const res = /^CGL_RESULT\|(\d+)\|(\d+)\|(\d+)/m.exec(r.stdout), fails = [...r.stdout.matchAll(/^CGL_FAIL\|(\d+)\|(.*?)\|(.*)$/gm)].map((m) => ({ n: +m[1], label: m[2], detail: m[3] }));
  if (r.code !== 0 || !res) return { ...out, status: STATUS.FAIL, detail: `SQL ERROR while running the suite (script aborted${res ? "" : ", no result table"}): ${firstError(r.stderr)}`, items: fails };
  const passed = +res[1], failed = +res[2], total = +res[3];
  const post = q(url, LEFTOVER), leaked = post.code === 0 ? +post.rows[0] : -1;
  const base = { ...out, passed, failed, total, items: fails };
  if (failed > 0) return { ...base, status: STATUS.FAIL, detail: `${failed} of ${total} checks FAILED. First: #${fails[0]?.n} ${fails[0]?.label}${fails[0]?.detail ? " [" + fails[0].detail.slice(0, 160) + "]" : ""}` };
  if (total === 0) return { ...base, status: STATUS.FAIL, detail: "the suite executed but recorded 0 checks" };
  if (leaked !== 0) return { ...base, status: STATUS.FAIL, detail: `all ${total} checks passed but ${leaked} fixture rows remain: the transaction did not roll back` };
  return { ...base, status: STATUS.PASS, detail: `${passed}/${total} checks passed; fixtures rolled back` };
}
