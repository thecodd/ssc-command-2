# Phase 3 — Learning Engine Architecture (decision report)

Status: design only. **Nothing in sections 4–6 below has been run against Postgres** (no database in the authoring environment).
The one executed artifact is `lib/learning/` (pure rules, 64 passing assertions, run with Node).

Loop under review: NCERT → SSC topic → Study → Practice → Performance → Weakness → Revision → Mastery.

---------------------------------------------------------------------------------------------------
## 1. Findings from auditing the current code and schema

| # | Finding | Evidence | Severity |
|---|---|---|---|
| F1 | "Mark complete" twice **resets the revision ladder** (delete pending rows, re-insert 5 from today) | `services/progress.ts scheduleRevisions` | High |
| F2 | Five revision rows are pre-created, so Easy/Good/Hard cannot change later intervals without rewriting rows | `revision_schedule` design | High |
| F3 | Delete-then-insert of revisions is two statements, not atomic | same | Medium |
| F4 | Dashboard % can exceed 100 and ignores archived/deleted entities: numerator counts `user_progress` rows, denominator counts live chapters/topics; `pct()` is unclamped | `services/dashboard.ts` | High |
| F5 | NCERT progress denominator is *all* chapters, contradicting "not every chapter is required for SSC" | same | Medium |
| F6 | Study time is client-supplied (`finishStudyAction(sessionId, seconds)`), clamped only to 24 h; refresh loses the timer; tab close leaves a session open forever; nothing prevents several open sessions | `ProgressPanel`, `finishSession` | High |
| F7 | `sessions` / `seconds_spent` / `revision_count` are read-modify-write in app code (lost updates with two tabs) | `finishSession` | Medium |
| F8 | Client sets `status`, `completion`, `confidence` directly; un-completing a subtopic sets `completion: 0` in a component; "strong" is user-asserted | `SubtopicList`, `saveProgressAction` | High |
| F9 | "Add to today's focus" writes a task, but the dashboard focus card never reads tasks | `addFocusTask` vs `getDashboard` | Medium |
| F10 | `completeAction` sets `last_studied_at` even if nothing was studied | `app/actions/progress.ts` | Low |
| F11 | `pyq_attempts.is_correct` is client-writable (RLS allows own rows), no selected answer, time, or session | `pyq_attempts` | High (for Phase 7) |
| F12 | `pyqs.difficulty` reuses `priority_t` (values very_high…low) | `pyqs` | Medium |
| F13 | `pyqs.exam/tier/subject` are free text that duplicates the SSC hierarchy; no paper entity, no dedupe key | `pyqs` | High (before import) |
| F14 | `pyq_topics` has no index on `ssc_topic_id` (PK starts with `pyq_id`); every topic→PYQ lookup scans | 001 | Medium |
| F15 | ~18 foreign-key columns have no index (`chapters.book_id`, `ssc_topics.subject_id`, `concepts.chapter_id`, `ssc_subtopics.topic_id`, `books.subject_id`, `subjects.class_id`, `ssc_subjects.tier_id`, `ssc_tiers.exam_id`, every `owner_id`, `pyq_attempts.pyq_id`, `resources.user_id`, `*.source_id`) | 001 | Medium |
| F16 | Almost no natural-key uniqueness: duplicate books/chapters/topics/concepts are insertable, and the importer's find-or-create races | 001 | High (before import) |
| F17 | `owner_id uuid references profiles` has no `ON DELETE`: deleting a user with custom content is **blocked** | 001 | Medium |
| F18 | Polymorphic `entity_type + entity_id` (progress, revisions, notes, resources, sessions, tasks, tags) has no referential integrity; deleting a chapter leaves silent orphans | all | High |
| F19 | Admin service allows hard delete of official rows (`archiveOnly=false`); with cascades this would wipe users' data | `services/admin.ts` | High |
| F20 | The importer trusts `is_verified` / `is_official` from the uploaded file, runs row-by-row with no transaction, no dry run, no audit | `services/import.ts` | High |
| F21 | `status_t` mixes lifecycle (`learning`, `completed`) with derived/overlay states (`strong`, `revision`) | enum | Medium |
| F22 | Streak only advances on a *finished* session, so abandoned sessions lose the day | `touch_streak` callers | Low |

