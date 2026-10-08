# Phase 7 runtime gate in CI

**Status: the kit this workflow runs was executed end to end on 2026-10-08 against the same images (READY FOR PHASE 8, see docs/PHASE7_RUNTIME_VALIDATION.md); the workflow file itself has not run on a GitHub runner yet.** Earlier status: The workflow and Docker fallback were validated statically and through unit tests of their scripts (`npm run test:kit`). No GitHub runner has run them yet. Until a real run is green, the project stays **NOT READY FOR PHASE 8**.

`.github/workflows/phase7-runtime-gate.yml` provisions a clean environment and runs the repository's validation kit (`scripts/validate_phase7.mjs`) against a real PostgreSQL. The workflow contains **no gate logic of its own**: provisioning only, then one command.

## What it provisions (all disposable, per run)
| Piece | How |
|---|---|
| Runner | `ubuntu-24.04`, 60 min timeout, Node 22, `psql` (preinstalled; installed from apt if missing) |
| PostgreSQL | **service container `postgres:15`** on `127.0.0.1:5432`, health-checked with `pg_isready`. Password `ci_pg_<run_id>_<attempt>` (throwaway; masked in logs and scrubbed from artifacts) |
| Scratch database | `cgl_validation_scratch`, created by `scripts/ci/prepare_database.mjs` (refuses non-scratch names). `database/tests/ci/00_ci_prepare.sql` creates roles `anon/authenticated/service_role/authenticator/supabase_auth_admin`, schema `auth`, Supabase-like default privileges and a PostgREST reload event trigger (in schema `ci_support`, never `public`) |
| Auth + API for the browser | `supabase/gotrue:v2.158.1` and `postgrest/postgrest:v12.2.3` started with `docker run --network host` against the scratch DB, plus `scripts/ci/api_gateway.mjs` (a ~40-line stand-in for Supabase's Kong: `/auth/v1` -> GoTrue, `/rest/v1` -> PostgREST, CORS) on `127.0.0.1:54321`. `database/tests/ci/01_ci_auth_compat.sql` makes `auth.uid()` read both JWT GUC styles (PostgREST 12 sets only `request.jwt.claims`) |
| Dependencies | `npm ci` if `package-lock.json` exists, otherwise `npm install` (see "Lockfile") then `npx playwright install --with-deps chromium` (Playwright version from `package.json`) |
| Ephemeral configuration | `scripts/ci/make_env.mjs --github`: random JWT secret, anon/service keys signed with it, role passwords and a CI-only E2E user (`ci-e2e-<run_id>@example.test`). Every secret is masked with `::add-mask::` and written to `$GITHUB_ENV`, never printed |

Plain `psql` + the repository's `database/tests/bootstrap/plain_postgres_shim.sql` are used by the kit through `--shim-auth`: when the target already provides `auth.uid()`/`auth.users` (as it does once GoTrue has migrated) the kit skips the shim; if it did not, the kit applies it. Nothing in the migrations, RLS or tests is bypassed.

## The exact command
```
npm run --silent validate:phase7 -- --db-url "$DATABASE_URL" --shim-auth 2>&1 | tee reports/ci/gate-output.txt     # with `set -o pipefail`
```
(`--silent` only suppresses npm's banner, which would otherwise echo the URL.) The kit's optional seed hook is selected through `VALIDATE_E2E_SEED_SCRIPT=scripts/ci/seed_e2e.mjs` (exported by `make_env`), so the command itself is unchanged.

## What the kit then does (single source of truth: `docs/VALIDATION_KIT.md`)
environment -> dependencies -> migration order -> preflight/scratch safety -> migrations 001-014 -> Phase 4, 6, 7 and security SQL suites -> **7c CI seed** -> real `typecheck` -> `lint` -> production `build` -> `next start` -> **`npm run e2e:real`** (11 routes x 360/390/412/1024/1440 px, flows, accessibility, axe) -> report.

### CI seed (stage 7c, CI-only)
`scripts/ci/seed_e2e.mjs` runs after the SQL suites (so it cannot influence them): it signs the CI user up through the real auth API (email confirmation disabled in the CI GoTrue), then applies `database/tests/ci/e2e_seed.sql` to the scratch database only. Every row is labelled `CI Fixture ...`, uses ids `c1000000-...`, and none of it is a migration or production content. It provides published NCERT + SSC curriculum with mappings and subtopics, 12 PYQs, and learner state created through the REAL RPCs (`set_progress`, `review_revision`): an overdue revision, one due today, one upcoming with a review history, and an in-progress topic. That covers dashboard, syllabus, NCERT, SSC, mapping, Study Mode, revision queue + review + history, PYQ practice and search.

## Required secrets
**No repository secrets.** Everything is generated per run. Forks and pull requests run it unchanged. Never add production Supabase credentials: the kit refuses hosted databases and non-scratch names.

## What makes the job green: READY FOR PHASE 8
The workflow succeeds only if the kit exits 0 **and** the last line of its output is exactly `READY FOR PHASE 8` (an extra `Assert the final verdict line` step re-checks it). That requires every mandatory stage to have actually **PASSED**: environment, dependencies, migration ordering, database preflight, migrations 001-014, Phase 4 SQL, Phase 6 SQL, Phase 7 SQL, security regression SQL, the CI seed, real typecheck, lint, production build, real-browser validation and real accessibility. Any `FAIL`, `BLOCKED` or `NOT RUN` in a mandatory stage keeps it red; there is no `continue-on-error` anywhere.

## Artifacts (uploaded on every run, including failures)
Artifact `phase7-runtime-gate-<run_id>-<attempt>` (14 days), after `scripts/ci/scrub.mjs` has replaced every known ephemeral secret in text files. Download from the run page (Actions -> the run -> Artifacts) or `gh run download <run_id> -n phase7-runtime-gate-<run_id>-<attempt>`.
| Path | Content |
|---|---|
| `reports/phase7/<timestamp>/report.md`, `report.json` (+ `reports/phase7/latest.md`) | the validation report with PASS / FAIL / BLOCKED / NOT RUN per stage and per migration. Also shown in the job summary |
| `.../logs/migration_001.log ... migration_014.log` | each migration's psql output and exit code |
| `.../logs/suite_phase4.log`, `suite_phase6.log`, `suite_phase7.log`, `suite_security.log` | full SQL suite output (first failing check is also in the report) |
| `.../logs/typecheck.log`, `lint.log`, `build.log`, `next_start.log`, `e2e.log`, `e2e_seed.log`, `node_tests.log` | application logs |
| `.../e2e-artifacts/` | `browser-console.log` (console/page errors, failed requests, HTTP >= 400), `*.png` screenshots and `*.trace.zip` Playwright traces for every failing route or flow, `axe_*.json` violations |
| `reports/ci/` | `gate-output.txt` (full console), `gateway.log`, `gotrue.log`, `postgrest.log` |
| `package-lock.json` | the lockfile, if the run had to create one |

Environmental failures are never turned into PASS: a missing prerequisite is `BLOCKED` (and keeps the job red), a skipped stage is `NOT RUN`.

## Security notes
No secret is committed. `PG_PASSWORD` and the generated values are masked in logs and scrubbed from text artifacts. Playwright traces of the flows can contain the CI user's throwaway password and the throwaway anon key; both die with the job's stack. The login context itself is not traced.

## Lockfile
`package-lock.json` is committed (generated 2026-10-08), so the workflow uses `npm ci`.

## Local fallback (Docker, secondary)
```
docker compose -f docker/validation/docker-compose.yml up --build --abort-on-container-exit --exit-code-from validate
```
Starts `postgres:15`, a `prepare` job (the same SQL as CI), GoTrue, PostgREST and a `validate` container (Playwright base image + psql) that runs the same kit command. Reports appear in `./reports/phase7/` on the host. All credentials in the compose file are fixed throwaway local values (override with `VALIDATION_*` variables). Not required by the CI workflow.

## What is verified here, and what is not
Verified in this repository (Node, no network): YAML syntax of the workflow and compose file; every referenced script/SQL file exists; every `npm run` target exists; every `$VAR` the steps use is produced by `make_env` or the job env; the database URL reaches every `psql` call of the kit; failure exit codes; `pipefail`+`tee` semantics; artifact paths vs what the kit writes; the gateway, env generator, wait/scrub/prepare/seed scripts; static validity of the seed SQL against the migration schema (`npm run test:kit`).
**Not verified (needs a real runner):** the workflow actually running; the pinned GoTrue/PostgREST images starting against a plain PostgreSQL service; GoTrue's migrations coexisting with the plain-Postgres setup; the seed SQL executing; and everything the kit validates at runtime. If one of the pinned image tags is unavailable or an image needs different environment variables, the corresponding step fails visibly and the gate stays red.
