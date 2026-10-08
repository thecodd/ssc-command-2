# Phase 7 runtime validation

Status words: **PASS** = executed and succeeded. **FAIL** = executed and failed. **BLOCKED** = could not be executed (exact blocker given). **NOT RUN** = skipped because a prerequisite did not pass. BLOCKED/NOT RUN are never reported as PASS.
Two areas below are kept strictly apart: PART A is what was executed in this sandbox; PART B is what must still be executed on a real environment. Nothing in A answers B.

---
# LATEST: full runtime run, 2026-10-08 (report `reports/phase7/2026-10-08T08-33-23-123Z`): **READY FOR PHASE 8**
Executed in a cloud sandbox that reproduces the CI workflow step for step: `postgres:15`, `supabase/gotrue:v2.158.1`, `postgrest/postgrest:v12.2.3` (Docker, host network), `scripts/ci/prepare_database.mjs`, `01_ci_auth_compat.sql`, `scripts/ci/api_gateway.mjs`, `npm install`, then `npm run --silent validate:phase7 -- --db-url "$DATABASE_URL" --shim-auth`. Not a GitHub Actions run.
Only local difference: Chromium 141 is preinstalled and its CDN is unreachable, so Playwright was installed at 1.56.1 (`--no-save`) to match it.

Every mandatory stage PASS: migrations 001-014; Phase 4 SQL 334/334; Phase 6 SQL 73/73; Phase 7 SQL 53/53; security SQL 56/56; CI seed; typecheck; lint; build; real browser 137/137 (19 routes x 5 viewports + review/stale-tab/study/practice flows); accessibility 57/57. Supporting S6 (fixture smoke) is BLOCKED (needs global react/esbuild) and is not part of the verdict.

