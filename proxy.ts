import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { CookieToSet } from "@/lib/supabase/cookies";

// Pages: signed-out users are redirected to /login. API routes: signed-out callers get 401 JSON (never an HTML redirect).
// Content-Security-Policy with a per-request nonce. Next reads the nonce from this header on the REQUEST and stamps it on its own scripts,
// so no 'unsafe-inline' for scripts is needed. Every page is rendered dynamically (see app/layout.tsx), which is what makes a nonce possible.
export function buildCsp(nonce: string, supabaseUrl: string | undefined, isDev = process.env.NODE_ENV !== "production") {
  let api = ""; try { api = supabaseUrl ? new URL(supabaseUrl).origin : ""; } catch {}
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${api}`.trim(),
    "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join("; ");
}
export async function proxy(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const nonce = btoa(crypto.randomUUID()), csp = buildCsp(nonce, url);
  const headers = new Headers(req.headers); headers.set("x-nonce", nonce); headers.set("Content-Security-Policy", csp);
  const withCsp = <T extends NextResponse>(r: T): T => { r.headers.set("Content-Security-Policy", csp); return r; };
  if (!url || !key) return withCsp(NextResponse.next({ request: { headers } })); // runnable without credentials; pages/APIs report the missing config themselves
  if (req.nextUrl.pathname === "/api/health") return withCsp(NextResponse.next({ request: { headers } })); // public liveness probe, no data
  const res = withCsp(NextResponse.next({ request: { headers } }));
  const sb = createServerClient(url, key, { cookies: {
    getAll: () => req.cookies.getAll(),
    setAll: (list: CookieToSet[]) => { list.forEach(({ name, value, options }) => res.cookies.set(name, value, options)); },
  }});
  const { data: { user } } = await sb.auth.getUser();
  const path = req.nextUrl.pathname;
  // Keep refreshed session cookies on whatever response we return.
  type Res = ReturnType<typeof NextResponse.next>;
  const withCookies = (r: Res) => { res.cookies.getAll().forEach((c) => r.cookies.set(c)); return withCsp(r); };

  if (!user) {
    if (path.startsWith("/api/")) return withCookies(NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } }));
    if (!path.startsWith("/login")) return withCookies(NextResponse.redirect(new URL("/login", req.url)));
  } else if (path.startsWith("/login")) {
    return withCookies(NextResponse.redirect(new URL("/dashboard", req.url)));
  }
  return res;
}
// Skipped on purpose: Next build assets, icons, manifest, service worker, and the public sample import files.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|robots.txt|sw.js|offline.html|icons/|samples/).*)"] };
