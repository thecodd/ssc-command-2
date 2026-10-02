# Phase 7 Runtime Validation Kit

One command validates migrations, SQL suites, the real app and the real browser, and ends with `READY FOR PHASE 8` or `NOT READY FOR PHASE 8`.
```
npm install                                   # needs registry access (adds playwright + axe-core as dev dependencies for the kit)
npx playwright install chromium
node scripts/validate_phase7.mjs --db-url postgres://USER:PASS@HOST:PORT/DBNAME [flags]      # or: npm run validate:phase7 -- --db-url ...
```
Cross-platform (Node >= 18; no bash or python needed for the gate). Output: console summary, `reports/phase7/<timestamp>/report.md|json` (+ `reports/phase7/latest.md`) and full logs in `.../logs/`.

## Stages (every one ends PASS | FAIL | BLOCKED | NOT RUN)
| # | Stage | Mandatory | Notes |
|---|---|---|---|
| 1 | Environment (node, npm, psql, supabase CLI) | yes | BLOCKED if psql is missing |
| 2 | Dependencies installed | yes | BLOCKED - dependencies unavailable (no stub is ever substituted) |
| 3 | Migration ordering: 001..014 contiguous, unique, 014 (privileges) last | yes | runs anywhere, no database needed |
| 4a | Database preflight + scratch-safety | yes | server >= 15, roles, auth schema, pg_trgm, ledger, refusal rules below |
| 4b | Migration application | yes | each file once, in order, `psql -1 -v ON_ERROR_STOP=1`; stops at the first failure and keeps the SQL error; elapsed per migration; checksum ledger |
| 5-7 | Phase 4 / 6 / 7 SQL suites | yes | run as written; counts of total / passed / failed; first failing check; fixtures must be rolled back |
| 7b | Security regression SQL suite | yes | catalog-driven privilege matrix + cross-user, forged-input and answer-key checks |
| 8-10 | `npm run typecheck`, `lint`, `build` | yes | the real commands, nothing weakened |
| 11 / 11b | Real browser + accessibility on the running app | yes | 11 routes x 5 viewports + flows; axe if installed (otherwise NOT RUN) |
| S1-S6 | Supporting: suite freshness, static SQL audit, regeneration identity of 014, Node tests, oracle, fixture smoke | no | evidence only; a FAIL still blocks readiness, a PASS never grants it |
| 12 | Report | - | writes the files above |

The verdict is READY only if every mandatory stage actually PASSED and nothing FAILED. Exit code 0 = READY, 1 otherwise.

## Scratch database safety
The kit modifies the target (applies migrations, creates `public._cgl_validation_ledger`). It refuses unless the target is recognisable scratch:
- the database already contains the kit's ledger (it created it before), **or**
- its name contains `scratch`, `test`, `validat`, `tmp`, `temp` or `ci`, the host is local (or `--allow-remote`), and the public schema is empty (or `--reset`).
- Hosted databases (`*.supabase.co`, pooler hosts, neon, rds, ...) are refused outright; the only override is `--force-i-understand-this-may-destroy-data`, meant for a throw-away project.
- `--reset` drops and recreates schema `public` (re-granting Supabase-style default privileges). For a Supabase-faithful clean slate prefer `supabase db reset`.
- Plain PostgreSQL (not Supabase): add `--shim-auth` to apply `database/tests/bootstrap/plain_postgres_shim.sql` (roles anon/authenticated/service_role, `auth.users`, `auth.uid()`, default privileges). Never use it against Supabase.

### Recommended setups
A. Local Supabase (`supabase start`, database `postgres`): `supabase db reset` first, then `--db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres --force-i-understand-this-may-destroy-data` (local and disposable; the name check cannot know that).
B. Plain Postgres 15+: `createdb cgl_validation_scratch` then `--db-url postgres://postgres:pw@127.0.0.1:5432/cgl_validation_scratch --shim-auth`.
The connecting role must be able to insert into `auth.users` and `SET ROLE anon/authenticated` (the `postgres` role in both setups).

