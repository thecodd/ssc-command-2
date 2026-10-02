import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { CookieToSet } from "@/lib/supabase/cookies";

// Pages: signed-out users are redirected to /login. API routes: signed-out callers get 401 JSON (never an HTML redirect).
export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next(); // runnable without credentials; pages/APIs report the missing config themselves
  const res = NextResponse.next({ request: req });
  const sb = createServerClient(url, key, { cookies: {
    getAll: () => req.cookies.getAll(),
    setAll: (list: CookieToSet[]) => { list.forEach(({ name, value, options }) => res.cookies.set(name, value, options)); },
  }});
  const { data: { user } } = await sb.auth.getUser();
  const path = req.nextUrl.pathname;
  // Keep refreshed session cookies on whatever response we return.
  type Res = ReturnType<typeof NextResponse.next>;
  const withCookies = (r: Res) => { res.cookies.getAll().forEach((c) => r.cookies.set(c)); return r; };

  if (!user) {
    if (path.startsWith("/api/")) return withCookies(NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } }));
    if (!path.startsWith("/login")) return withCookies(NextResponse.redirect(new URL("/login", req.url)));
  } else if (path.startsWith("/login")) {
    return withCookies(NextResponse.redirect(new URL("/dashboard", req.url)));
  }
  return res;
}
// Skipped on purpose: Next build assets, icons, manifest, service worker, and the public sample import files.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons/|samples/).*)"] };