---------------------------------------------------------------------------------------------------
## 2. Decisions by topic

### 2.1 user_progress
Keep the PK `(user_id, entity_type, entity_id)`, `completion`, `confidence`, `seconds_spent`, `sessions`, `revision_count`, `last_studied_at`.

- **Add `completed_at timestamptz`.** Needed for "done this week" analytics and Done & Dusted; cannot be derived because nothing logs status changes.
- **Do not add:** `first_studied_at` (= `min(study_sessions.started_at)`), `last_confidence_update` (confidence history lives in revision reviews), `mastery_score` and `accuracy_snapshot` (derived from attempts/reviews; storing them creates stale data).
- **Status semantics (F21):** stored status is the learner's lifecycle only: `not_started | learning | completed`. `strong` and `revision` are no longer written; migration maps legacy `strong → completed, confidence = 5` and `revision → completed`. Enum values stay (Postgres cannot drop them) but are unused. Mastery is derived (section 4).
- **Effective completion:** if a topic has subtopics, completion = % of subtopics completed (computed in the signals view); the manual slider applies only to leaves. Stored `completion` is the leaf value.
- **Write path (F7, F8):** clients lose direct write access to counters. Column grants (same pattern as `profiles` in 004): authenticated may write only `status, completion, confidence` through `set_progress()`; `seconds_spent, sessions, revision_count, last_studied_at, completed_at` change only inside session/revision RPCs.

### 2.2 study_sessions (F6, F7, F22)
Wall-clock math on the **server** instead of a client-reported counter.

New columns: `state` (`active|paused|completed|abandoned`), `active_since timestamptz` (start of the current running segment, null when paused), `accumulated_seconds int` (closed segments), `last_heartbeat_at timestamptz`. Existing `seconds` becomes the final credited duration; `ended_at` set at close.

| Event | Server behaviour (all in RPCs, all using `now()`) |
|---|---|
| start | If the caller already has an open session for the **same** entity: return it (refresh-safe, idempotent). If for another entity: close it as abandoned, then create. Partial unique index `(user_id) WHERE state IN ('active','paused')` makes duplicates impossible even on races. |
| pause | `accumulated += now - active_since` (capped at `last_heartbeat + 90 s`), `active_since = null`. |
| resume | `active_since = now`. |
| heartbeat (every 30 s while visible) | `last_heartbeat_at = now`. |
| finish | Credit the running segment, capped at `last_heartbeat + 90 s`; `state = completed`; update progress counters and call `touch_streak()` in the same transaction. |
| tab closed / crash | No event arrives. Next `study_start` (or a read of the open session) sees `now - last_heartbeat > 10 min`, credits up to `last_heartbeat + 90 s`, sets `abandoned`. The time is **not lost and not inflated**. |
| refresh | Client re-reads the open session and rebuilds the timer from `accumulated_seconds + (now - active_since)`. |

Sessions under 30 s credit time but do not increment `sessions`. "Today's minutes" = sum of credited seconds whose `started_at` falls in the user's local day (a session that spans midnight belongs to the day it started; documented, accepted).
This is the smallest model that handles all five cases (start, pause, resume, refresh, duplicate) without a background job.

### 2.3 Revision (F1, F2, F3)
**Change `revision_schedule` from "five pre-made rows" to "one open row per entity", and add an append-only history table.**