## How the SQL harness creates its users and fixtures (reused, nothing added to the app)
`database/tests/phase4/00_harness.sql` starts `begin;`, creates temp tables `t_results`/`t_runs` and helper functions (`rows_as`, `val_as`, `owner_try`, `check_`, `set_now`), then inserts six users straight into `auth.users` (the `on_auth_user_created` trigger creates their profiles; user C is promoted to admin through the table-owner path) and a curriculum fixture set (every title starts with `TEST`, every user email ends `@test.local`) as the table owner. Tests run "as a user" with `SET LOCAL ROLE authenticated|anon` plus the `request.jwt.claim*` settings PostgREST uses; time is pinned through `app.allow_test_clock` / `app.test_now`. Every suite ends in `ROLLBACK`, so nothing persists; the kit verifies that no `TEST` rows or `@test.local` users remain before and after each suite. Suites are generated from sources with `node scripts/validate/sqlbuild.mjs` (byte-identical to the older `build_all.sh` scripts; `--check` verifies the committed files).

## Real-browser stage (11 / 11b): prerequisites
1. A scratch Supabase project/stack with migrations 001-014 applied (stage 4b) and `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` pointing at it, set **before** `npm run build` (Next inlines them).
2. A scratch user: `E2E_EMAIL` / `E2E_PASSWORD` (sign up through `/login`). The harness logs in through the real form.
3. Seed data for that user so dynamic routes exist: publish some curriculum (use the admin import with the files in `public/samples`), complete one topic (this creates its first revision), make it due (set `revision_schedule.due_date` to today in the SQL editor), and tag some PYQs to a topic. Without data those routes are reported BLOCKED, never PASS.
4. The kit starts `next start` itself (or pass `--base-url` for a running server).
Coverage: `/dashboard /study /revision /revision/[id] /study/[type]/[id] /practice/new /practice/[sessionId] /syllabus /ncert /ssc /mapping /search` x 360/390/412/1024/1440 px, capturing console errors, hydration warnings, page errors, failed requests, HTTP >= 400, horizontal overflow, clipped fixed elements, redirects to /login, and (at 390) every same-origin link. Flows: revision review (recall, reveal, rate, result, next), stale second tab, study start/pause/resume/finish with revision independence, practice answer/grade/summary. Accessibility: radio semantics, arrow keys, disabled states, dialog focus and Escape, form-control names, visible focus on Tab, and axe (WCAG 2 A/AA, contrast included) when `axe-core` is installed, else NOT RUN. `/search` has no dedicated page (the command palette is the search UI); the harness records that.

## Kit self-tests and other commands
- `npm run test:kit` - 13 tests of the kit's own logic against a fake `psql` (safety refusals, ledger, stop-on-first-failure, result parsing, exit-code mapping, verdict). They prove nothing about PostgreSQL.
- `npm run validate:sql-check` / `validate:sql-build`, `npm run validate:static-sql`, `npm run e2e:real`, `npm run test:fixture-smoke`.
- Fixture smoke (`tests/browser`) and the Node tests are a separate category: supporting evidence, never "real browser validation".

## SQL test harness rules (learned from the first real runs)
1. A SELECT cannot see rows written by a VOLATILE function called in the SAME statement. Run the action in its own statement (`insert into t_ret select 'k', rows_as(...)`) and check the state in the next one. A Node test fails any suite that reintroduces `rows_as(<write>) >= 0 and (select <that write>)`.
2. `rows_as` consumes every output column, otherwise PostgreSQL never evaluates an unreferenced STABLE/IMMUTABLE function (no error, no privilege check).
3. Every error the helpers swallow is recorded in `t_errors`; the kit writes it to `logs/suite_<name>.errors.log` (most entries are expected negative tests). Stage S8 writes `logs/diagnostics.log` (read-only catalog facts).
