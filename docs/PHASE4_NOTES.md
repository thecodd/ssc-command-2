# Phase 4 notes: learning-data engine (migrations 005-011)

**Status: written, NOT executed.** No SQL in this phase has run (no Postgres in the build environment; `npm install` also returned 403, so there is no real typecheck, lint or build).
What *did* run: a TypeScript syntax parse, a stubbed `tsc`, and a Node test that holds a reference oracle to the SQL constants (`node database/tests/reference/run_reference_tests.js`).

## Migration order and dependencies
Run in order on a scratch Supabase project first: `001 -> 011`. Every file is written to be re-runnable.

| # | Adds | Depends on |
|---|------|-----------|
| 005 | `app_now()` test clock, `user_today()`, `lc_*` constants, natural-key uniques (with duplicate pre-check), indexes, owner FKs -> CASCADE, official-delete guard, archived columns | 001-004 |
| 006 | `entities` registry + composite FKs on every user reference, quarantine table, `entities_integrity_report()` | 005 |
| 007 | `set_progress`, server-clock study sessions (`study_*` RPCs), streak helper, progress/session lockdown | 005, 006 |
| 008 | Revision ladder in SQL: `schedule_revision`, `review_revision`, append-only `revision_reviews`, seeding trigger | 007 |
| 009 | `exam_papers`, `pyq_subtopics`, practice sessions, `submit_pyq_answer`, `finish_practice` | 007, 008; **`finish_practice` calls `user_entity_signals` from 010 at run time** (PL/pgSQL resolves it late, so 009 installs without 010, but practice completion fails until 010 exists) |
| 010 | `learning_mastery`, `learning_weak_reason`, `user_entity_signals`, `daily_focus`, `dashboard_summary` | 005-009 |
| 011 | publishing lifecycle, trust-flag guards, visibility RLS, import staging; **redefines** `active_entities` and `entity_accessible` | 005-010 |

## Deviations from the Phase 3 plan (deliberate)
1. **SQL is authoritative** for mastery, weakness, revision scheduling and daily focus. TypeScript keeps presentation (labels/tones/next-action copy) and a Node *test oracle* only. `lib/learning/config.ts` mirrors the SQL `lc_*` constants and a test fails on drift.
2. **Revision scheduling runs inside `review_revision`** (Phase 4 instruction), not in TS as Phase 3 suggested.
3. **No seconds on reviews** (no duration is recorded for a review).
4. **Old importer replaced** by staging tables + validate/apply RPCs; nothing writes curriculum except `import_apply_run`, and only as DRAFT.
5. Client writes to `user_progress`, `study_sessions`, `revision_*`, `pyq_attempts` are **revoked**; everything goes through RPCs.

## Legacy data strategy (all non-destructive)
- Statuses `strong`/`revision` are normalised (strong -> completed + confidence 5; revision -> completed/learning). "Strong" is now *derived*, never stored.
- Surplus pending revisions are **copied** to `revision_schedule_legacy` before removal; rated legacy reviews are copied to `revision_reviews` (`source = 'legacy'`).
- Legacy PYQ columns (`exam`, `year`, `tier`, `difficulty`) are kept; papers are back-filled from them. Drop them in a later cleanup once production data is verified.
- Existing books/exams become `published` so nothing disappears for current users.
- Pre-checks **abort with a clear message** rather than guess when duplicates block a unique index.

## Known risks (read before running)
1. **All SQL is unexecuted.** Expect to fix some syntax/semantic slips, most likely in the CTE-heavy functions (`user_entity_signals`, `daily_focus`, `dashboard_summary`) and `import_validate_run` / `import_apply_run`. The 317-check suite is designed to find them: `bash database/tests/phase4/build_all.sh`, then run `phase4_all.sql`.
2. **Answer keys are readable** by signed-in clients (a user could peek at `correct_answer`). Accuracy cannot be forged (the server computes `is_correct`), but it can be gamed by reading the key. Fixing it needs a column-level split; deferred.
3. Concurrency (double tap, two tabs) is protected by advisory locks, unique partial indexes and `expected_step`, but **cannot be tested in a single-transaction script**. Test manually with two sessions.
4. `global_search` still lists archived chapters (search was not changed in this phase).
5. `fetchAll` paging covers the 1000-row API limit for progress maps; RPC results (`user_entity_signals`) are *not* paged. Fine at today's scale (~thousands of rows), revisit if the syllabus grows an order of magnitude.
6. Supabase embedded-filter behaviour and RPC argument coercion (`entity_t` enum from text) are unverified against a live PostgREST.
7. Direct SQL-editor / service-role writes bypass publish and trust-flag guards on purpose (break-glass); use the RPCs for anything user-facing.
8. UI for revision review, practice and Study Mode is **not built** (placeholder pages remain). This phase is data layer + services only.

## Tests
- `database/tests/phase4/` 00-11 (+ `build_all.sh`) - SQL, **not executed**.
- `database/tests/reference/run_reference_tests.js` - **executed**, 55 assertions; emits the 35 SQL vectors the database must also satisfy.
- `database/tests/rls_tests.sql` - Phase 2 suite amended for post-011 behaviour, **not executed**.
