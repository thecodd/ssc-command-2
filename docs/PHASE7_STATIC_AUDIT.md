# Phase 7: deep static audit of migrations 001-014 (before any runtime)

**This is reading and scripted pattern checks. Nothing here was executed against PostgreSQL. It is supporting evidence and never a substitute for the SQL suites.** Scripts: `database/security/static_audit.cjs` (repeatable, also stage S2 of the kit) and the generated catalog checks in the security suite.

## What the scripts check (all clean in this sandbox)
- Every `public.fn(...)` call resolves to a defined function with a compatible argument count (quote-aware); functions used by CHECK/DEFAULT/INDEX/POLICY/TRIGGER DDL exist in the same or an earlier migration; every `insert into t (cols)`, column grant, policy and trigger target exists in a schema model derived from the migrations.
- 98 functions, 47 SECURITY DEFINER, 0 without a pinned `search_path`. `function_matrix.js` classifies exactly the functions the migrations define; `014_function_privileges.sql` and the matrix doc regenerate byte-identically.
- Closure under 014's allow-list: no INVOKER function, trigger, policy, CHECK or DEFAULT calls a function `authenticated` can no longer execute. No view lacks `security_invoker`. No statically declared write policy lacks an `auth.uid()` / `is_admin()` / visibility predicate.
- The 10 migrations that promise "Safe to re-run" contain no unguarded `create table/index/policy/trigger/type` or `add column/constraint` (heuristic). The kit applies each migration once (ledger) anyway.
- Inventory for human review: 40 dynamic `EXECUTE` statements (policy/grant loops in 001, 004, 007, 011, 014), 2 `ALTER DEFAULT PRIVILEGES`, 8 `regprocedure` uses, 3 `has_function_privilege` uses.

## Findings from the manual pass (not proven at runtime)
| Area | Observation | Runtime check that will confirm it |
|---|---|---|
| Postgres 15+ / Supabase | Uses `gen_random_uuid()` (core since 13), `pg_trgm`, partial unique indexes, `security definer` with pinned search_path; no views; nothing needs superuser except `insert into auth.users` and `set role` in the tests | stage 4a/4b |
| RLS recursion | All `is_*_visible` helpers and `is_admin()` are SECURITY DEFINER with `search_path = ''`, so policies that call them do not re-enter RLS on `books`/`chapters`/`profiles`; no policy references a table whose policy references it back | suites 4/6/7 + security suite (reads as A/B/C) |
| Policy OR-combination | 004 recreates `read_official_or_own`, `admin_official_write`, `own_custom_write` after dropping the 001 `read`/`write` policies; 011 replaces read/own-write with visibility-aware versions and keeps the admin policy. A user can only write rows with `owner_id = auth.uid()`; official rows need `is_admin()` | security suite section I |
| Column-level privileges | 012 revokes table-level SELECT on `pyqs` and grants an explicit column list (no `correct_answer`, `explanation`, `content_hash`); policy expressions use only granted columns (`id`, `owner_id`). Whether Postgres requires column privileges for columns used inside a policy expression is exactly the kind of detail only execution settles | security suite section H, phase 6 suite |
| `ALTER DEFAULT PRIVILEGES` | Only two statements (004, revoke from `anon`), which affect objects created by the migrating role. New tables therefore inherit Supabase's default grants to `authenticated` unless a migration revokes: server-owned tables (progress, sessions, revision, attempts, practice) are explicitly `revoke all` then `grant select`; the rest rely on RLS. A table created without RLS would be fully exposed | SEC "every table has RLS" + "server-owned tables grant only SELECT" |
| Function privileges | 014 revokes EXECUTE from PUBLIC/anon/authenticated for every function we own, then grants back from the matrix, then asserts via `has_function_privilege`. Assumes `'public'` is accepted as a role name by `has_function_privilege` (documented pseudo-role) | 014 itself raises on mismatch; SEC catalog checks |
| Trigger ordering | `pyqs` has one BEFORE trigger (`pyqs_set_hash`, now on every update so `has_valid_key` cannot be forced); `user_progress` seeding is an AFTER trigger so the row is final; `revision_reviews` has a BEFORE UPDATE/DELETE guard keyed on trigger depth | phase 7 suite (append-only), security suite |
| Rollback-sensitive statements | No `CREATE INDEX CONCURRENTLY`, `ALTER TYPE ... ADD VALUE`, `VACUUM`: every migration can run inside `psql -1` and rolls back whole on error. 012 backfills every `pyqs` row (`update ... set question = question`), which fires triggers once per row | stage 4b |
| Re-run behaviour | Guarded DDL (`if not exists`, drop-then-create). The kit's ledger prevents accidental re-application | stage 4b (ledger) |

