# Phase 6A: verification and hardening audit

**Everything below is static analysis plus Node tests. No SQL was executed (no Postgres), no browser was used, `npm install` is blocked by a registry 403 so `typecheck`, `lint` and `build` never ran.**
Provenance note: migrations 012/014, `database/security/*`, the practice UI (`lib/practice`, `components/practice`, `app/(focus)/practice`) and several tests were already in the working tree when this audit began. They were audited, not assumed correct.

## 1. Function execution (see `docs/SECURITY_FUNCTION_MATRIX.md`, generated from `database/security/function_matrix.js`)
- 97 functions, 47 SECURITY DEFINER; every one pins `search_path` (static test + SQL assertion in 014).
- 014 is an allow-list: revoke from PUBLIC/anon/authenticated on everything we own, grant back only client RPCs, RLS helpers and pure helpers to `authenticated`, and two maintenance functions to `service_role`.
- Definer functions that take a user/session id (`_close_session`, `_touch_streak`, `_recover_stale`, `_seed_revision`, `_open_weakness_revision`, `_ensure_topic_progress`, import helpers, `entity_accessible`) are not client-callable. Client RPCs derive identity from `auth.uid()` (`_require_uid()`); admin RPCs check `is_admin()` first.
- Extra check added during this audit: with 014's grants, no INVOKER function, trigger, policy, check constraint or default calls a function that authenticated can no longer execute (script scan: clean). Not proven at runtime.
- Residual risks: `is_*_visible(uuid)` helpers are a published/not-published oracle for a given id (low). `service_role` key must never reach the browser.

## 2. Study Mode contract audit
- Every `.rpc()` call (argument names, required args) matches the latest SQL definition. Return shapes of `topic_pyq_stats`, `user_entity_signals`, `daily_focus`, `schedule_revision`, `review_revision`, `_practice_json`, `finish_practice` match the TypeScript types.
- Every table/column in the study/practice/revision/progress/content services' `select()` strings exists in the migrations (test `contract:`; mutation-checked).
- **Mismatch found and fixed (SQL side authoritative):** `topic_pyq_stats`, `subject_pyq_counts`, `topic_pyqs` counted archived questions and questions without a valid key, so the UI could promise PYQs Practice could not serve. 012 adds `pyqs.has_valid_key` (trigger-maintained, readable, reveals only whether a key exists) and those functions filter on it. The Study Mode subtopic count filters the same way.
- **Bug found and fixed (TS):** duplicate `activate()` in `lib/study/controller.ts`; StrictMode re-mount left the controller disposed. Covered by a test.
- Assumption still unverified: PostgREST embedded-select naming and `!inner` filtering behave as written.

## 3. Dev preview bundle
`/dev/study-preview` is `page.dev.tsx`; `next.config.mjs` registers the `dev.tsx` extension only outside production, so it is not compiled or routed in a production build. A test asserts it is the sole importer of `tests/fixtures`. Not confirmed with `next build`.

## 4. Answer key
Decision: **not acceptable to expose; fixed in 012.** `SELECT` on `pyqs` is column-limited for `authenticated` (no `correct_answer`, `explanation`, `content_hash`), so keys cannot be read directly, through embeds, or probed with filters. `practice_question()` returns question + options, and the key, explanation, mapped topic and concept only once the caller has an attempt for that question in their own session. `submit_pyq_answer()` has no correctness parameter and grades in SQL. Side effect: admins and custom-PYQ owners cannot read keys through the API either (use the SQL editor / service role).

## 5. Study Mode QA (static; nothing browser-tested)
- Start: idempotent per item server-side; client dedupes in flight. Pause/resume/finish: server idempotent; second finish returns the closed session. Heartbeat: server-credited time; client only interpolates with a monotonic clock. Recovery: `study_recover` on mount and on focus/online/visibility; a session on another item is not adopted. Stale/abandoned: shown with the server's saved seconds. Duplicate tab: same session; the other tab learns on its next heartbeat or focus. Navigation away: exit dialog offers pause-and-leave; leaving unpaused is bounded by the server's stale rules.
- No client duration reaches the server and no component uses wall-clock time (tests).
- Starting/finishing never calls the revision RPCs; the ladder moves only through `schedule_revision` / `review_revision` (and the DB trigger on first completion).
- Known weak spot: a paused tab does not poll, so another tab's resume shows up on focus, not instantly.

## 6. Layout at 360 / 390 / 412 / 768 / 1024 / 1440 px (structural only, UNVERIFIED in a browser)
- Header below 1024px: Exit + title only (mastery badge from 640px, clock and controls from 1024px). The clock and controls live in the fixed bottom bar below 1024px, with safe-area padding; page content has `pb-36`.
- One column below 1024px; two columns (content + 340px sticky panel) from 1024px; `min-w-0` and `break-words` guard long titles; no fixed widths over 340px; inputs are 16px on phones; sheets cap at 88dvh.
- 44px targets enforced by a structural test (overlay links and in-sentence links excepted).
- At 768px the phone layout is used (single column, bottom bar); that is a choice, not tested.

## 7. Type safety
Explicit row types replace `any` in: study context loader, revision queue, progress map, study hub, `safe()` error handling, admin action result, search palette abort handling, `ImportRow` (untrusted admin import input -> `unknown`), PYQ preview rows. ~52 `any` remain in the older curriculum read services/pages (`ssc`, `mappings`, `curriculum`, `ncert` and their pages): display-only, left as generated-client gaps.

## 8. Search
012's `global_search` hides archived and unpublished books, chapters, concepts, subjects, topics, subtopics and PYQs from non-admins (the leak: archiving a book left its chapters unflagged). Admins still see everything. SQL reviewed, not executed. PYQ results still link to `/pyqs` (placeholder page).

## 9. PYQ data contract
Question -> `exam_papers` (paper_id) -> `pyq_topics` -> `pyq_subtopics` (composite FKs force the subtopic to belong to the linked topic) -> `practice_sessions.pyq_ids` (ordered snapshot, 1..200) -> `pyq_attempts` (unique `(session_id, pyq_id)`).
Order: preserved by the stored array; `practice_state` returns it as stored. Cannot (by SQL review): submit another user's session (looks like not found), a question outside the session (22023), the same question twice (original result returned, `duplicate: true`), forge correctness (no parameter; no client INSERT/UPDATE/DELETE on attempts or sessions). Candidate selection excludes archived, keyless and other users' custom questions.
Behaviour to know: starting practice with a different configuration abandons your active session; the same configuration resumes it (and ignores a new count).

## 10. Not done / not proven
All SQL (including 014's own assertions and the new phase6 suite), any browser behaviour, `next build`, a real typecheck and lint. Apply migrations 001-014 in order on a scratch project before trusting any of this.
