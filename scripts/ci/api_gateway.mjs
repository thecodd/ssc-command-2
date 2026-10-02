#!/usr/bin/env node
// Minimal stand-in for Supabase's API gateway (Kong), for the CI/validation stack ONLY: /auth/v1/* -> GoTrue, /rest/v1/* -> PostgREST, plus CORS.
// No dependencies. Env: GATEWAY_PORT (54321), GOTRUE_URL, POSTGREST_URL.
// CORS is owned by the gateway: upstream Access-Control-* response headers are DROPPED and exactly one canonical set is emitted. (Run #3: GoTrue's own
// Access-Control-Allow-Origin plus the gateway's produced "multiple values" and Chromium blocked the login; curl/Node fetch do not enforce CORS, so the probe passed.)
import http from "node:http";
const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);
const DEFAULT_ALLOW_HEADERS = "authorization, apikey, content-type, x-client-info, accept-profile, content-profile, prefer, range, x-supabase-api-version";
const EXPOSE = "content-range, content-profile, x-total-count, x-supabase-api-version";
/** Exactly one value per CORS header. `origin` is reflected (credentials are never used by supabase-js, so no Allow-Credentials). */
export function corsHeaders(req) {
  return {
    "access-control-allow-origin": req.headers.origin || "*",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": req.headers["access-control-request-headers"] || DEFAULT_ALLOW_HEADERS,
    "access-control-expose-headers": EXPOSE,
    "access-control-max-age": "600",
  };
}
/** Upstream headers minus every access-control-*; Vary merged so it always contains Origin (and keeps upstream values such as Accept-Encoding). */
export function forwardHeaders(upstream, req) {
  const out = {}; let vary = [];
  for (const [k, v] of Object.entries(upstream)) {
    const lk = k.toLowerCase();
    if (lk.startsWith("access-control-")) continue;
    if (lk === "vary") { vary.push(...String(v).split(",").map((x) => x.trim()).filter(Boolean)); continue; }
    out[lk] = v;
  }
  if (!vary.some((x) => x.toLowerCase() === "origin")) vary.push("Origin");
  return { ...out, ...corsHeaders(req), vary: [...new Set(vary)].join(", ") };
}
export function createGateway({ gotrue, postgrest }) {
  const routes = [["/auth/v1", new URL(gotrue)], ["/rest/v1", new URL(postgrest)]];
  return http.createServer((req, res) => {
    const base = { ...corsHeaders(req), vary: "Origin" };
    if (req.method === "OPTIONS") { res.writeHead(204, { ...base, "content-length": "0" }); return res.end(); }
    if (req.url === "/health") { res.writeHead(200, { ...base, "content-type": "text/plain" }); return res.end("ok"); }
    const hit = routes.find(([p]) => req.url === p || req.url.startsWith(p + "/") || req.url.startsWith(p + "?"));
    if (!hit) { res.writeHead(404, { ...base, "content-type": "application/json" }); return res.end(JSON.stringify({ message: "no route", path: req.url.split("?")[0] })); }
    const [prefix, target] = hit;
    const up = http.request({ hostname: target.hostname, port: target.port || 80, method: req.method, path: req.url.slice(prefix.length) || "/", headers: { ...req.headers, host: target.host } }, (r) => {
      res.writeHead(r.statusCode || 502, forwardHeaders(r.headers, req)); r.pipe(res);
    });
    up.on("error", (e) => { res.writeHead(502, { ...base, "content-type": "application/json" }); res.end(JSON.stringify({ message: "upstream unavailable", detail: e.code || e.message })); });
    req.pipe(up);
  });
}
if (process.argv[1]?.endsWith("api_gateway.mjs")) {
  const gw = createGateway({ gotrue: process.env.GOTRUE_URL || "http://127.0.0.1:9999", postgrest: process.env.POSTGREST_URL || "http://127.0.0.1:3000" });
  gw.listen(num(process.env.GATEWAY_PORT, 54321), "0.0.0.0", () => console.log(`gateway listening on ${process.env.GATEWAY_PORT || 54321}`));
}