## Learning-data integrity (design review; each has a SQL check)
One open revision per item (`revision_schedule_one_open` partial unique index) / append-only `revision_reviews` (trigger, UPDATE never, DELETE only by FK cascade) / server clock only (`app_now()`; the test-clock GUC is inert unless `app.allow_test_clock` is set and PostgREST clients cannot set GUCs) / no client RPC takes a time, duration, interval, due date, correctness, mastery or score parameter (generated check over `proargnames`) / mastery derived by `learning_mastery()` from stored facts / stale or duplicate review rejected by `expected_step` (40001) / duplicate answer returns the original attempt / archived content hidden by `active_entities()` and RLS visibility helpers.

## PYQ security (design review)
Answer key unreadable by clients (column grants) and revealed only after the learner's own attempt in their own session; grading and `is_correct` are computed in SQL; `has_valid_key` is trigger-computed on every insert/update; custom questions are owner-scoped (RLS) with unique `(owner_id, content_hash)`; practice sessions store an ordered `pyq_ids` snapshot and every practice RPC checks `user_id = auth.uid()` and membership of the question in that snapshot; attempts/sessions have no client write grants.

## Newly discovered defects / risks in this pass
- FIXED `database/security/schema_model.js` resolved migrations relative to the current directory (broke when run from elsewhere).
- FIXED `database/security/build_privileges.js` rewrote 014 and the matrix doc merely by being `require`d; it now regenerates only when run directly.
- FIXED (kit, before first use) the preflight compared psql boolean output to `"true"`; real `psql -A -t` prints `t`/`f`. Caught while building the fake-psql tests; a mutation check confirms the test fails without the cast.
- RISK the real `npm run typecheck`/`lint`/`build` have never run on ~25k lines (stubbed `tsc` only). Expect findings; none can be predicted from here.
- RISK `package.json` now lists `playwright` and `axe-core` as devDependencies for the kit; there is no lockfile, so use `npm install` (not `npm ci`) the first time and commit the lockfile.
- RISK the heuristic checks (re-run, policy predicates) are regex based and can miss constructs inside dynamic `EXECUTE`.

## Performance: ranked concerns (no measurements exist; nothing was changed)
| Rank | Concern | Why it may be expensive | Data size where it matters | Measure later | Now |
|---|---|---|---|---|---|
| P0 | none confirmed | no query shows an unbounded cross-user scan or per-row N+1; the first thing to measure is P1-1 | n/a | n/a | n/a |
| P1-1 | `user_entity_signals()` evaluated repeatedly per request (dashboard: daily_focus + revision_queue + top-item signals + dashboard_summary; `/revision`: queue + graduated titles) | each call aggregates every started entity: attempt rollups, PYQ counts, revision/review rollups | tens of thousands of attempts or > ~2k started entities | `EXPLAIN (ANALYZE, BUFFERS) select * from user_entity_signals()` for a heavy user; time the dashboard RPC set | leave unchanged |
| P1-2 | `revision_queue()` joins signals, no pagination | returns every open revision | > several hundred open revisions | EXPLAIN as above; check the Upcoming slice | leave; paginate only if measured |
| P1-3 | `daily_focus()` `start_next` branch (NOT EXISTS per topic, limit 10 after ordering) | per-topic anti-joins over mappings/progress | thousands of topics | EXPLAIN with a synthetic 5k-topic catalogue | leave |
| P1-4 | practice candidate selection (attempt anti-join, random ordering) | anti-join against the learner's attempts, then sort | > 100k attempts per user | EXPLAIN the `start_practice` candidate query | leave |
| P2-1 | `dashboard_summary()` many scalar subqueries | repeated scans of progress/entities | large catalogues | EXPLAIN | leave |
| P2-2 | `topic_pyq_stats()` once per mapped topic from an NCERT chapter (bounded loop of 8) | up to 8 RPC round-trips per page | only if latency dominates | page timing | batch later if needed |
| P2-3 | `global_search()` | trigram/FTS index use unverified; takes a limit | large chapter/PYQ tables | EXPLAIN with `pg_trgm` GIN indexes present | leave |
| P2-4 | Study Mode query fan-out (~14 parallel selects/RPCs per page) | latency, not CPU | slow networks | server timing logs | leave |