- `revision_schedule` (current state): add `step int not null default 0`, `reason text check (reason in ('completion','manual','weakness'))`. Partial unique index `(user_id, entity_type, entity_id) WHERE done = false` (exactly one open row). Existing `rating`, `done`, `done_at`, `interval_days` remain for legacy rows.
- **New `revision_reviews`** (append-only): `id, user_id, entity_type, entity_id, schedule_id, due_date, reviewed_at timestamptz, reviewed_on date` (local date frozen at review time), `rating`, `step_before, step_after, interval_days_after, confidence int null, seconds int null`. **Yes, history is worth it now**: it feeds the hard-streak weakness rule, consistency analytics, and per-topic trends; a mutable row cannot provide any of that, and retrofitting means losing data already generated.
- Intervals come from `profiles.revision_intervals` (validated: 1–12 ascending whole days ≤ 365). Changing the ladder affects only future scheduling; open rows keep their due date and their `step` is clamped to the new ladder.
- Logic lives in `lib/learning/rules.ts` (`seedRevision`, `nextReview`) **and** is applied by one RPC `review_revision()`; the RPC takes the next step/date computed by the same rule (see 2.11 for how the two are kept identical).
- Completing an already-completed item is a no-op for scheduling (fixes F1).

### 2.4 PYQ attempts and practice sessions (F11)
Add to `pyq_attempts`:

| Column | Verdict | Why |
|---|---|---|
| `selected_answer text` | **add** | Review screen, distractor analysis; `is_correct` is computed server-side from it. |
| `time_taken_seconds int` | **add** | SSC is timed; "which question was hard" = slow and/or wrong. |
| `session_id uuid → practice_sessions` | **add** | Session summary, recent performance, grouping. |
| `attempt_number` | **don't add** | Derivable with `row_number() over (partition by user_id, pyq_id order by created_at)`; first-vs-repeat comes from a view. |
| `created_at` | keep | already present |

`is_correct` stays as a stored snapshot (answer keys can be corrected later, history must not silently change) but becomes **server-written only** via `submit_pyq_answer()`. Unique `(session_id, pyq_id) WHERE session_id IS NOT NULL` stops double-tap duplicates. Skipped questions are not rows; skips = `planned_count − answered`.

New `practice_sessions`: `id, user_id, scope_type ('ssc_topic'|'ssc_subtopic'|'ssc_subject'|'weak'|'mixed'), scope_id uuid null, pyq_ids uuid[] (snapshot of the question order so refresh/resume is deterministic and no repeats), planned_count, state ('active'|'completed'|'abandoned'), started_at, ended_at`. Summary numbers are derived from attempts, not stored.

Attribution rule: a PYQ can map to several topics, so **topic** accuracy joins through `pyq_topics` (the attempt counts for every mapped topic), while **subject/overall** accuracy is computed per distinct attempt. Never add up topic accuracies.

### 2.5 PYQ data model (F12, F13, F14)
Keep `pyq_topics` (many-to-many). Changes before any real import:

- **New `exam_papers`** `(id, exam text, year int, tier text, shift text null, exam_date date null, source_id → sources, source_url)`. A PYQ belongs to a *past paper*, which is a different thing from an `ssc_exams` *syllabus version*. `pyqs` gets `paper_id → exam_papers` and `source_ref text` (question number in the paper). Old free-text `exam/year/tier/subject/source` columns are kept nullable for now and dropped in a later cleanup; `subject` is derivable through topics.
- **Subtopic mapping: add `pyq_subtopics (pyq_id, ssc_topic_id, ssc_subtopic_id)`** with composite FKs `(pyq_id, ssc_topic_id) → pyq_topics` and `(ssc_topic_id, ssc_subtopic_id) → ssc_subtopics(topic_id, id)` (needs `UNIQUE (topic_id, id)` on `ssc_subtopics`). A subtopic link therefore cannot exist without its topic link. Optional data: a verified dataset may map only to topics.
- `difficulty`: new `difficulty_t ('easy','medium','hard')`; migrate the column (no real data yet). `topic_pyqs()` RPC must be recreated (its return type names `priority_t`).
- `content_hash text` (md5 of normalized question + options) with a unique index `WHERE owner_id IS NULL` for official de-duplication.
- Answer contract: `options` is a jsonb object `{"A": "...", "B": "..."}`; `correct_answer` must be one of its keys (CHECK via immutable function).
- **Deferred but non-breaking later:** image/figure media for reasoning questions (`media jsonb` nullable), language variants, answer-key correction workflow.

