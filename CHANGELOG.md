# Changelog

## 1.0.0
- Phases 8-11: tasks, notes and resources; admin publishing workflow (draft > review > published > archived) and curriculum import; accessibility fixes across 6 viewports.
- Next.js 15.5 / React 19 upgrade (async request APIs), clearing all production `npm audit` findings.
- Security hardening: nonce-based CSP on every response, static security headers, `X-Powered-By` off, server-action body limit that matches the 5 MB import cap, public `/api/health`, robots disallow, Dependabot.
- Fixes found while testing: shipped import samples were rejected by validation (JSON `is_verified`/`is_official`, CSV had no way to name a source; CSV now takes a `source` row); study page for an SSC subtopic failed on an invalid PostgREST embed; `/robots.txt` redirected to login; e2e form flows are now hydration-safe.
- Verification: unit suite 137, SQL suites 334/73/53/56, real-browser 176/176 across 320-1440px, axe 71/71.
