import * as fs from "fs";
import * as path from "path";
declare const t: (name: string, fn: () => void | Promise<void>) => Promise<void>;
declare const assert: typeof import("assert");
declare const require: any;
const root = path.join(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
export default async function () {
  await t("hardening: the CSP has a per-request nonce, no inline scripts, no framing, and allows only our own API origin", () => {
    const { buildCsp } = require(path.join(root, "proxy.ts"));
    const csp: string = buildCsp("abc123", "https://proj.supabase.co/", false);
    const dir = (n: string) => csp.split("; ").find((d) => d.startsWith(n + " ")) ?? "";
    assert.ok(dir("script-src").includes("'nonce-abc123'") && dir("script-src").includes("'strict-dynamic'"));
    assert.ok(!/unsafe-inline|unsafe-eval/.test(dir("script-src")), "scripts must not allow unsafe-inline/unsafe-eval in production");
    assert.ok(dir("connect-src").includes("https://proj.supabase.co") && !dir("connect-src").includes("*"));
    assert.strictEqual(dir("frame-ancestors"), "frame-ancestors 'none'");
    assert.ok(csp.includes("object-src 'none'") && csp.includes("base-uri 'self'") && csp.includes("form-action 'self'"));
    assert.ok(buildCsp("n", "https://x.co", true).includes("'unsafe-eval'"), "dev needs eval for React refresh");
    assert.ok(!buildCsp("n", "not a url", false).includes("undefined"), "a bad Supabase URL must not break the policy");
  });
  await t("hardening: every response carries the static security headers, and powered-by is off", () => {
    const cfg = read("next.config.mjs");
    for (const h of ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Strict-Transport-Security", "Cross-Origin-Opener-Policy"]) assert.ok(cfg.includes(h), h + " missing");
    assert.ok(/poweredByHeader:\s*false/.test(cfg));
  });
  await t("hardening: the server action body limit is not smaller than the import file limit", () => {
    const limit = Number(/file\.size > ([\d_]+)/.exec(read("app/actions/import.ts"))![1].replace(/_/g, ""));
    const mb = Number(/bodySizeLimit:\s*"(\d+)mb"/.exec(read("next.config.mjs"))![1]);
    assert.ok(mb * 1024 * 1024 > limit, `bodySizeLimit ${mb}mb must exceed the ${limit}-byte import cap`);
  });
  await t("hardening: pages are never prerendered (nonce needs a request), the supabase client opts into dynamic rendering, health stays public", () => {
    assert.ok(/export const dynamic = "force-dynamic"/.test(read("app/layout.tsx")));
    assert.ok(/const jar = cookies\(\)/.test(read("lib/supabase/server.ts")), "cookies() must be called eagerly so callers are dynamic");
    assert.ok(read("proxy.ts").includes('"/api/health"'));
    assert.ok(!/getUser|createClient|requireUser/.test(read("app/api/health/route.ts")), "health must not touch data");
  });
}
