#!/usr/bin/env node
// STATIC audit over migrations 001-014 (supporting evidence only: this is NOT execution and proves nothing about runtime behaviour).
// Catches things a real Postgres would reject at apply time (unknown functions/columns/tables, wrong arity, DDL that uses a function before it exists)
// and inventories the constructs that need a human eye (dynamic EXECUTE, ALTER DEFAULT PRIVILEGES, regprocedure/has_function_privilege, write policies).
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "../.."), dir = path.join(root, "database/migrations");
const files = fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
const strip = (s) => s.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const src = Object.fromEntries(files.map((f) => [f, strip(fs.readFileSync(path.join(dir, f), "utf8"))]));
const tables = require("./schema_model.js"), { collect } = require("./build_privileges.js"), matrix = require("./function_matrix.js");
let problems = 0; const P = (m) => { problems++; console.log("PROBLEM:", m); }, info = [];
function splitTop(s) { const o = []; let d = 0, c = "", q = false; for (const ch of s) { if (ch === "'") q = !q; if (!q) { if (ch === "(") d++; if (ch === ")") d--; } if (ch === "," && !d && !q) { o.push(c); c = ""; } else c += ch; } if (c.trim()) o.push(c); return o; }
const balanced = (s, i) => { let d = 1, j = i, q = false; while (d && j < s.length) { if (s[j] === "'") q = !q; else if (!q) { if (s[j] === "(") d++; else if (s[j] === ")") d--; } j++; } return j; };
// 1. function definitions and calls
const defs = {};
for (const f of files) for (const m of src[f].matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(/gi)) {
  const j = balanced(src[f], m.index + m[0].length), ps = splitTop(src[f].slice(m.index + m[0].length, j - 1)).filter((x) => x.trim() && !/^\s*out\s/i.test(x));
  (defs[m[1]] = defs[m[1]] || []).push({ min: ps.filter((p) => !/\bdefault\b/i.test(p)).length, max: ps.length, file: f });
}
for (const f of files) for (const m of src[f].matchAll(/\bpublic\.(\w+)\s*\(/g)) {
  const name = m[1]; if (/function\s*$/i.test(src[f].slice(Math.max(0, m.index - 60), m.index))) continue;
  if (!defs[name]) { if (!tables[name] && !/_t$/.test(name)) P(`${f}: call to undefined function public.${name}()`); continue; }
  const j = balanced(src[f], m.index + m[0].length), args = splitTop(src[f].slice(m.index + m[0].length, j - 1)).filter((x) => x.trim()).length;
  if (!defs[name].some((x) => args >= x.min && args <= x.max)) P(`${f}: public.${name}() called with ${args} args; defined ${defs[name].map((x) => `${x.min}..${x.max}@${x.file}`).join(" | ")}`);
}
// 2. DDL that is evaluated at apply time must only use functions defined in the same or an earlier migration
for (const f of files) for (const st of src[f].split(/;\s*\n/)) {
  if (!/create policy|\bcheck\s*\(|\bdefault\s+public\.|create (unique )?index|create trigger|generated always|add constraint/i.test(st)) continue;
  for (const m of st.matchAll(/\bpublic\.(\w+)\s*\(/g)) { const d = defs[m[1]]; if (d && !d.some((x) => x.file <= f)) P(`${f}: ${m[1]}() used in DDL before any migration defines it (first: ${d[0].file})`); }
}
// 3. table / column references
for (const f of files) {
  for (const m of src[f].matchAll(/insert\s+into\s+(?:public\.)?(\w+)\s*\(([^)]*)\)/gi)) { const t = m[1]; if (!tables[t]) { if (!/^(t_|pg_)/.test(t)) P(`${f}: insert into unknown table ${t}`); continue; } for (const c of m[2].split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean)) if (!tables[t].has(c)) P(`${f}: insert into ${t}: column ${c} does not exist`); }
  for (const m of src[f].matchAll(/create\s+policy\s+\S+\s+on\s+(?:public\.)?(\w+)/gi)) if (!tables[m[1]]) P(`${f}: policy on unknown table ${m[1]}`);
  for (const m of src[f].matchAll(/grant\s+(?:select|update|insert)\s*\(([^)]*)\)\s+on\s+(?:public\.)?(\w+)/gi)) { const t = m[2]; if (!tables[t]) { P(`${f}: column grant on unknown table ${t}`); continue; } for (const c of m[1].split(",").map((x) => x.trim())) if (!tables[t].has(c)) P(`${f}: grant on ${t}: column ${c} does not exist`); }
}
// 4. matrix coverage and closure (INVOKER code reachable by authenticated must only call functions authenticated can execute)
const fns = collect(), AUTH = new Set(["rpc", "admin", "rls", "pure"]);
for (const f of fns) if (!matrix[f.name]) P(`function ${f.name} (${f.file}) is not classified in function_matrix.js`);
for (const n of Object.keys(matrix)) if (!fns.some((f) => f.name === n)) P(`function_matrix.js lists ${n}, which no migration defines`);
const auth = new Set(Object.keys(matrix).filter((k) => AUTH.has(matrix[k].cls)));
for (const f of fns) { if (!auth.has(f.name) && matrix[f.name]?.cls !== "trigger") continue; if (f.sd) continue; const body = f.body.replace(/--.*$/gm, ""); for (const n of Object.keys(matrix)) if (n !== f.name && new RegExp("\\b" + n + "\\s*\\(").test(body) && !auth.has(n)) P(`INVOKER ${f.name} calls ${n} (${matrix[n].cls}), which authenticated cannot execute after 014`); }
const all = Object.values(src).join("\n");
for (const st of all.split(/;\s*\n/)) { if (!/create policy|check\s*\(|\bdefault\s|create (unique )?index|generated always|create (or replace )?view/i.test(st) || /^\s*create (or replace )?function/i.test(st.trim()) || /security definer/i.test(st)) continue; for (const n of Object.keys(matrix)) if (!auth.has(n) && new RegExp("\\b" + n + "\\s*\\(").test(st)) P(`caller-context use of non-granted ${n} in: ${st.trim().replace(/\s+/g, " ").slice(0, 120)}`); }
// 5. views run with the owner's rights unless security_invoker
for (const m of all.matchAll(/create (?:or replace )?view\s+(?:public\.)?(\w+)[^;]*/gi)) if (!/security_invoker/i.test(m[0])) P(`view ${m[1]} is not security_invoker (bypasses RLS)`);
// 6. non-static policies that grant writes without an owner/admin/visibility predicate
for (const m of all.matchAll(/create policy\s+("[^"]+"|\w+)\s+on\s+(?:public\.)?(\w+)\s+(?:as \w+\s+)?for\s+(insert|update|delete|all)\b([\s\S]*?);/gi)) { const body = m[4]; if (!/auth\.uid\(\)|is_admin\(\)|is_\w+_visible\(/i.test(body)) P(`write policy ${m[1]} on ${m[2]} (${m[3]}) has no auth.uid()/is_admin()/visibility predicate`); }
// 8. migrations that CLAIM "Safe to re-run" must not contain unguarded DDL (re-applying them by hand would fail)
for (const f of files) {
  const raw = fs.readFileSync(path.join(dir, f), "utf8"); if (!/safe to re-run/i.test(raw)) continue; const s = src[f];
  const outsideDo = s.replace(/do\s*\$\$[\s\S]*?\$\$\s*;/gi, " ");
  for (const m of outsideDo.matchAll(/create\s+table\s+(?!if not exists)(?:public\.)?(\w+)/gi)) P(`${f} claims to be re-runnable but has: create table ${m[1]} without IF NOT EXISTS`);
  for (const m of outsideDo.matchAll(/create\s+(?:unique\s+)?index\s+(?!if not exists)(?:concurrently\s+)?(\w+)/gi)) P(`${f} claims to be re-runnable but has: create index ${m[1]} without IF NOT EXISTS`);
  for (const m of outsideDo.matchAll(/create\s+policy\s+("[^"]+"|\w+)\s+on\s+(?:public\.)?(\w+)/gi)) if (!new RegExp("drop\\s+policy\\s+if\\s+exists\\s+" + m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+on\\s+(?:public\\.)?" + m[2], "i").test(s)) P(`${f} claims to be re-runnable but has: create policy ${m[1]} on ${m[2]} with no preceding DROP POLICY IF EXISTS`);
  for (const m of outsideDo.matchAll(/create\s+trigger\s+(\w+)/gi)) if (!new RegExp("drop\\s+trigger\\s+if\\s+exists\\s+" + m[1], "i").test(s)) P(`${f} claims to be re-runnable but has: create trigger ${m[1]} with no DROP TRIGGER IF EXISTS`);
  for (const m of outsideDo.matchAll(/alter\s+table\s+(?:public\.)?(\w+)\s+add\s+(?!column\s+if not exists)(column|constraint)\s+(\w+)/gi)) P(`${f} claims to be re-runnable but has: alter table ${m[1]} add ${m[2]} ${m[3]} unguarded`);
  for (const m of outsideDo.matchAll(/create\s+type\s+(?:public\.)?(\w+)/gi)) P(`${f} claims to be re-runnable but has an unguarded create type ${m[1]}`);
}
// 6b. every type in every classified signature must be a builtin or a type some migration creates, so `to_regprocedure(public.<type>)` can resolve it (a custom enum must be schema-qualified)
{
  const BUILTIN = new Set(["int", "integer", "bigint", "smallint", "text", "uuid", "date", "boolean", "bool", "numeric", "jsonb", "json", "timestamptz", "timestamp", "double precision", "real"]);
  const custom = new Set([...all.matchAll(/create\s+type\s+(?:public\.)?(\w+)/gi)].map((m) => m[1])), rowTypes = new Set(Object.keys(tables));   // table row types (e.g. public.study_sessions) are valid composite types
  const { qual } = require("./build_privileges.js");
  for (const f of fns) for (const t of f.types) { const base = t.trim().replace(/^public\./, "").replace(/\[\]$/, ""); if (!BUILTIN.has(base.toLowerCase()) && !custom.has(base) && !rowTypes.has(base)) P(`${f.name}: parameter type "${t}" is neither a builtin nor created by a migration (to_regprocedure would not resolve it)`); else if (custom.has(base) && !/^public\./.test(qual(t))) P(`${f.name}: custom type ${base} is not schema-qualified in the generated signature`); }
  info.push(`custom types in signatures: ${[...new Set(fns.flatMap((f) => f.types).map((t) => t.trim().replace(/^public\./, "").replace(/\[\]$/, "")).filter((t) => custom.has(t)))].join(", ")}`);
}
// 6c. 014's assertions must compare resolved OIDs, never regprocedure TEXT (text depends on search_path, type aliases and spacing)
{
  const g = strip(fs.readFileSync(path.join(dir, "014_function_privileges.sql"), "utf8"));
  if (/regprocedure\s*::\s*text|::regprocedure::text|sig\s*<>\s*all|<>\s*all\s*\(\s*array\[/i.test(g)) P("014 compares regprocedure TEXT against an allow-list array (fragile): compare to_regprocedure() OIDs");
  if (!/\bp\.oid\s*<>\s*all\s*\(\s*v_allowed\s*\)/.test(g)) P("014 assertion no longer compares p.oid against the resolved allow-list (v_allowed)");
  const arrays = [...g.matchAll(/array\[([\s\S]*?)\]\s*loop/g)].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  const withQueue = arrays.filter((a) => a.includes("public.revision_queue()")), grant = withQueue[0];
  if (withQueue.length !== 2 || JSON.stringify(withQueue[0]) !== JSON.stringify(withQueue[1])) P("014: the GRANT allow-list and the ASSERTION allow-list must both exist and be identical");
  if (!grant) P("014: cannot find the client allow-list arrays");
  else { for (const f of fns.filter((f) => AUTH.has(matrix[f.name].cls))) { const s = `public.${f.name}(${f.types.map(require("./build_privileges.js").qual).join(", ")})`; if (!grant.includes(s)) P(`014 allow-list is missing ${s}`); } if (!grant.includes("public.set_publish_status(text, uuid, public.publish_status_t)")) P("014 allow-list lost set_publish_status(text, uuid, public.publish_status_t)"); }
}
// 7. inventories for human review
const cnt = (re) => (all.match(re) || []).length;
info.push(`functions: ${fns.length} (${fns.filter((f) => f.sd).length} SECURITY DEFINER, ${fns.filter((f) => f.sd && !f.pinned).length} without pinned search_path)`);
for (const f of fns) if (f.sd && !f.pinned) P(`SECURITY DEFINER ${f.name} has no pinned search_path`);
info.push(`dynamic EXECUTE statements: ${cnt(/\bexecute\s+(format|')/gi)} (policy/grant loops: review by hand)`, `ALTER DEFAULT PRIVILEGES statements: ${cnt(/alter default privileges/gi)}`, `regprocedure / to_regprocedure uses: ${cnt(/regprocedure/gi)}`, `has_function_privilege uses: ${cnt(/has_function_privilege/gi)}`, `tables: ${Object.keys(tables).length}`, `RLS enable statements: ${cnt(/enable row level security/gi)} (+ dynamic loops in 001)`);
console.log(problems ? `static audit: ${problems} problem(s)` : "static audit: no problems found; " + info.join("; "));
if (problems) info.forEach((i) => console.log("  " + i));
process.exit(problems ? 1 : 0);