### 2.6 Mastery
Derived, never stored, implemented once in `lib/learning/rules.ts` (`deriveMastery`). Exact rules in section 5. DB supplies raw signals through one view/RPC (section 3, migration 010). Scaling boundary: derivation runs in application code over one user's entities (hundreds to low thousands); revisit only if a user exceeds ~3,000 tracked entities.

### 2.7 Daily focus (F9)
Service boundary: `services/focus.ts → getFocusPlan()` reads (a) today's open **tasks linked to an entity** (explicit picks), (b) revision queue, (c) the signals set, then calls `planFocus()` in `rules.ts`. The dashboard focus card, "Needs your attention", and "weak topics" all read this plan or the same signals; none compute their own. Finishing a study session for an entity that has an open focus task today completes that task (`tasks.completed_at`, new column). Rules in section 5.

### 2.8 Polymorphic safety (F18, F19)
Keep `entity_type + entity_id`. Add an **entity registry**:

```
entities (id uuid primary key, type entity_t not null, unique (type, id))
```
- AFTER INSERT / AFTER DELETE triggers on `chapters`, `concepts`, `ssc_topics`, `ssc_subtopics`, `pyqs` maintain it; one-time backfill.
- Every referencing table gets a composite FK `(entity_type, entity_id) REFERENCES entities (type, id) ON DELETE CASCADE`: `user_progress, revision_schedule, revision_reviews, notes, resources, study_sessions, tasks, topic_tags`. Nullable pairs (resources, tasks) add `CHECK ((entity_type IS NULL) = (entity_id IS NULL))`. The composite key also guarantees the **type matches** the id.
- Per-table allowed types via CHECK (e.g. progress: chapter/topic/subtopic only).
- `entities` has RLS enabled with no policies (clients never read it); FK checks still work.
- **Cascade is dangerous for official rows**, so: `BEFORE DELETE` trigger on curriculum tables raises for `owner_id IS NULL` when `auth.uid() IS NOT NULL` ("archive instead"). Official curriculum is archived, never hard-deleted through the API. Users deleting their *own* custom rows cascade to their own notes/progress, which is correct. `services/admin.ts` loses the `archiveOnly=false` path.
- `owner_id` FKs become `ON DELETE CASCADE` (F17).

This gives real referential integrity with ~5 triggers + 8 FKs instead of 11 hand-written validation/cleanup triggers, and keeps the flexible API.

### 2.9 Curriculum versioning
The current shape already supports it: NCERT `book` carries `edition + academic_year`; SSC `ssc_exams (name, exam_version)` owns a full tier→subject→topic→subtopic tree; mappings reference concrete chapter/topic ids, so a new version creates new rows and **old mappings are never overwritten**. Changes needed now:

- `ssc_exams.status` and `books.status` (`draft | published | archived`); select policy on those two tables `status = 'published' OR is_admin()`. Imports land as **draft**, are reviewed, then published atomically. Accepted limitation: child rows of a draft are readable by direct id (unguessable uuids); list queries always start from published containers.
- Verification flags (`sources.is_verified`, `ssc_exams.is_official`) become **admin-only writes**; an import file can no longer assert them (F20).
- **Deferred (additive, non-breaking):** lineage columns `previous_chapter_id`, `previous_topic_id`, `previous_subtopic_id` to carry progress and copy mappings forward when a new edition/version appears. Not needed before Study Mode.

