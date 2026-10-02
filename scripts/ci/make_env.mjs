#!/usr/bin/env node
// Generates the EPHEMERAL configuration of a validation stack (JWT secret, anon/service keys, role passwords, a CI-only user) without printing any secret.
//   node scripts/ci/make_env.mjs --github   append KEY=VALUE to $GITHUB_ENV and print ::add-mask:: for every secret (GitHub Actions)
//   node scripts/ci/make_env.mjs --export   print `export KEY='value'` lines for `eval` (docker entrypoint)
// Values already present in the environment win (docker compose passes fixed throwaway local values so every container agrees).
import fs from "node:fs";
import crypto from "node:crypto";
const b64u = (b) => Buffer.from(b).toString("base64url");
export function signJwt(payload, secret) { const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify(payload)), s = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url"); return `${h}.${p}.${s}`; }
const rnd = (n = 24) => crypto.randomBytes(n).toString("hex");
export const SECRET_KEYS = ["PG_PASSWORD", "JWT_SECRET", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SERVICE_ROLE_KEY", "AUTH_ADMIN_PASSWORD", "AUTHENTICATOR_PASSWORD", "E2E_PASSWORD"];
export function makeEnv(env = process.env) {
  const pick = (k, gen) => env[k] || gen();
  const host = pick("PG_HOST", () => "127.0.0.1"), port = pick("PG_PORT", () => "5432"), db = pick("DB_NAME", () => "cgl_validation_scratch");
  const pg = pick("PG_PASSWORD", () => rnd()), jwt = pick("JWT_SECRET", () => rnd(32)), now = Math.floor(Date.now() / 1000), exp = now + 60 * 60 * 24 * 7;
  const adminPw = pick("AUTH_ADMIN_PASSWORD", () => rnd()), authPw = pick("AUTHENTICATOR_PASSWORD", () => rnd());
  const api = pick("API_PUBLIC_URL", () => "http://127.0.0.1:54321");
  const run = env.GITHUB_RUN_ID || String(now);
  const out = {
    DB_NAME: db, PG_HOST: host, PG_PORT: port, PG_PASSWORD: pg,
    DATABASE_URL: `postgres://postgres:${encodeURIComponent(pg)}@${host}:${port}/${db}`,
    ADMIN_DATABASE_URL: `postgres://postgres:${encodeURIComponent(pg)}@${host}:${port}/postgres`,
    JWT_SECRET: jwt,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: pick("NEXT_PUBLIC_SUPABASE_ANON_KEY", () => signJwt({ role: "anon", iss: "cgl-ci", iat: now, exp }, jwt)),
    SERVICE_ROLE_KEY: pick("SERVICE_ROLE_KEY", () => signJwt({ role: "service_role", iss: "cgl-ci", iat: now, exp }, jwt)),
    NEXT_PUBLIC_SUPABASE_URL: api, API_PUBLIC_URL: api,
    AUTH_ADMIN_PASSWORD: adminPw, AUTHENTICATOR_PASSWORD: authPw,
    GOTRUE_URL: pick("GOTRUE_URL", () => "http://127.0.0.1:9999"), POSTGREST_URL: pick("POSTGREST_URL", () => "http://127.0.0.1:3000"), GATEWAY_PORT: pick("GATEWAY_PORT", () => "54321"),
    E2E_EMAIL: pick("E2E_EMAIL", () => `ci-e2e-${run}@example.test`), E2E_PASSWORD: pick("E2E_PASSWORD", () => `Pw-${rnd(12)}`), E2E_PORT: pick("E2E_PORT", () => "3100"),
    VALIDATE_E2E_SEED_SCRIPT: "scripts/ci/seed_e2e.mjs",
  };
  return out;
}
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("make_env.mjs")) {
  const env = makeEnv();
  if (process.argv.includes("--github")) {
    const f = process.env.GITHUB_ENV; if (!f) { console.error("GITHUB_ENV is not set"); process.exit(2); }
    for (const k of SECRET_KEYS) console.log(`::add-mask::${env[k]}`);
    console.log(`::add-mask::${encodeURIComponent(env.PG_PASSWORD)}`);
    fs.appendFileSync(f, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
    console.log(`wrote ${Object.keys(env).length} variables to GITHUB_ENV (secret values masked, not printed)`);
  } else if (process.argv.includes("--export")) console.log(Object.entries(env).map(([k, v]) => `export ${k}='${String(v).replace(/'/g, "'\\''")}'`).join("\n"));
  else { console.error("usage: make_env.mjs --github | --export"); process.exit(2); }
}
