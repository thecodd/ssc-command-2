#!/usr/bin/env node
// Minimal stand-in for Supabase's API gateway (Kong), for the CI/validation stack ONLY: /auth/v1/* -> GoTrue, /rest/v1/* -> PostgREST, plus CORS.
// No dependencies. Env: GATEWAY_PORT (54321), GOTRUE_URL, POSTGREST_URL.
import http from "node:http";
const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);
export function createGateway({ gotrue, postgrest }) {
  const routes = [["/auth/v1", new URL(gotrue)], ["/rest/v1", new URL(postgrest)]];
  return http.createServer((req, res) => {
    const origin = req.headers.origin || "*";
    const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": req.headers["access-control-request-headers"] || "*", "Access-Control-Expose-Headers": "*", "Access-Control-Max-Age": "600", Vary: "Origin" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    if (req.url === "/health") { res.writeHead(200, { ...cors, "content-type": "text/plain" }); return res.end("ok"); }
    const hit = routes.find(([p]) => req.url === p || req.url.startsWith(p + "/") || req.url.startsWith(p + "?"));
    if (!hit) { res.writeHead(404, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ message: "no route", path: req.url.split("?")[0] })); }
    const [prefix, target] = hit;
    const up = http.request({ hostname: target.hostname, port: target.port || 80, method: req.method, path: req.url.slice(prefix.length) || "/", headers: { ...req.headers, host: target.host } }, (r) => { res.writeHead(r.statusCode || 502, { ...r.headers, ...cors }); r.pipe(res); });
    up.on("error", (e) => { res.writeHead(502, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify({ message: "upstream unavailable", detail: e.code || e.message })); });
    req.pipe(up);
  });
}
if (process.argv[1]?.endsWith("api_gateway.mjs")) {
  const gw = createGateway({ gotrue: process.env.GOTRUE_URL || "http://127.0.0.1:9999", postgrest: process.env.POSTGREST_URL || "http://127.0.0.1:3000" });
  gw.listen(num(process.env.GATEWAY_PORT, 54321), "0.0.0.0", () => console.log(`gateway listening on ${process.env.GATEWAY_PORT || 54321}`));
}
