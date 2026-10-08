#!/usr/bin/env node
// Kit hook (scripts/validate_phase7.mjs --e2e-seed-script / VALIDATE_E2E_SEED_SCRIPT): creates the CI user through the REAL auth API, then applies database/tests/ci/e2e_seed.sql.
// env: DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, E2E_EMAIL, E2E_PASSWORD. Exit 0 ok | 1 failed | 3 blocked (not configured / auth API unreachable).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../validate/lib.mjs";
import { waitFor } from "./wait_for.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const E = process.env, url = E.DATABASE_URL || E.VALIDATE_DATABASE_URL, api = (E.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const miss = ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "E2E_EMAIL", "E2E_PASSWORD"].filter((k) => !(k === "DATABASE_URL" ? url : E[k]));
if (miss.length) { console.error("BLOCKED: missing env " + miss.join(", ")); process.exit(3); }
if (!/^[a-z0-9_]+$/i.test((new URL(url).pathname || "").slice(1)) || !/(scratch|test|validat|tmp|temp|ci)/i.test(new URL(url).pathname)) { console.error("refusing to seed a database that is not scratch-named"); process.exit(1); }
const ready = await waitFor(`${api}/auth/v1/health`, Number(E.SEED_API_WAIT_S || 60)); if (!ready.ok) { console.error(`BLOCKED: auth API not reachable at ${api} (${ready.last})`); process.exit(3); }
const r = await fetch(`${api}/auth/v1/signup`, { method: "POST", headers: { apikey: E.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email: E.E2E_EMAIL, password: E.E2E_PASSWORD }) });
const body = await r.text();
if (!r.ok && !/already|registered/i.test(body)) { console.error(`signup failed: HTTP ${r.status} ${body.slice(0, 200).split(E.E2E_PASSWORD).join("***")}`); process.exit(1); }
// ---- auth-path probe: the SAME endpoints the login page uses (gateway -> GoTrue -> Postgres, then gateway -> PostgREST with the user's JWT -> RLS). Never prints tokens or passwords.
const H = { apikey: E.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" }, origin = `http://127.0.0.1:${E.E2E_PORT || 3100}`;
const scrubText = (t) => String(t).split(E.E2E_PASSWORD).join("***").split(E.NEXT_PUBLIC_SUPABASE_ANON_KEY).join("***").slice(0, 300);
const probe = [];
const step = (name, ok, detail) => { probe.push(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`); return ok; };
let tokenOk = false, jwt = "";
try {
  const pre = await fetch(`${api}/auth/v1/token?grant_type=password`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "apikey,authorization,content-type,x-client-info" } });
  step("CORS preflight on /auth/v1/token", pre.status < 300 && pre.headers.get("access-control-allow-origin") === origin, `HTTP ${pre.status}, allow-origin=${pre.headers.get("access-control-allow-origin")}, allow-headers=${pre.headers.get("access-control-allow-headers")}`);
  const lr = await fetch(`${api}/auth/v1/token?grant_type=password`, { method: "POST", headers: { ...H, origin }, body: JSON.stringify({ email: E.E2E_EMAIL, password: E.E2E_PASSWORD }) });
  const lj = await lr.json().catch(() => ({})); jwt = lj.access_token || ""; tokenOk = lr.ok && !!jwt;
  step("password login via /auth/v1/token", tokenOk, `HTTP ${lr.status}, access_token=${jwt ? "present" : "absent"}${tokenOk ? "" : `, error_code=${lj.error_code ?? lj.error ?? "?"}, message=${scrubText(lj.msg ?? lj.error_description ?? lj.message ?? "")}`}, allow-origin=${lr.headers.get("access-control-allow-origin")}`);
  const un = jwt && await fetch(`${api}/auth/v1/user`, { headers: { apikey: H.apikey, authorization: `Bearer ${jwt}` } });
  if (jwt) step("GoTrue accepts its own token (/auth/v1/user)", un.ok, `HTTP ${un.status}`);
  const rest = await fetch(`${api}/rest/v1/`, { headers: { apikey: H.apikey } }); step("PostgREST reachable through the gateway (/rest/v1/)", rest.status < 400, `HTTP ${rest.status}`);
  if (jwt) { const pr = await fetch(`${api}/rest/v1/profiles?select=id&limit=2`, { headers: { apikey: H.apikey, authorization: `Bearer ${jwt}` } }); const rows = pr.ok ? await pr.json() : []; step("PostgREST + RLS: the user can read exactly their own profile row", pr.ok && rows.length === 1, `HTTP ${pr.status}, rows=${Array.isArray(rows) ? rows.length : "?"}${pr.ok ? "" : ", " + scrubText(await pr.text())}`); }
} catch (e) { step("auth-path probe", false, `${e.cause?.code || e.message}`); }
console.log("auth-path probe:\n  " + probe.join("\n  "));
if (probe.some((l) => l.startsWith("FAIL"))) { console.error("auth-path probe FAILED: the login page cannot work until this is fixed (details above)"); process.exit(1); }
const q = run("psql", [url, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", `select id from auth.users where email = '${E.E2E_EMAIL.replace(/'/g, "''")}'`]);
const uid = q.stdout.trim();
if (q.code !== 0 || !/^[0-9a-f-]{36}$/.test(uid)) { console.error("the CI user was not found in auth.users after signup (email confirmation must be disabled): " + q.stderr.trim().split("\n")[0]); process.exit(1); }
const p = run("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", `uid=${uid}`, "-f", path.join(root, "database/tests/ci/e2e_seed.sql")]);
if (p.code !== 0) { console.error("e2e seed SQL failed: " + p.stderr.trim().split("\n").slice(0, 4).join(" | ")); process.exit(1); }
console.log(`seeded CI fixtures for user ${uid.slice(0, 8)}...`);
// ---- second user for the Phase 10 admin flow: a REAL signup, then promoted through the superuser connection (the API can never self-promote), plus draft curriculum fixtures.
const adminEmail = E.E2E_ADMIN_EMAIL || `admin.${E.E2E_EMAIL}`;
const ar = await fetch(`${api}/auth/v1/signup`, { method: "POST", headers: { apikey: E.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email: adminEmail, password: E.E2E_PASSWORD }) });
const abody = await ar.text();
if (!ar.ok && !/already|registered/i.test(abody)) { console.error(`admin signup failed: HTTP ${ar.status}`); process.exit(1); }
const esc = (t) => t.replace(/'/g, "''");
const pa = run("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", `update public.profiles set is_admin = true where id = (select id from auth.users where email = '${esc(adminEmail)}')`, "-f", path.join(root, "database/tests/ci/e2e_admin_seed.sql")]);
if (pa.code !== 0) { console.error("admin seed failed: " + pa.stderr.trim().split("\n").slice(0, 4).join(" | ")); process.exit(1); }
console.log("seeded the CI admin user and draft curriculum fixtures");