### 2.10 Import architecture (F16, F20) — design only
Required before real data:
1. **Natural-key unique indexes** (migration 005): `books (subject_id, title, coalesce(edition,''))`, `chapters (book_id, title) WHERE owner_id IS NULL`, `concepts (chapter_id, title) WHERE owner_id IS NULL`, `ssc_tiers (exam_id, name)`, `ssc_subjects (tier_id, name)`, `ssc_topics (subject_id, title) WHERE owner_id IS NULL`, `ssc_subtopics (topic_id, title) WHERE owner_id IS NULL`, `subjects (class_id, name)`, `sources (name, coalesce(edition,''))`. Run a duplicate-finder query first; fix any existing duplicates.
2. **Staging + single-transaction apply:** tables `import_runs (id, admin_id, file_name, file_sha256 unique, status, dry_run, counts jsonb, errors jsonb, created_at)` and `import_rows (run_id, kind, row_no, data jsonb, status, errors)`. Flow: upload → parse/normalize → insert staged rows → `validate_import(run)` (set-based SQL: required fields, enum values, FK resolution by natural key, ambiguity, duplicate rows in file, mapping endpoints exist) → admin reviews the report → `apply_import(run)` is **one SQL function = one transaction** (all or nothing) → content lands as `draft` → admin publishes.
3. Idempotency: same `file_sha256` is rejected; re-importing changed data upserts by natural key (`ON CONFLICT`).
4. Source gate: NCERT rows require `source_url, edition, academic_year`; SSC rows require `exam_version` + `notification_url`; `is_official` / `is_verified` are set only by an admin action after review.
5. Mapping validation: both ends must resolve to exactly one row; `mapping_type` and `relevance` validated; unmapped is allowed and simply means no row (never "assume relevant").
6. Dry run = run validation only and return the report with zero writes.
The current `services/import.ts` stays usable for small placeholder tests but must not be used for the real dataset.

### 2.11 One rule set, no drift
Scheduling rules exist in TypeScript (`rules.ts`, unit-tested here). The RPCs must not re-implement them. Two safe options, pick one in Phase 4:
- **(recommended)** RPC `review_revision(schedule_id, rating, new_step, new_due, confidence, seconds)` where the **server action computes** `nextReview()` and passes the result; the RPC validates only invariants (ownership, `new_due >= today`, `0 <= new_step <= ladder length`, due within 365 days). Rules stay in one place; the DB guards safety.
- SQL-side rules with TS tests mirrored in `rls_tests.sql`. Rejected: duplicates logic.
Only the ladder validation (ascending, 1–12, ≤365) is mirrored in SQL (profile trigger) because it guards data integrity.

---------------------------------------------------------------------------------------------------
## 3. Decision report

### KEEP (unchanged)
`sources`, `classes/subjects/books/chapters/concepts` hierarchy; `ssc_exams/tiers/subjects/topics/subtopics`; `ncert_ssc_mappings` (many-to-many, unique pair); `pyq_topics`; `tags/topic_tags` shape; `notes`, `resources` shape and Phase-2 policies; `user_progress` PK; `profiles.revision_intervals`, `timezone`, `touch_streak()`; `global_search`; `lib/time.ts`, `lib/paging.ts`; the entity_type + entity_id API for callers.

### CHANGE
1. `user_progress`: status semantics (lifecycle only), column-level write grants, legacy value migration.
2. `study_sessions`: server-side state machine columns + open-session uniqueness.
3. `revision_schedule`: single open row per entity with `step` and `reason`; replace pre-made 5-row logic.
4. `pyq_attempts`: server-written `is_correct`; add selected answer, time, session.
5. `pyqs`: `difficulty_t`, `paper_id`, `content_hash`, answer contract CHECK; free-text exam columns deprecated.
6. `owner_id` FKs → `ON DELETE CASCADE`; official rows undeletable through the API.
7. Dashboard counts → join live, non-archived entities, only **mapped (recommended) NCERT chapters** in the NCERT denominator, clamp to 100.
8. `lib/mastery.ts` → adapter over `lib/learning/rules.ts` (done in this phase).
9. Services: progress/session/revision mutations move to RPCs behind thin server actions; `services/admin.ts` loses hard delete; `services/import.ts` flagged dev-only.
10. `profiles_guard`: validate `revision_intervals`.

