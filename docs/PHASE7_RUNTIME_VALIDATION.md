# Phase 7 runtime validation

Status words: **PASS** = executed and succeeded. **FAIL** = executed and failed. **BLOCKED** = could not be executed (exact blocker given). **NOT RUN** = skipped because a prerequisite did not pass. BLOCKED/NOT RUN are never reported as PASS.
Two areas below are kept strictly apart: PART A is what was executed in this sandbox; PART B is what must still be executed on a real environment. Nothing in A answers B.

---
# PART A: CURRENT SANDBOX RESULT (run 2026-10-02T05-37-59-849Z, `node scripts/validate_phase7.mjs`)

## A1. Environment
Node v22.22.2, npm 10.9.7, Chromium 141 + Playwright 1.56 (python and global node). **No** PostgreSQL, `psql`, Docker, Supabase CLI or Postgres-in-WASM; **no** project `node_modules` (no next, eslint, tailwind, @supabase, @types); every package registry and apt mirror answers HTTP 403 `host_not_allowed`, so none of it can be installed.

## A2. Kit verdict from this run: **NOT READY FOR PHASE 8**
| # | Stage | Category | Status | Detail |
| --- | --- | --- | --- | --- |
| 1 | Environment check | GATE (mandatory) | **BLOCKED** | missing: psql (PostgreSQL client) |
| 2 | Dependency check | GATE (mandatory) | **BLOCKED** | BLOCKED - dependencies unavailable (missing in node_modules: next, typescript, eslint, react, react-dom, @supabase/supabase-js, tailwindcss). Run `npm ci` (or `npm install`) with registry access. |
| 3 | Migration ordering check (001..014, contiguous, 014 last) | GATE (mandatory) | **PASS** | 14 migrations: 001_schema.sql ... 014_function_privileges.sql |
| S1 | SQL suite files are up to date with their sources (node scripts/validate/sqlbuild.mjs --check) | SUPPORTING | **PASS** | phase4, phase6, phase7, security suites are identical to a fresh build |
| 4a | Database preflight + scratch-safety | GATE (mandatory) | **BLOCKED** | psql is not installed (install the PostgreSQL client 15+) |
| 4b | Migration application (001..014, once each, in order, stop on first failure) | GATE (mandatory) | **BLOCKED** | blocked by stage 4a: psql is not installed (install the PostgreSQL client 15+) |
| 5 | Phase 4 SQL suite | GATE (mandatory) | **BLOCKED** | requires migrations 001..014 applied to a real database (stage 4b) |
| 6 | Phase 6 SQL suite | GATE (mandatory) | **BLOCKED** | requires migrations 001..014 applied to a real database (stage 4b) |
| 7 | Phase 7 SQL suite | GATE (mandatory) | **BLOCKED** | requires migrations 001..014 applied to a real database (stage 4b) |
| 7b | Security regression SQL suite | GATE (mandatory) | **BLOCKED** | requires migrations 001..014 applied to a real database (stage 4b) |
| 8 | Typecheck (npm run typecheck) | GATE (mandatory) | **BLOCKED** | BLOCKED - dependencies unavailable (stage 2). No stub is substituted. |
| 9 | Lint (npm run lint) | GATE (mandatory) | **BLOCKED** | BLOCKED - dependencies unavailable (stage 2). No stub is substituted. |
| 10 | Production build (npm run build) | GATE (mandatory) | **BLOCKED** | BLOCKED - dependencies unavailable (stage 2). No stub is substituted. |
| 11 | Real browser validation (real routes, 5 viewports) | GATE (mandatory) | **BLOCKED** | production build did not pass (stage 10); no validated database (stage 4b); NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set (they must point at the SAME scratch database and be set before the build); E2E_EMAIL / E |
| 11b | Accessibility checks on the real app | GATE (mandatory) | **BLOCKED** | requires stage 11 prerequisites |
| S2 | Static SQL audit over migrations 001-014 (NOT execution) | SUPPORTING | **PASS** | static audit: no problems found; functions: 98 (47 SECURITY DEFINER, 0 without pinned search_path); dynamic EXECUTE statements: 40 (policy/grant loops: review by hand); ALTER DEFAULT PRIVILEGES statements: 2; regprocedure / to_reg |
| S3 | 014_function_privileges.sql + matrix doc regenerate byte-identically | SUPPORTING | **PASS** | regeneration changed nothing |
| S4 | Node tests (node tests/study/run.js) | SUPPORTING | **PASS** | 115 passed, 0 failed |
| S5 | Reference oracle (node database/tests/reference/run_reference_tests.js) | SUPPORTING | **PASS** | 55 oracle/mirror assertions passed; 35 SQL vectors generated |
| S6 | Fixture component smoke in Chromium (NOT real-route validation) | SUPPORTING | **PASS** | 30 passed, 0 failed of 30 (fixture data, fake APIs, no CSS) |

