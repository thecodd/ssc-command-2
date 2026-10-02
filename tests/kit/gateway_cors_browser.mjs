// REAL-BROWSER CORS check of the CI gateway (scripts/ci/api_gateway.mjs), independent of PostgreSQL. Chromium loads a page from one origin and POSTs (with apikey and
// content-type, so the browser sends a preflight) through the gateway to a fake upstream that behaves like GoTrue: it adds its OWN Access-Control-* headers.
// Exit 0 = the browser accepted the response; 1 = it was blocked (prints why); 3 = no Playwright/Chromium available (BLOCKED, never PASS).
import http from "node:http";
import path from "node:path";
import cp from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const gwModule = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "scripts/ci/api_gateway.mjs");
const { createGateway } = await import(gwModule);
const load = (n) => { try { return require(require.resolve(n, { paths: [root] })); } catch {} try { return require(path.join(cp.execSync("npm root -g").toString().trim(), n)); } catch {} return null; };
const pw = load("playwright"); if (!pw) { console.log("BLOCKED: playwright not installed"); process.exit(3); }
const listen = (s) => new Promise((r) => s.listen(0, "127.0.0.1", () => r(s.address().port)));
// fake GoTrue: answers /token with JSON AND its own CORS headers (as GoTrue's CORS middleware does)
const upstream = http.createServer((q, s) => { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => {
  const h = { "content-type": "application/json", "access-control-allow-origin": q.headers.origin || "*", "access-control-allow-credentials": "true", "access-control-expose-headers": "X-Total-Count", vary: "Accept-Encoding", "x-upstream": "gotrue" };
  if (q.method === "OPTIONS") { s.writeHead(204, { ...h, "access-control-allow-methods": "POST", "access-control-allow-headers": "authorization" }); return s.end(); }
  s.writeHead(200, h); s.end(JSON.stringify({ access_token: "tok", echoed: b.length })); }); });
const up = await listen(upstream);
const gw = createGateway({ gotrue: `http://127.0.0.1:${up}`, postgrest: `http://127.0.0.1:${up}` }), gp = await listen(gw);
const page = http.createServer((q, s) => { s.writeHead(200, { "content-type": "text/html" }); s.end(`<!doctype html><title>cors</title><script>
  window.result = fetch("http://127.0.0.1:${gp}/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: "anon", "content-type": "application/json", "x-client-info": "supabase-js" }, body: JSON.stringify({ email: "a@b.test", password: "x" }) })
    .then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() }), (e) => ({ error: String(e) }));</script>`); });
const pp = await listen(page);
let code = 1;
try {
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] }).catch((e) => { console.log("BLOCKED: cannot launch Chromium: " + e.message.split("\n")[0]); process.exit(3); });
  const p = await browser.newPage(); const errors = []; p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await p.goto(`http://127.0.0.1:${pp}/`); const res = await p.evaluate(() => window.result);
  if (res.ok && res.body.access_token === "tok") { console.log(`PASS: Chromium accepted the cross-origin POST through the gateway (HTTP ${res.status})`); code = 0; }
  else console.log(`FAIL: Chromium blocked the cross-origin POST: ${JSON.stringify(res)} | console: ${errors.join(" // ").slice(0, 400)}`);
  await browser.close();
} finally { upstream.close(); gw.close(); page.close(); }
process.exit(code);
