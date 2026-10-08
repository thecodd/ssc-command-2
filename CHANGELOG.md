# Changelog

## 1.0.0
- Phases 8-11: tasks, notes and resources; admin publishing workflow (draft > review > published > archived) and curriculum import; accessibility fixes across 6 viewports.
- Next.js 16.4 / React 19.2 upgrade (async request APIs, `middleware.ts` renamed to `proxy.ts`, ESLint 9 flat config), clearing all production `npm audit` findings (Next 14 and Next <= 15.5.26 carry middleware-bypass and DoS advisories). Next 15.5.27 was tried first and rejected: its client router intermittently fetched the next page and never committed the navigation, so forms stayed on "Saving..." and refreshes did nothing (reproduced in loops, gone on 16.4).
- Lint: the React-Compiler-only rules added by eslint-plugin-react-hooks 7 (`refs`, `set-state-in-effect`, `static-components`, `purity`) are switched off in `eslint.config.mjs` because the app does not use the Compiler; `rules-of-hooks` and `exhaustive-deps` are unchanged.
- Security hardening: nonce-based CSP on every response, static security headers, `X-Powered-By` off, server-action body limit that matches the 5 MB import cap, public `/api/health`, robots disallow, Dependabot.
- Fixes found while testing: shipped import samples were rejected by validation (JSON `is_verified`/`is_official`, CSV had no way to name a source; CSV now takes a `source` row); study page for an SSC subtopic failed on an invalid PostgREST embed; `/robots.txt` redirected to login; e2e form flows are now hydration-safe.
- Verification: unit suite 137, SQL suites 334/73/53/56, real-browser 176/176 across 320-1440px, axe 71/71.