## A3. Migrations 001..014 (stage 4b): all **BLOCKED**
| # | Status | Blocker |
| --- | --- | --- |
| 001 | BLOCKED | no PostgreSQL / psql in this sandbox |
| 002 | BLOCKED | no PostgreSQL / psql in this sandbox |
| 003 | BLOCKED | no PostgreSQL / psql in this sandbox |
| 004 | BLOCKED | no PostgreSQL / psql in this sandbox |
| 005 | BLOCKED | no PostgreSQL / psql in this sandbox |
| 006 | BLOCKED | no PostgreSQL / psql in this sandbox |
| 007 | BLOCKED | no PostgreSQL / psql in this sandbox |
| 008 | BLOCKED | no PostgreSQL / psql in this sandbox |
| 009 | BLOCKED | no PostgreSQL / psql in this sandbox |
| 010 | BLOCKED | no PostgreSQL / psql in this sandbox |
| 011 | BLOCKED | no PostgreSQL / psql in this sandbox |
| 012 | BLOCKED | no PostgreSQL / psql in this sandbox |
| 013 | BLOCKED | no PostgreSQL / psql in this sandbox |
| 014 | BLOCKED | no PostgreSQL / psql in this sandbox |
Not executed, so not claimed: apply order success, SQL syntax acceptance, RLS, EXECUTE privileges, SECURITY DEFINER/INVOKER behaviour, cross-user isolation, expected-step protection, revision uniqueness and history append-only, server grading, archived/unpublished visibility, custom ladders, graduation, rollback behaviour.

## A4. SQL suites (stages 5, 6, 7, 7b): all **BLOCKED**, 0 checks executed
Built and byte-identical to a fresh build (`node scripts/validate/sqlbuild.mjs --check`): Phase 4 = 317 `check_` calls, Phase 6 = 75, Phase 7 = 50, Security regression = 51 (+ the generated per-function catalog checks). Executed: 0 of 0.

## A5. Typecheck / lint / build / real browser / accessibility
Typecheck **BLOCKED**, Lint **BLOCKED**, Build **BLOCKED** (dependencies unavailable; no stub substituted). Real-route browser validation at 360/390/412/1024/1440 **BLOCKED** (needs the built app + Supabase + seeded user). Real-app accessibility **BLOCKED**; axe **NOT RUN** (not installed).

