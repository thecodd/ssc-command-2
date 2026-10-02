// Static audits (no network, no build): import/export resolution, server/client boundary, routes + links, TODO scan, fake-data scan, hydration/effect greps.
// Run: node tests/study/audit.js     (exit 1 on any hard failure; "REVIEW" lines are for a human)
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "../..");
const files = []; (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (["node_modules", ".next", ".git"].includes(f.name)) continue; const p = path.join(d, f.name); f.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f.name) && files.push(p); } })(root);
const rel = (p) => path.relative(root, p), src = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));
let hard = 0; const bad = (m) => { hard++; console.log("  FAIL", m); }, review = (m) => console.log("  REVIEW", m);
const resolve = (spec, from) => { let base = spec.startsWith("@/") ? path.join(root, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null; if (!base) return null; for (const e of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (src.has(base + e)) return base + e; return null; };
const exportsOf = (t) => { const n = new Set(); for (const m of t.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|function\*?|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/g)) n.add(m[1]); for (const m of t.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) m[1].split(",").forEach((x) => n.add(x.trim().split(/\s+as\s+/).pop())); if (/export\s+default/.test(t)) n.add("default"); return n; };
const imports = (t) => [...t.matchAll(/import\s+(type\s+)?(?:([A-Za-z0-9_$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:\*\s+as\s+\w+\s*)?from\s+["']([^"']+)["']/g)].map((m) => ({ typeOnly: !!m[1], def: m[2], names: (m[3] || "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/^type\s+/, "").split(/\s+as\s+/)[0]), spec: m[4] }));

console.log("1. import/export audit");
for (const [f, t] of src) for (const i of imports(t)) { const r = resolve(i.spec, f); if (!r) { if (i.spec.startsWith("@/") || i.spec.startsWith(".")) bad(`${rel(f)}: unresolved import ${i.spec}`); continue; }
  const ex = exportsOf(src.get(r)); for (const n of i.names) if (!ex.has(n)) bad(`${rel(f)}: ${n} is not exported by ${i.spec}`); if (i.def && !ex.has("default")) bad(`${rel(f)}: ${i.spec} has no default export`); }

console.log("2. server/client boundary audit");
const isClient = (t) => /^\s*["']use client["']/.test(t), isActions = (t) => /^\s*["']use server["']/.test(t);
const FORBIDDEN = [/^@\/services\//, /^@\/lib\/auth$/, /^@\/lib\/supabase\/server$/, /^next\/headers$/, /^@\/lib\/cache$/];
for (const [f, t] of src) { if (!isClient(t)) continue; const seen = new Set(), stack = [[f, [rel(f)]]];
  while (stack.length) { const [cur, chain] = stack.pop(); if (seen.has(cur)) continue; seen.add(cur);
    for (const i of imports(src.get(cur))) { if (i.typeOnly) continue; if (FORBIDDEN.some((r) => r.test(i.spec))) { bad(`client module reaches server-only ${i.spec}: ${chain.join(" -> ")}`); continue; }
      const r = resolve(i.spec, cur); if (r && !isActions(src.get(r)) && !seen.has(r)) stack.push([r, [...chain, rel(r)]]); } } }
for (const [f, t] of src) if (isActions(t) && !/^app\/actions\//.test(rel(f))) bad(`"use server" outside app/actions: ${rel(f)}`);
for (const [f, t] of src) if (/components\/study\//.test(rel(f)) && /from\s+["']@\/services\/(?!.*type)/.test(t) && !/import type[^;]+@\/services/.test(t)) bad(`${rel(f)} imports services directly`);

console.log("3. route audit");
const pages = files.filter((f) => /\/(page|route)\.tsx?$/.test(f) && rel(f).startsWith("app/")).map((f) => ({ f, url: "/" + rel(f).replace(/^app\//, "").replace(/\/(page|route)\.tsx?$/, "").split("/").filter((s) => !/^\(.*\)$/.test(s)).join("/") }));
const urls = new Map(); for (const p of pages) { const k = p.url.replace(/\[[^\]]+\]/g, "[]"); if (urls.has(k) && !p.url.includes("[...")) bad(`duplicate route ${p.url}: ${rel(p.f)} and ${rel(urls.get(k))}`); urls.set(k, p.f); }
const pat = pages.map((p) => ({ url: p.url, catchAll: p.url.includes("[..."), re: new RegExp("^" + p.url.replace(/\[\.\.\.[^\]]+\]/g, ".+").replace(/\[[^\]]+\]/g, "[^/]+") + "$") }));
const study = pages.filter((p) => p.url.startsWith("/study")).map((p) => p.url); console.log("   study routes:", study.join("  "));
for (const need of ["/study", "/study/[type]/[id]", "/revision"]) if (!pages.some((p) => p.url === need)) bad(`missing route ${need}`);
for (const f of ["app/(focus)/study/[type]/[id]/loading.tsx", "app/(focus)/study/[type]/[id]/error.tsx", "app/(focus)/study/[type]/[id]/not-found.tsx"]) if (!fs.existsSync(path.join(root, f))) bad("missing " + f);
console.log("4. broken-link scan (string hrefs)");
const placeholder = new Set(), dead = [];
for (const [f, t] of src) { if (/^tests\//.test(rel(f))) continue; for (const m of t.matchAll(/href=(?:"([^"]+)"|\{`([^`]+)`\})/g)) { let h = (m[1] || m[2]).split("?")[0].split("#")[0]; if (!h.startsWith("/")) continue; h = h.replace(/\$\{[^}]+\}/g, "x"); const hit = pat.find((p) => !p.catchAll && p.re.test(h)); if (hit) continue; if (pat.some((p) => p.catchAll && p.re.test(h))) placeholder.add(h); else dead.push(`${rel(f)}: ${h}`); } }
for (const d of dead) bad("dead link " + d); console.log("   links that only reach the pre-existing 'not built yet' catch-all:", [...placeholder].sort().join(" ") || "none");
const study4 = [...placeholder].filter((h) => /^\/(study|revision)/.test(h)); if (study4.length) bad("Study/Revision link hits the placeholder: " + study4.join(" "));

console.log("5. TODO/FIXME scan (Phase 5 files)");
const p5 = (f) => /components\/study|lib\/study|services\/stud|app\/actions\/study|\(focus\)|app\/\(app\)\/(study|revision)|tests\/(study|fixtures)/.test(rel(f));
for (const [f, t] of src) if (p5(f)) t.split("\n").forEach((l, i) => /TODO|FIXME|XXX|HACK/.test(l) && bad(`${rel(f)}:${i + 1} ${l.trim()}`));

console.log("6. fake-data scan");
for (const [f, t] of src) { if (!p5(f) || /tests\//.test(rel(f))) continue;
  t.split("\n").forEach((l, i) => { if (/^\s*(\/\/|\/\*|\*)/.test(l)) return; if (/Math\.random|lorem|dummy|mock/i.test(l)) bad(`${rel(f)}:${i + 1} ${l.trim().slice(0, 100)}`); if (/>\s*\d+(\.\d+)?\s*%|>\s*\d{2,}\s*<|\b(pyqs?|accuracy|attempts?)\b[^=\n]{0,20}[:=]\s*[1-9]\d*[,;}]/i.test(l) && !/^\s*(\/\/|\*)/.test(l)) review(`${rel(f)}:${i + 1} numeric literal near a stat: ${l.trim().slice(0, 110)}`); }); }

console.log("7. hydration / effect greps (client components)");
for (const [f, t] of src) { if (!isClient(t) || !/components\/study|components\/ui\/Sheet/.test(rel(f))) continue;
  t.split("\n").forEach((l, i) => { if (/Date\.now\(\)|new Date\(|Math\.random|toLocale|Intl\./.test(l)) review(`${rel(f)}:${i + 1} time/locale in client code: ${l.trim().slice(0, 100)}`); if (/\b(window|document|localStorage|navigator)\./.test(l) && !/addEventListener|removeEventListener|querySelector|matchMedia|visibilityState/.test(l)) review(`${rel(f)}:${i + 1} browser global: ${l.trim().slice(0, 100)}`); if (/eslint-disable/.test(l)) review(`${rel(f)}:${i + 1} ${l.trim().slice(0, 120)}`); }); }
console.log(`\nhard failures: ${hard}`); process.exit(hard ? 1 : 0);