Defects the first executions found and fixed before this verdict:
- **Stale revision submit hung forever** (stale-tab flow): `review_revision` raised SQLSTATE `40001`; PostgREST retries serialization failures, so the call was re-run endlessly and the second tab stayed on "Saving...". The guard now raises `PT409` (HTTP 409, mapped to `conflict`). New Phase 7 check asserts PT409 and never 40001/40P01.
- **Form fields unstyled on server pages** (axe colour-contrast on /settings, /tasks/new, /notes/new, /resources/new): `fieldCls` was exported from a `"use client"` module, so server components received a client reference and rendered `class="[object Object]"`. Moved to `components/ui/field.ts`.
- **Kit left `next-server` running** after stage 11 (it killed only `npm`), so the next run tested a stale build. The server now runs in its own process group, the whole group is stopped, and stage 11 refuses to start when the port is already taken.
- **Harness false positive**: Chromium intermittently reports Next.js server-action fetches as `net::ERR_ABORTED` even though the app read the whole body. The harness now proves delivery in the page (`ACTION_BODY_PROBE`) and tolerates the abort only with that proof.
- **Practice flow race in the harness**: it sampled the loading skeleton right after "Next question"; it now waits for the next question or the summary.
- Next.js 14.2.15 -> 14.2.35 (npm security advisory on 14.2.15). `package-lock.json` added.

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
# PRODUCT COMPLETION PASS (after run #6; NOT yet validated on a runner)
Audit of the current tree found the catch-all route serving "isn't built yet" placeholders for navigation targets: `/pyqs`, `/notes`, `/resources`, `/analytics`, `/settings`, `/tasks`, `/tasks/new`, `/notes/new`, `/resources/new`, `/pyqs/new`, and `/search`; there was also no way to sign out. Implemented with real services and validated server actions (owner-scoped writes, our own error copy):
- Tasks: list (open / recently completed), create with due date, priority and an optional link to a chapter or topic, complete or reopen, delete with confirmation. Due-today tasks already feed daily focus.
- Notes: searchable list, create (notes always belong to a chapter or topic, per the schema), edit, delete.
- Resources: official (read-only) and personal, create with an optional link, delete own.
- PYQ bank: practisable question counts per SSC topic (from `subject_pyq_counts`, which excludes archived and keyless questions), the learner's attempts and recent accuracy, and mixed, weak and per-topic practice entry points.
- Analytics: 14-day study time (in the learner's time zone), PYQ accuracy (database counts), mastery distribution, last-30-day review ratings, weakest topics by accuracy, streak. All from real rows; empty state when there is no data.
- Search page (`/search?q=`) on the same ranked `global_search` RPC, grouped, with Study shortcuts.
- Settings: display name, daily goal, time zone, revision ladder (validated; the database guard re-validates), and sign out (also on More).
- The catch-all is now a real 404 page. `/pyqs/new` (custom PYQ authoring) was removed from quick-add: it was never implemented, and a custom question needs answer-key handling that is out of scope for this pass.
- The real-browser gate now also covers `/pyqs`, `/tasks`, `/tasks/new`, `/notes`, `/notes/new`, `/resources`, `/resources/new`, `/analytics`, `/settings`, `/more` and `/search?q=` at all 5 viewports.
Not verified here: none of these screens has been rendered against a real database or built with the real Next/TypeScript toolchain (no registry access, no PostgreSQL); the next GitHub run is the first real check.

---
# SIXTH REAL CI RUN (commit ed2d45e): remaining failures, diagnosis and fixes (NOT yet re-validated on a runner)
Run #6 (reported by the maintainer): everything PASSED (SQL 334/73/52/56, seed/auth/CORS, typecheck, lint, build, accessibility 37/37, S9 47/47) except the real browser, 62/77.

| # | Failure | Root cause | Fix | Evidence |
|---|---|---|---|---|
| 4-11 | 256px horizontal overflow on every desktop route at 1024px | `AppShell`: `<main className="mx-auto w-full max-w-5xl ... lg:ml-64">` = 100% width PLUS a 256px margin. | `<main>` now sits in a full-width wrapper with `lg:pl-64` (reserves the fixed 16rem sidebar); `<main>` keeps `mx-auto w-full max-w-5xl` and is centred in the remaining width. Mobile unchanged; no `overflow-x-hidden`. | Real-Chromium regression (exact shell markup, hand-written equivalents of the utilities): the pre-fix markup reproduces 256px at 1024; the fix has 0 overflow at 360/768/1024/1280/1440, sidebar 256px, main centred in the remaining width. |
| 1-3 | `/syllabus` overflow 66/36/14px at 360/390/412 | All three put the document at the same width, about 426px: one element with a fixed minimum. A one-column CSS grid track is `minmax(auto, 1fr)`; its minimum is the card's min-content width, and an `ItemCard`'s min-content includes its single-line `truncate` meta text (nowrap), so the track grew wider than the screen. | Grid tracks `minmax(0,1fr)` (1 column) / `repeat(2,minmax(0,1fr))` (md+) and `min-w-0` on the card, so the meta line truncates with an ellipsis as designed. No clipping, no `overflow-x-hidden`. | Real-Chromium regression with a long meta line: the pre-fix grid overflows; the fix has 0 overflow at 360/390/412, card and badge inside the viewport, meta truncated. |
| 14 | stale-tab flow: "stale submit not reported: " (empty) | Harness. Next 14 renders `<next-route-announcer>` (end of body) with an EMPTY, 1px visually-hidden `role="alert"` in a shadow root. After tab B clicked Save, `getByRole("alert").first().waitFor()` resolved immediately to that announcer (the only alert so far) and read `''` before the server's rejection rendered the real alert. The app itself was not wrong. | `waitForAlertText()` waits for the alert that actually contains the stale message. | Real-Chromium regression reproduces both: the old pattern reads `''`, the new helper returns "This revision was already updated elsewhere.". |
| 15 | practice flow: `waitFor` timeout | Product accessibility defect. The feedback was `<h2 role="status">`; an explicit role REPLACES the heading role, so it was not a heading for assistive technology, and the harness (which waits for the "Correct/Incorrect" heading) timed out. | The feedback is a real `<h2>` again, inside its labelled section, plus one persistent `role="status"` region that announces Correct/Incorrect. Grading is unchanged (server-side). | Real-Chromium regression: the old markup has 0 headings named Correct, the new markup 1 heading and 1 status region. |
| 12-13 | study detail / practice detail @1024: server-action POST `net::ERR_ABORTED` "without a navigation or close" | **NOT DETERMINED.** Next 14 sends server actions with a plain `fetch` (no abort controller); Chromium cancels a fetch on a cross-document navigation, a frame detach or an explicit abort, not on a History-API (same-document) navigation. No artifact from run #6 was available here. Overflow is excluded as the cause for these two: both are (focus)-layout pages without the app shell. | The classification is unchanged. These remain FAILURES if they recur; nothing was relaxed. The harness now writes a full lifecycle log (`e2e-artifacts/server-actions.log`): every server action's start/end/failure time, the `Next-Action` id, every main-frame navigation including same-document ones, the closing flag and the page URL. Same-document navigations are recorded as evidence only and never excuse an abort (a regression test enforces that). | Next run: the log will show the exact sequence if it recurs. |

---
# FOURTH REAL CI RUN (commit 44c8193): remaining failures, diagnosis and fixes (NOT yet re-validated on a runner)
Run #4 (reported by the maintainer): migrations, Phase 4 334/334, Phase 6 73/73, Phase 7 52/52, Security 56/56, seed/auth/CORS probe, typecheck, lint, build and the real Chromium login PASSED. Remaining: real browser 20/77, accessibility 17/37, S9 hung after "TAP version 13".

| Failure | Class | Root cause | Fix |
|---|---|---|---|
| Many route checks: `GET ...?_rsc=... net::ERR_ABORTED`, some server-action POSTs aborted | Harness | Next.js prefetches RSC payloads for every visible `<Link>` and cancels them when the page navigates or the context closes; the harness counted every failed request as a defect, including those caused by its own teardown. | `tests/e2e/network_filter.mjs` classifies each failure: ONLY a same-origin GET with `_rsc` that fails with exactly `net::ERR_ABORTED` is expected, plus a same-origin server action (`Next-Action` header) aborted by a main-frame navigation that started after it, or by the harness closing the page. Everything else stays a FAIL: other ERR_ABORTED, any non-abort network error (incl. the run #3 CORS `ERR_FAILED`), cross-origin failures, plain POSTs. HTTP 4xx/5xx are responses, never classified here, and still fail. Ignored requests are written to `browser-console.log` as `ignored (expected)`. Unit-tested. |
| Revision and practice flows: `radio.check()` times out, "label intercepts pointer events" | Harness | The radios are visually hidden inputs inside a `<label>` card (correct, accessible markup). Playwright refuses to click a covered input. | `tests/e2e/interactions.mjs pickRadio()` clicks the visible label card (what a user does), then REQUIRES the radio to be checked. No `force`, no markup change. Used in the review, stale-tab and practice flows. A real-Chromium test reproduces the `check()` failure with the same CSS and proves `pickRadio` selects. |
| axe: serious `color-contrast` on metadata/nav text and violet badges | Design tokens (real defect) | `mute #71717A` measured 3.67-4.12:1 on our surfaces and `#8B5CF6` as text 4.08-4.70:1 (AA needs 4.5:1 for small text). | Central tokens: `mute` -> `#9898A1` (>= 4.55:1 on bg, surface, raised, the lime-dim and violet/10 tints and the translucent nav), new `violet-fg #A78BFA` for TEXT (>= 4.78:1); `violet #8B5CF6` stays for borders, tints and icons, lime unchanged, focus outline unchanged. All 8 `text-violet` uses now `text-violet-fg` (Badge included). A test computes every token against every background and forbids raw violet text and legacy greys. |
| S9: only "TAP version 13", then hung until the stage timeout | Self-test isolation | The kit self-tests start nested kit runs. In CI they inherited the gate's environment (DATABASE_URL, NEXT_PUBLIC_*, E2E_*, VALIDATE_E2E_SEED_SCRIPT) and real `node_modules`, so each nested run executed the real seed hook, `typecheck`, `lint` and `build` (minutes each, about 8 times) and could start `next start`; node:test prints results only when files finish. Reproduced here with fake dependency packages: a nested run without isolation ran typecheck/lint/build. Also: keep-alive sockets could keep test servers open. | Nested runs use `--skip-app` (seed and app stages become NOT RUN, so such a run can never be READY) and a hermetic environment without gate variables; test HTTP servers drop keep-alive sockets on close; `--test-timeout`; a run with an explicit `--out` never overwrites `reports/phase7/latest.md`; fixed an ordering bug (`SKIP_APP` used before its declaration). The exact S9 command under CI-like conditions (fake deps + gate env) now finishes in ~22 s with 47/47. |

---
# THIRD REAL CI RUN (commit eed1712): remaining failures, diagnosis and fixes (NOT yet re-validated on a runner)
Run #3 (reported by the maintainer): migrations 001-014, Phase 6 73/73, Phase 7 52/52, Security 56/56, typecheck, lint, build and the E2E seed/auth probe PASSED. Remaining: Phase 4 6 failures, real-browser login.

| Former failure | Class | Root cause | Fix |
|---|---|---|---|
| #102 midnight session credits 1800 s; #103 streak 3 -> 5 | B (implementation correct) | The scenario sent ONE heartbeat 29.5 min after the start. `study_heartbeat()` first runs `_recover_stale()`: an active session silent for more than `lc_stale_seconds` (600 s) is closed as ABANDONED with credit up to its last sign of life + `lc_stale_credit_seconds` (90 s). So the heartbeat closed it (90 s, start day only); then no active session remained, `study_finish(NULL)` raised, and the streak moved only 3 -> 4. This is the intended stale rule (the app heartbeats far more often than every 10 min), so production SQL is unchanged. | The scenario now heartbeats like a real client (every 9 min); the expectations are unchanged (1800 s, 3 -> 5). Added focused regression checks: the session is still active before finishing, it started on local Oct 3 and ended on local Oct 4, and the 29.5-min-silence case at midnight is closed as abandoned with exactly 90 s and touches only its start day. Each check prints session/clock values in its failure detail. |
| #141 custom ladder new schedule due +2 | B (not a same-statement case) | T2 already had an open revision since 007 (completed there); re-completing an item that already has an open revision never reschedules (by design, so studying cannot reset a ladder). The "new schedule" therefore never existed. | The assertion now runs on ST2, whose first completion seeds a new schedule (precondition check: no prior revision), plus a check that re-completing T2 kept exactly its one open revision. Expected value unchanged (+2). |
| #145, #160, #191 | B | Action and verification in ONE statement (a SELECT cannot see rows written by a function it calls). | Split: action in its own statement (result kept in `t_ret`), verification in the next. Assertions unchanged. |
| Real browser login: `ERR_FAILED`, blocked by CORS | C | `scripts/ci/api_gateway.mjs` forwarded GoTrue's own `access-control-allow-origin` (lowercase) and added its own `Access-Control-Allow-Origin`; Node sent both, and Chromium rejects "multiple values". curl/Node fetch don't enforce CORS, so the probe passed. **Reproduced in real Chromium here** with a fake GoTrue: the old gateway was blocked with exactly that message. | The gateway now drops every upstream `access-control-*` header, emits one canonical set, merges `Vary` to keep `Origin` (and upstream values), and preserves status/body/other headers (incl. multiple Set-Cookie). Verified in real Chromium (blocked before, accepted after). Two regression tests: raw-header assertions, and the real-Chromium check (also run in CI as supporting stage S9). Production app auth unchanged. |

---
# SECOND REAL CI RUN: diagnosis and fixes (fixes NOT yet re-validated on a runner)
Reported by the maintainer; this sandbox still has no PostgreSQL and no GitHub access, so every root cause below was established by reading the SQL and PostgreSQL's documented behaviour, and is **not yet confirmed by a green run**. Each fix also adds either a permanent regression check or permanent diagnostics, so the next run either passes or shows the exact error text (`logs/suite_*.errors.log`, `logs/diagnostics.log`, `e2e-artifacts/auth-diagnostics.json`).
Classification: A = production/database defect, B = SQL test/harness defect, C = CI/Supabase compatibility defect.

| # | Failure | Class | Root cause | Fix |
|---|---|---|---|---|
| 1 | Phase 4: `cannot ALTER TABLE "chapters" because it has pending trigger events` | B | `chapters_entity_fk` is DEFERRABLE INITIALLY DEFERRED; the fixtures queued deferred events, and PostgreSQL refuses ALTER TABLE while any are pending. The database design is fine (it is the intended behaviour). | `06_registry.sql`: `set constraints all immediate` (settles and validates every queued reference) before `ALTER TABLE ... DISABLE TRIGGER`, the integrity assertion runs unchanged, then `set constraints all deferred`. |
| 2 | Phase 6 #1-#3 and Security #10, #11: "B cannot read A question", "question outside the session", "anonymous cannot call practice RPCs" | B | `rows_as()` wrapped statements as `select count(*) from (<stmt>) q`. `practice_question` is `STABLE`; PostgreSQL does not evaluate an unreferenced STABLE function in a subquery, so it neither raised nor even performed the EXECUTE-privilege check, and the helper returned 1 instead of -1. Volatile functions were evaluated, which is why other RPC checks passed. The production function is correct. | `00_harness.sql`: `rows_as` now consumes every output column (`count(t)` over `q::text`), so STABLE functions are really executed. Regression test encodes the rule. |
| 3 | Phase 7 #21-#26 (Good/Hard/second Hard/Easy graduation/re-schedule/B custom ladder) | B | These checks did `rows_as(<review>) >= 0 and (select <state the review wrote>)` in ONE statement. A SELECT cannot see rows written by a volatile function called inside the same statement, so it read the old row. The pure `revision_next` checks passed because they have no such pattern. | Each action now runs in its own statement (`insert into t_ret select ..., rows_as(...)`) and the resulting state is verified in the next statement. A static test fails any suite that reintroduces the pattern. |
| 4 | Phase 7 #20: custom ladder first revision expected +2 days | B | Wrong expectation. By design (008) `schedule_revision()` is "revise now": it opens/pulls a revision to TODAY (interval_days = ladder[1]); only COMPLETING an item seeds `today + ladder[1]`. | The test now completes the item (seeded +2 on ladder 2,5,20) and separately asserts what `schedule_revision` does (due today, step 0, `manual`). Ladder semantics unchanged. |
| 5 | Security #8: "no client RPC accepts a time ... argument" | B (+ documented exception) | Confirmed: the check read `pg_proc.proargnames`, which also contains TABLE/OUT result-column names, and also flagged `submit_pyq_answer(p_time_seconds)`. | Inspects INPUT arguments only (`proargmodes` i/b/v). `p_time_seconds` stays client-supplied BY DESIGN (009): informational telemetry stored in `time_taken_seconds`, clamped to [0, 7200] and to the session's elapsed time + 5 s, never used for grading, accuracy, mastery or scheduling. A new check proves that shape (clamp present, exactly one use) so it cannot silently become authoritative. No RPC signature changed. |
| 6 | Security #9: authenticated can TRUNCATE public tables | A (and C amplifies) | Supabase's default privileges (mimicked by the CI bootstrap) grant ALL on new tables, including TRUNCATE, which RLS never covers. This is a real production exposure. | Generated `014_function_privileges.sql` now also does `revoke truncate, references, trigger on all tables in schema public from anon, authenticated` plus the matching `alter default privileges`, and asserts it. The CI bootstrap keeps its broad defaults on purpose (faithful to Supabase); least privilege is enforced by the migration. |
| 7 | Security #12: "another user's custom question is invisible" | B | `select * from pyqs` is refused for every client (column grants, by design), so the helper returned -1, not 0. | Test uses granted columns and also proves the owner sees it and `select *` stays refused. |
| 8 | Security #13: custom chapter ownership | B | The last conjunct read the chapter in the same statement that inserted it (same snapshot rule as #3) and so saw nothing. | Actions and verifications split; reassignment and takeover attempts checked in separate statements. The RLS policies themselves are unchanged. |
| 9 | Browser: `login :: page.waitForURL timeout` | not yet determined | The signup succeeded, but nothing proves the login path. Candidates: GoTrue login/confirmation, gateway/CORS, PostgREST+JWT, cookies, middleware. I could not reproduce it here. | The seed hook now probes the SAME endpoints the login page uses before any browser starts (CORS preflight, password login, GoTrue token acceptance, PostgREST through the gateway, and RLS returning exactly the user's own profile) and fails with the HTTP status and GoTrue error code (no tokens or passwords). The browser harness records the app's visible error text, the auth requests with statuses, console errors, cookie names and a screenshot (`auth-diagnostics.json`). The harness still logs in through the real form. |
| 10 | Supporting S4 and S7 `MODULE_NOT_FOUND` | C | They loaded `typescript` only from `npm root -g`; in CI it exists only in the project's `node_modules`. | Resolve the project's own `typescript` first, then `TS_PATH`, then a global install (verified on a CI-like copy with a project-local install only). |

Permanent diagnostics added: the SQL helpers record every error they swallow (`t_errors`, printed by the kit to `logs/suite_<name>.errors.log`); stage S8 runs `database/tests/diagnostics/runtime_diagnostics.sql` (overloads, volatility, SECURITY DEFINER, who can EXECUTE, `auth.uid()` as installed, table and default privileges, policies, triggers).
**Status: nothing here is confirmed by a real run. Phase 4's own remaining checks have never produced a result table, so more failures may appear once its ALTER TABLE abort is gone.**

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