## A6. Supporting evidence that DID execute (never counts toward readiness)
| Check | Result |
| --- | --- |
| Kit + CI-gate self-tests (`npm run test:kit`): 13 kit tests against a fake `psql` + 24 CI-gate tests (workflow/compose static checks, gateway, env/wait/scrub/prepare/seed scripts, seed SQL vs schema) | 37 passed, 0 failed (prove the kit's safety rules, ledger, stop-on-first-failure, parsing, exit codes, verdict logic and the CI wiring; say nothing about PostgreSQL or a real GitHub runner) |
| Node tests (`node tests/study/run.js`) | 115 passed, 0 failed |
| Reference oracle | 55 assertions passed, 35 SQL vectors generated |
| Static SQL audit (`database/security/static_audit.cjs`) | no problems; 98 functions, 47 SECURITY DEFINER, 0 without pinned search_path |
| 014 + matrix doc regenerate byte-identically | PASS |
| SQL suite files identical to a fresh build (Node builder reproduces the python/bash output byte-for-byte for phase 4/6/7) | PASS |
| Stubbed `tsc` (hand-written stubs; NOT a typecheck) | 0 errors |
| Fixture component smoke in Chromium (fixture data, fake APIs, no CSS; **not** real-route validation) | 30 passed, 0 failed |

## A7. Defects found and fixed in this phase
1. `database/security/schema_model.js` resolved migrations from the current directory (broke when run from elsewhere).
2. `database/security/build_privileges.js` rewrote 014 and the matrix doc as a side effect of being imported; now only when run directly.
3. Validation-kit preflight compared psql boolean output to `"true"` (psql prints `t`/`f`); fixed before first use, covered by a test with a mutation check.
(No defect in migrations 001-014 was found or could be ruled out by execution.)

## A8. Newly discovered risks
Real typecheck/lint/build have never run on this code base (expect findings). `package.json` gained `playwright` and `axe-core` dev dependencies for the kit and has no lockfile. Heuristic static checks can miss logic inside dynamic EXECUTE. See `docs/PHASE7_STATIC_AUDIT.md` (ranked performance notes P0/P1/P2, none measured).

## A9. Sandbox gate decision: **NOT READY FOR PHASE 8**

---
# CI GATE: **NOT EXECUTED IN THIS SANDBOX**
A GitHub Actions workflow (`.github/workflows/phase7-runtime-gate.yml`) and a Docker fallback (`docker/validation/docker-compose.yml`) now exist to run the Part B gate automatically on a clean runner: PostgreSQL 15 service container, scratch database `cgl_validation_scratch`, GoTrue + PostgREST + a small gateway for the real browser, CI-only seed data, then the validation kit. Documentation: `docs/CI_PHASE7_GATE.md`.
- Executed here (supporting evidence only): YAML syntax, referenced files/scripts/npm targets, environment-variable wiring, that the database URL reaches every `psql` call of the kit, failure exit codes, artifact paths, and unit tests of the gateway, env generator, wait/scrub/prepare/seed scripts (`npm run test:kit`).
- NOT executed: the workflow on a GitHub runner, the pinned GoTrue/PostgREST containers, the seed SQL against PostgreSQL, and everything in Part B.
- No claim of READY. The CI gate has not run, so the decision below is unchanged.

---
# FIRST REAL CI RUN: defects reported by the maintainer and fixed (fixes NOT yet re-validated on a runner)
The first GitHub Actions run (reported by the maintainer; not observed from this sandbox) showed the CI environment works (PostgreSQL, scratch DB, GoTrue, PostgREST, dependencies, Playwright; migrations 001-013 passed) and exposed three real defects:
1. **Migration 014 assertion**: it compared `p.oid::regprocedure::text` against a text allow-list. `regprocedure` text has no space after commas, prints `integer` for `int`, and depends on `search_path`, so legitimate admin RPCs such as `set_publish_status(text,uuid,publish_status_t)` never matched. Fixed at the source (`database/security/build_privileges.js`): the allow-list is resolved once with `to_regprocedure()` into an OID array and the assertion is `p.oid <> all (v_allowed)`; the same list feeds the grants. The security assertion is not weakened (it is now exact). `014_function_privileges.sql` was regenerated and a second regeneration is byte-identical. The static audit now also checks that every classified signature uses only builtin or migration-created types (custom enums are `public.`-qualified) and that 014 never compares signature text again.
2. **TypeScript (9 errors)**: untyped cookie callbacks in `lib/supabase/server.ts` and `middleware.ts` (new shared `CookieToSet` type from `@supabase/ssr`'s `CookieOptions`), and `any` in `app/(app)/ssc/page.tsx` (typed return values `ExamRow` / `ExamOverview` in `services/ssc.ts`). Runtime behaviour unchanged; `tsconfig` untouched. Note: earlier stub-based runs filtered TS7006/TS7031 as "stub noise"; these were real. Stubbed `tsc` is now run without that filter for the touched files.
3. **ESLint directives**: three malformed `// eslint-disable-line rule (explanation)` comments (explanation parsed as part of the rule name). All suppressions were removed instead of repaired: `ProgressPanel` now uses a `useCallback`-stabilised `adopt` and a `sessId` dependency; `StudyFocusCard` reads the latest props through a ref so its snapshot effect depends only on the phase. A new checker (`npm run lint:hooks`, supporting evidence) flags malformed directives and missing hook dependencies; it was verified to flag the original bug.
**Re-validation status: NOT DONE.** The real `typecheck`, `lint`, `build`, SQL suites and browser gate have not been re-run (no dependencies, no PostgreSQL here). The next real GitHub run decides.

---
# PART B: EXTERNAL RUNTIME GATE (still required; none of it has been done)

Run on a machine with PostgreSQL 15+ or the Supabase CLI, Node 18+, `psql`, and registry access. Full guide: `docs/VALIDATION_KIT.md`.

| Step | Command | Must show |
| --- | --- | --- |
| B1 install | `npm install && npx playwright install chromium` | no errors; commit the new lockfile |
| B2 fresh scratch DB | Supabase: `supabase start && supabase db reset`; plain: `createdb cgl_validation_scratch` | empty public schema |
| B3 migrations | `node scripts/validate_phase7.mjs --db-url <url> [--shim-auth] [--force-i-understand-this-may-destroy-data]` | 001..014 each PASS with elapsed times; any failure names the migration and keeps the SQL error |
| B4 SQL suites | (same run) | Phase 4 317/317, Phase 6 all, Phase 7 all, Security all passed, 0 failed, fixtures rolled back |
| B5 app checks | (same run) with deps installed | `npm run typecheck`, `lint`, `build` exit 0, no compiler setting weakened |
| B6 real browser | set `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` before build, `E2E_EMAIL/E2E_PASSWORD`, seed data (see guide) | 11 routes x 5 viewports with no console/page errors, failed requests, overflow or hydration failures; flows pass |
| B7 accessibility | `axe-core` installed | no serious/critical axe violations; keyboard, dialog, radio, label checks pass |
| B8 performance | EXPLAIN (ANALYZE, BUFFERS) the P1 items in `docs/PHASE7_STATIC_AUDIT.md` | decisions recorded, no unmeasured optimisation |

Acceptance rule: **READY FOR PHASE 8 only if the kit prints it**, i.e. every mandatory stage actually PASSED. A failing SQL check is fixed in the migration/function (not the test), the affected suite is re-run, then ALL suites, and 014 is regenerated if a signature changed (`node database/security/build_privileges.js`).

## Final gate decision (as of this commit): **NOT READY FOR PHASE 8**
Blockers: (1) no PostgreSQL: migrations and all four SQL suites unexecuted; (2) no dependencies: typecheck, lint, build unexecuted; (3) no real-route browser or accessibility run. Nothing else is known to be failing.
