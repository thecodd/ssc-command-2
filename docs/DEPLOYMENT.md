# Deployment

## Requirements
- Node 22, a Supabase project (Postgres 15, GoTrue, PostgREST), a host that runs `next start` (Next.js 15, App Router, dynamic rendering).
- Environment: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. No service-role key is used by the app and none must be set.

## Database
1. Apply `database/migrations/001` ... `014` **in order** (014 last; it re-derives every EXECUTE grant). Prove them on a scratch project first, or rely on the CI gate (`.github/workflows/phase7-runtime-gate.yml`), which applies them to a real Postgres 15 on every PR.
2. Make the first admin (SQL editor only; the API cannot change `is_admin`):
   `update profiles set is_admin = true where id = '<auth-uid>';`
3. Load real curriculum at `/admin/import`. Imports land as DRAFT; an admin sends them for review, publishes, and verifies sources. The files in `public/samples/` are placeholders and are marked as such.

## Build and run
```bash
npm ci
npm run build   # needs the two env vars above
npm start
```
Every app route is rendered per request (the root layout is `force-dynamic`), because the per-request CSP nonce and the user's session cannot be baked into static HTML.

## Security posture (verified by `tests/study/hardening.test.ts` and the real-browser gate)
- `middleware.ts` sets a nonce-based CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`, no `unsafe-inline`/`unsafe-eval` in production, `frame-ancestors 'none'`, `connect-src` limited to this origin and your Supabase origin) on every response, including redirects and 401s.
- `next.config.mjs` adds nosniff, X-Frame-Options DENY, strict-origin-when-cross-origin referrer policy, a locked-down Permissions-Policy, COOP same-origin and HSTS; `X-Powered-By` is off.
- Server actions accept up to 6 MB so the 5 MB import cap is reachable (Next's default is 1 MB).
- Row-level security and the privilege allow-list (migration 014) are the real authorization layer; the app never trusts client-supplied roles.
- `GET /api/health` is public and returns `{"status":"ok"}` (no database access) for load-balancer checks. `/robots.txt` disallows all crawling (private app).
- Dependabot (npm + GitHub Actions, weekly) is configured in `.github/dependabot.yml`. `npm audit --omit=dev` reports 0 vulnerabilities; the full audit lists dev-only advisories in the Tailwind/PostCSS build chain that never ship.

## Supabase settings to check
- Auth > URL configuration: set Site URL and redirect URLs to your production origin.
- Auth > Email: enable confirmation/rate limits you want; the app does not require a specific policy.
- Keep the anon key public and the service-role key out of this app entirely.

## Release checklist
1. `npm run typecheck && npm run lint && npm run test:study && npm run test:kit`
2. `npm run validate:phase7 -- --db-url <scratch db url>` ends with `READY FOR PHASE 8`. The supplementary S6 stage (fixture smoke) needs globally installed react, react-dom and esbuild and is reported BLOCKED where they are absent; it is evidence only and does not decide readiness.
3. GitHub Actions gate green on the release commit.
