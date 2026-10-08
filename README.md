# CGL Command

## Setup
1. `npm install`, copy `.env.example` to `.env.local`, add the Supabase URL + anon key.
2. In the Supabase SQL editor run **in order**: `database/migrations/001_schema.sql`, `002_search.sql`, `003_search_v2.sql`, `004_hardening.sql`, `005_integrity_indexes.sql`, `006_entity_registry.sql`, `007_progress_sessions.sql`, `008_revision_engine.sql`, `009_pyq_practice.sql`, `010_learning_signals.sql`, `011_curriculum_publishing.sql`. **Use a scratch project first: 005-011 have never been executed.** See `docs/PHASE4_NOTES.md`.
3. Make yourself admin (SQL editor only; the API cannot change `is_admin`):
   `update profiles set is_admin = true where id = '<your-auth-uid>';`
4. `npm run dev`. Load verified curriculum at `/admin/import` (samples in `public/samples/` are placeholders).
5. Checks: `npm run typecheck && npm run lint && npm run build`.

## Security tests
`database/tests/rls_tests.sql` — paste into the SQL editor after the migrations. It runs in one transaction, ends with ROLLBACK,
and prints a PASS/FAIL table (user isolation, profile/is_admin hardening, curriculum, resources, PYQ links, search leakage, anonymous access).

## Conventions
- "Today" for any user-facing purpose comes from `services/profile.ts#getClock()` (user's `profiles.timezone`, default Asia/Kolkata). Storage is UTC.
- Streaks are computed in the database (`touch_streak()`), not by the client.
- Never put lists of ids in a query URL: use embedded `!inner` filters or RPCs (see `004_hardening.sql`). Page through big reads with `lib/paging.ts`.


## Phase 4 tests
```bash
node database/tests/reference/run_reference_tests.js   # runs anywhere: oracle + SQL-constant mirror (55 assertions)
bash database/tests/phase4/build_all.sh                # builds phase4_all.sql (substitutes fixture UUIDs, inlines vectors)
# paste phase4_all.sql into the SQL editor of a scratch project AFTER migrations 001-011; it ends with ROLLBACK.
# Every row of the final table must read PASS. Then run database/tests/rls_tests.sql the same way.
```


## Phase 5: Study Mode
- `/study/<ncert_chapter|ssc_topic|ssc_subtopic>/<uuid>` (focus layout), `/study` hub, `/revision` queue. Notes: `docs/PHASE5_NOTES.md`.
- Dev preview with fixtures: `npm run dev` then `/dev/study-preview?scenario=ssc-topic|ncert-chapter|subtopic|weak-due|empty|other-session|resume` (404 in production).
- Tests: `node tests/study/run.js` (needs `typescript` installed globally or `TS_PATH`), `node scripts_audit.js`. These do not touch Supabase.

## Phase 6A: verification gate + PYQ practice
- Apply migrations IN ORDER: 001 ... 011, 012, **013 (revision queue)**, then **014 last** (014 re-derives every EXECUTE grant and asserts the result). Re-running 009 after 012 would restore the old 3-argument `start_practice`.
- SQL suites (scratch Supabase project only): `bash database/tests/phase4/build_all.sh` then run `phase4_all.sql`; `bash database/tests/phase6/build_all.sh` then run `phase6_all.sql`. Read the final table: every row must say PASS. **Neither suite has ever been executed.**
- Regenerate privileges after adding any SQL function: add it to `database/security/function_matrix.js`, then `node database/security/build_privileges.js` (rewrites 014 and docs/SECURITY_FUNCTION_MATRIX.md). `node tests/study/run.js` fails if they drift.
- Routes: `/practice/new?scope=ssc_topic|ssc_subtopic|ssc_subject|weak|mixed&id=<uuid>` and `/practice/<sessionId>`.
- Audit write-up: `docs/PHASE6A_AUDIT.md`.

## Phase 7: Revision
- Routes: `/revision` (queue), `/revision/<scheduleId>` (review). Notes: `docs/PHASE7_NOTES.md`. Dev preview: `/dev/revision-preview`.
- SQL tests (scratch project, after 001-014): `bash database/tests/phase7/build_all.sh` then run `phase7_all.sql`. **Never executed.**
- Any new SQL function must be added to `database/security/function_matrix.js`, then `node database/security/build_privileges.js` (rewrites 014 and docs/SECURITY_FUNCTION_MATRIX.md).

## Phase 7 runtime validation kit
`node scripts/validate_phase7.mjs --db-url <scratch database url>`: environment, dependencies, migration order, preflight + scratch safety, migrations 001-014, Phase 4/6/7 + security SQL suites, typecheck, lint, build, real-browser + accessibility, report. Ends with READY / NOT READY FOR PHASE 8. Guide: `docs/VALIDATION_KIT.md`; sandbox result and the external gate: `docs/PHASE7_RUNTIME_VALIDATION.md`; static audit: `docs/PHASE7_STATIC_AUDIT.md`.

## Phase 7 CI runtime gate
`.github/workflows/phase7-runtime-gate.yml` runs the validation kit on a real PostgreSQL 15 service container in GitHub Actions (local fallback: `docker compose -f docker/validation/docker-compose.yml up --build`). See [docs/CI_PHASE7_GATE.md](docs/CI_PHASE7_GATE.md). Status: the full kit was executed on 2026-10-08 against the same Docker stack (Postgres 15, GoTrue, PostgREST) and printed **READY FOR PHASE 8**; see `docs/PHASE7_RUNTIME_VALIDATION.md`. Earlier GitHub Actions runs (#1-#8, before these fixes) ended red; the latest run is on the Actions tab.

## Product surfaces (all real, no placeholders)
Dashboard, Master Syllabus, NCERT, SSC, Mapping, Study Mode, PYQ practice, Revision, plus the workspace screens: **Tasks** (`/tasks`, `/tasks/new`), **Notes** (`/notes`, `/notes/new`, `/notes/[id]`), **Resources** (`/resources`, `/resources/new`), **PYQ bank** (`/pyqs`), **Analytics** (`/analytics`, real rows only), **Search** (`/search`, plus Ctrl/Cmd+K), **Settings** (`/settings`: name, daily goal, time zone, revision ladder, sign out), **More** (`/more`). Unknown paths are a real 404. The dashboard lists open tasks due today or overdue (complete them in place). Saved and official resource links become clickable only for absolute `http(s)` URLs and always open in a new tab with `rel=noopener`; anything else (e.g. `javascript:`) is shown as plain text.