### ADD
- Tables: `entities`, `revision_reviews`, `practice_sessions`, `exam_papers`, `pyq_subtopics`, `import_runs`, `import_rows`.
- Columns: `user_progress.completed_at`, `tasks.completed_at`, `study_sessions.{state,active_since,accumulated_seconds,last_heartbeat_at}`, `revision_schedule.{step,reason}`, `pyq_attempts.{selected_answer,time_taken_seconds,session_id}`, `pyqs.{paper_id,source_ref,content_hash}`, `ssc_exams.status`, `books.status`, `ssc_subtopics UNIQUE(topic_id,id)`.
- Indexes: all missing FK indexes (F15); `pyq_topics (ssc_topic_id, pyq_id)`; `pyq_attempts (user_id, pyq_id, created_at)` and `(user_id, created_at desc)`; `revision_reviews (user_id, entity_type, entity_id, reviewed_at desc)`; partial `revision_schedule (user_id, due_date) WHERE NOT done`; `tasks (user_id, due_date) WHERE status <> 'completed'`; natural-key uniques (2.10).
- Functions/RPCs: `set_progress`, `study_start / study_pause / study_resume / study_heartbeat / study_finish`, `schedule_revision`, `review_revision`, `start_practice`, `submit_pyq_answer`, `finish_practice`, `user_entity_signals()` (one set-returning function feeding mastery, weak list, focus, dashboard), `dashboard_summary()`.
- Code: `lib/learning/{config,rules}.ts` (done), `services/learning.ts` (signals), `services/focus.ts`, `services/revision.ts`, `services/practice.ts`.

### DEFER (do not build yet)
Lineage columns across editions/versions; question media/images and language variants; answer-key correction workflow; stored mastery score or materialized stats; recommendation beyond the deterministic ladder; offline sync (`updated_at` on progress); Hindi/English content; full importer UI; per-row mapping provenance and verification; background cron jobs (the lazy abandonment sweep needs none); spaced-repetition ease factors; social features.

### MIGRATIONS (dependency order; all additive and re-runnable; none applied yet)
| File | Contents | Depends on |
|---|---|---|
| `005_integrity_indexes.sql` | FK indexes; natural-key uniques (preceded by a duplicate-finder `SELECT`); `owner_id` cascade; official-row delete guard; `pyq_topics` reverse index; tasks entity-pair CHECK + `completed_at` | 004 |
| `006_entity_registry.sql` | `entities`, triggers, backfill, orphan cleanup, composite FKs on 8 tables, per-table type CHECKs | 005 |
| `007_progress_sessions.sql` | `user_progress.completed_at` + legacy status migration + column grants; `study_sessions` state machine + open-session unique index; `set_progress`, `study_*` RPCs | 006 |
| `008_revision_engine.sql` | `revision_schedule.step/reason` + collapse legacy rows to one open row; partial unique index; `revision_reviews`; ladder validation in `profiles_guard`; `schedule_revision`, `review_revision` | 007 |
| `009_pyq_model.sql` | `difficulty_t`, `exam_papers`, `pyqs` columns/CHECK/hash, `pyq_subtopics`, `practice_sessions`, `pyq_attempts` columns + unique, RPCs `start_practice / submit_pyq_answer / finish_practice`; recreate `topic_pyqs` | 006 |
| `010_learning_signals.sql` | `user_entity_signals()`, `dashboard_summary()`; fixes F4/F5 denominators | 007, 008, 009 |
| `011_curriculum_publishing.sql` | `ssc_exams.status`, `books.status`, policies, `sources`/`is_official` admin-only writes, `import_runs`, `import_rows` | 005 |
| `database/tests/rls_tests.sql` (extend) | add checks for every new policy/RPC; revision, session and practice invariants | all |

