# Phase 7: Revision experience

**Status: written, statically checked, logic-tested in Node. No SQL executed (no Postgres), no browser used, `npm install` blocked (registry 403) so `typecheck`/`lint`/`build` never ran.**

## Architecture (no revision logic in React)
- Database (008, unchanged): `revision_schedule` (one OPEN row per item), append-only `revision_reviews`, ladder = `profiles.revision_intervals`, rule = `revision_next()`, writes = `schedule_revision()` / `review_revision(expected_step)`.
- **New 013 `revision_queue()`** (read-only, SECURITY INVOKER): the learner's open revisions with `bucket` (overdue/today/upcoming), `rank`, and the signals shown on a card (mastery, weak_reason, confidence, last studied, PYQ accuracy, ladder). Order: bucket, **oldest due first**, weak, lower mastery. Oldest-due-first is exactly how `daily_focus()` orders revisions, so the first due queue row is the same item `daily_focus()` puts first among revisions (SQL test). Deviation from the literal brief list ("overdue, due today, weak, oldest due, lower mastery"): weak/mastery only break ties between equally old revisions, to keep ONE ordering with daily_focus. 014 (privileges) is renumbered from 013 and must stay LAST.
- Interval preview: `services/revision.ts getIntervalPreview()` calls `revision_next()` for hard/good/easy on the user's own ladder. The ladder is read from `profiles.revision_intervals`, or `lc_default_ladder()` when unset. No 1/3/7/15/30 constants exist in components (tested).
- `lib/revision/*`: presentation helpers (grouping WITHOUT re-sorting, labels), pure review state machine, controller (one submit at a time, stale/lost-response handling), API contract. `app/actions/revision.ts`: validated actions returning our own copy; after a review it READS mastery (`user_entity_signals`) and the next due item (`revision_queue`).

## Screens
- `/revision` queue: Overdue, Due today, Upcoming, Completed (finished the ladder; a later weakness can reopen it). One primary action per card (Review / Review early) and a "Start with <top item>" button. Empty = "You're caught up." with Study / Practice actions.
- `/revision/[id]` review (focus layout, id = schedule id): **recall** (think, optional unsaved scratch box) -> **material** (key ideas, NCERT/SSC connection, latest note) -> optional confidence 1-5 -> optional "Test yourself with 5 PYQs" (returns here via a whitelisted `back=/revision/<uuid>`) -> **Hard / Good / Easy** radios with server-previewed next review -> Save -> result (rating, next review, server mastery, "Next revision"). Phones: fixed bottom action bar with safe-area; details in a bottom sheet. Desktop: 300px side panel (mastery, ladder, history, PYQs).
- Stale / already reviewed (`40001`, ended, not found): "This revision was already updated elsewhere.", state re-read from the server, nothing overwritten. A response lost after the write landed is detected by re-reading (no second review).
- Study Mode: due/overdue -> one primary "Review" link (before and after studying); the old inline rating strip is removed (no duplicate rating UI). Revision card shows state, ladder strip, last reviews. Studying/finishing never calls the revision RPCs.
- Dashboard: Overdue / Due today / Upcoming counts and "Start revision" from `revision_queue()` (nothing shown if it fails to load). Topic and chapter detail pages: `RevisionPanel` (state, ladder, history).

## Not done / limits
- Nothing here has been run against Postgres or seen in a browser. Apply migrations in order 001-014 (013 before 014) and run `database/tests/phase7/phase7_all.sql` on a scratch project.
- The Completed list comes from `revision_reviews` (graduations), titles from `user_entity_signals()`.
- `revision_queue()` joins `user_entity_signals()` (heavy-ish for large syllabi); no index/perf measurement was possible.
- PYQ mini-session returns to the review but does not feed the rating; the rating stays the learner's choice, graded by `review_revision()`.
- Dev previews: `/dev/study-preview`, `/dev/revision-preview` (fixtures + in-memory fake that uses the SQL-derived Node oracle; not proof about the database).
