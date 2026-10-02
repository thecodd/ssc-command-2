#!/usr/bin/env node
// Replaces every known ephemeral secret value with *** in the text files under the given directories (artifact hygiene). Binary files are left alone.
import fs from "node:fs";
import path from "node:path";
const KEYS = ["PG_PASSWORD", "JWT_SECRET", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SERVICE_ROLE_KEY", "AUTH_ADMIN_PASSWORD", "AUTHENTICATOR_PASSWORD", "E2E_PASSWORD"];
const secrets = KEYS.map((k) => process.env[k]).filter((v) => v && v.length >= 8).flatMap((v) => [v, encodeURIComponent(v)]);
let files = 0, hits = 0;
(function walk(p) { if (!fs.existsSync(p)) return; const st = fs.statSync(p); if (st.isDirectory()) return fs.readdirSync(p).forEach((f) => walk(path.join(p, f))); if (!/\.(log|txt|md|json|jsonl|sql|html)$/i.test(p) || st.size > 50e6) return; let t = fs.readFileSync(p, "utf8"), n = t; for (const s of secrets) n = n.split(s).join("***"); files++; if (n !== t) { hits++; fs.writeFileSync(p, n); } })(process.argv[2] || "reports");
for (const d of process.argv.slice(3)) (function walk(p) { if (!fs.existsSync(p)) return; const st = fs.statSync(p); if (st.isDirectory()) return fs.readdirSync(p).forEach((f) => walk(path.join(p, f))); if (!/\.(log|txt|md|json|jsonl)$/i.test(p)) return; let t = fs.readFileSync(p, "utf8"), n = t; for (const s of secrets) n = n.split(s).join("***"); files++; if (n !== t) { hits++; fs.writeFileSync(p, n); } })(d);
console.log(`scrubbed ${files} text files, ${hits} contained a secret value`);