### LEARNING ENGINE RULES (implemented and tested in `lib/learning/rules.ts`; thresholds in `lib/learning/config.ts`)

**Mastery** (first match wins):
1. `not_started`: status `not_started`, completion 0, no sessions, no attempts.
2. `weak`: (≥ 5 attempts **and** recent accuracy < 50%) **or** the last 2 reviews are both Hard **or** (confidence ≤ 2 and accuracy unknown).
3. `needs_revision`: the open revision's due date ≤ today.
4. `in_progress`: started but not completed.
5. `mastered`: completed **and** revision ladder graduated **and** (no PYQs attempted **or** accuracy ≥ 80% with ≥ 5 attempts) **and** confidence unset or ≥ 4.
6. `strong`: completed **and** (accuracy ≥ 75% with ≥ 5 attempts and confidence unset or ≥ 3, **or** no PYQs attempted and ≥ 1 review and confidence ≥ 4).
7. `learning`: completed (first pass) without enough evidence. Self-rated confidence alone never makes something strong.
"Recent accuracy" = newest 10 attempts. Fewer than 5 attempts means accuracy is *unknown*, never a failure.

**Weak-topic ranking:** higher exam priority → more PYQs (more often tested) → lower recent accuracy → more Hard reviews → studied longest ago → id.

**Revision scheduling** (ladder = `profiles.revision_intervals`, default 1,3,7,15,30):
- First completion seeds one open row: step 0, due = today + ladder[0]. Completing again never reschedules.
- Good: step+1. Easy: step+2. Hard: step−1 (min 0) **and** next gap = ladder[0]. Past the last step = graduated (no open row).
- Next due is anchored on the **review date**, not the old due date. Reviewing early is allowed.
- Every review appends to `revision_reviews` and increments `revision_count`.
- Becoming weak from practice opens a revision due today (reason `weakness`) if none is open.

**Daily focus** (deduped per entity, max 5): explicit picks → overdue revisions (most overdue first) → due-today revisions → weak topics (ranked) → continue (most recently studied) → start next (highest priority whose foundation chapters are done). One reason code per item; the UI shows it.

**Next action per topic:** weak → fix; revision due → revise; not started → NCERT foundation first if any foundation chapter is undone, else start; in progress → continue; done with PYQs but no attempts → practice; learning with no open revision → schedule; else on track.

### RISKS (what could cause major rework if ignored)
1. Shipping Study Mode on the current client-timer/`saveProgress` path, then migrating to RPCs: rewrites UI and invalidates recorded time.
2. Importing real data before natural-key uniques and draft/publish exist: duplicates and partial imports that are painful to clean.
3. Skipping the entity registry: orphaned progress/notes that silently skew every percentage.
4. Keeping `is_correct` client-writable: untrustworthy accuracy, which every weakness and mastery rule depends on.
5. Pre-created revision rows: Easy/Good/Hard cannot work without rewriting scheduling.
6. `difficulty` on `priority_t` and free-text exam fields: costly to fix after thousands of PYQs are imported.
7. Hard-deleting official rows once cascades exist: one admin click wipes every user's progress for a chapter.
8. Drift between SQL and TS rules (mitigated by 2.11).
9. All of this SQL is untested. Migrations 005–011 need a run against a scratch Supabase project with the extended test script before any real data goes in.
10. Free-tier realities: many RPCs and RLS subqueries mean you should watch query plans once data is loaded (`EXPLAIN` on `user_entity_signals`).

### READY FOR PHASE 4: YES, conditionally
Yes for implementing migrations 005–011 and the services/RPCs (architecture is settled, nothing remains to redesign). Not yet for shipping anything to users until (a) the four existing migrations and `rls_tests.sql` have been run and pass, and (b) the new migrations pass the extended tests on a scratch project.
