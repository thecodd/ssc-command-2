#!/usr/bin/env node
// Creates the disposable scratch database (if absent) and applies database/tests/ci/00_ci_prepare.sql. Refuses anything that is not a scratch-named database.
// env: ADMIN_DATABASE_URL (superuser, database "postgres"), DB_NAME, AUTHENTICATOR_PASSWORD, AUTH_ADMIN_PASSWORD. Passwords go to psql as -v variables and are never printed.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../validate/lib.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const need = ["ADMIN_DATABASE_URL", "DB_NAME", "AUTHENTICATOR_PASSWORD", "AUTH_ADMIN_PASSWORD"], miss = need.filter((k) => !process.env[k]);
if (miss.length) { console.error("missing env: " + miss.join(", ")); process.exit(2); }
const db = process.env.DB_NAME;
if (!/^[a-z0-9_]+$/.test(db) || !/(scratch|test|validat|tmp|temp|ci)/i.test(db)) { console.error(`refusing: database name "${db}" is not a scratch name`); process.exit(2); }
const admin = process.env.ADMIN_DATABASE_URL, scrub = (s) => s.split(process.env.PG_PASSWORD || "\u0000").join("***");
const ex = run("psql", [admin, "-X", "-q", "-A", "-t", "-c", `select 1 from pg_database where datname = '${db}'`]);
if (ex.code !== 0) { console.error("cannot connect to the admin database: " + scrub(ex.stderr.trim().split("\n")[0])); process.exit(1); }
if (!ex.stdout.trim()) { const c = run("psql", [admin, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", `create database ${db}`]); if (c.code !== 0) { console.error("create database failed: " + scrub(c.stderr.trim())); process.exit(1); } console.log(`created database ${db}`); } else console.log(`database ${db} already exists`);
const target = admin.replace(/\/postgres(\?.*)?$/, `/${db}$1`);
const p = run("psql", [target, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", `authenticator_password=${process.env.AUTHENTICATOR_PASSWORD}`, "-v", `auth_admin_password=${process.env.AUTH_ADMIN_PASSWORD}`, "-f", path.join(root, "database/tests/ci/00_ci_prepare.sql")]);
if (p.code !== 0) { console.error("prepare SQL failed: " + scrub(p.stderr.trim())); process.exit(1); }
console.log(`prepared ${db}: roles, auth schema, default privileges, PostgREST reload trigger`);
