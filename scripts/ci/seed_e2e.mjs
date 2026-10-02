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
const q = run("psql", [url, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", `select id from auth.users where email = '${E.E2E_EMAIL.replace(/'/g, "''")}'`]);
const uid = q.stdout.trim();
if (q.code !== 0 || !/^[0-9a-f-]{36}$/.test(uid)) { console.error("the CI user was not found in auth.users after signup (email confirmation must be disabled): " + q.stderr.trim().split("\n")[0]); process.exit(1); }
const p = run("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", `uid=${uid}`, "-f", path.join(root, "database/tests/ci/e2e_seed.sql")]);
if (p.code !== 0) { console.error("e2e seed SQL failed: " + p.stderr.trim().split("\n").slice(0, 4).join(" | ")); process.exit(1); }
console.log(`seeded CI fixtures for user ${uid.slice(0, 8)}...`);
