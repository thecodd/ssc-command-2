# Phase 5: Study Mode

Status (Phase 5 snapshot; see docs/PHASE6A_AUDIT.md for later changes): written, statically checked, logic-tested in Node. **Not run in a browser. No SQL or Supabase call has ever been executed.**

## Route
`/study/[type]/[id]`, `type` in `ncert_chapter | ssc_topic | ssc_subtopic` (the existing entity model). The page validates type and uuid before any query, then loads
`getStudyContext()`. Unknown type, bad uuid, archived or invisible (RLS) item → `notFound()`. Lives in the `(focus)` route group (no sidebar/bottom nav).
Other new routes: `/study` (hub: resume, daily focus, weak spots), `/revision` (queue → Study Mode), `/dev/study-preview` (dev only, 404 in production).

## Architecture
- `lib/study/sessionMachine.ts`: pure reducer. Server responses are the only source of elapsed seconds; a monotonic clock interpolates the display between responses and is never sent anywhere.
- `lib/study/controller.ts`: orchestration without React (de-dupes in-flight ops, reconciles via `study_recover` after timeout/network/ended/not_found, heartbeat → `sync_lost`, keyed mutations). `StudyProvider` wires it to React.
- `lib/study/api.ts`: the only surface the UI uses (`StudyApi`). `components/study/liveApi.ts` = server actions; `tests/fixtures/fakeStudyApi.ts` = in-memory fake (`mode: "fixture"` → visible banner).
- `app/actions/study.ts`: validated server actions returning `{ok, code, error}` with our own copy. `lib/study/errors.ts` maps PG codes (P0002/55000/40001/22023/42501) to codes; raw messages never reach the UI. `lib/actions.ts safe()` got the same treatment.
- `services/studyContext.ts`: one `StudyContext` from real rows + RPCs. `services/study.ts`, `revision.ts`, `progress.ts`: thin RPC wrappers.
- `lib/study/nextStep.ts`: maps server-derived state to ONE recommendation. `lib/learning/rules.ts explainMastery`: renders the server's signals as "Why this status?" and applies no thresholds.

## Honest limits / assumptions to verify against a live database
- Embedded selects in `services/studyContext.ts` (column names such as `archived`, `topic_id`, `pyq_subtopics.ssc_subtopic_id`, `pyq_attempts.is_correct`, `resources.user_id`, `chapters.archived`), and the `topic_pyq_stats` / `user_entity_signals` / `daily_focus` row shapes.
- Practice entry: superseded by Phase 6A. `PRACTICE_READY=true`; "Practice PYQs" opens `/practice/new?scope=...` (see docs/PHASE6A_AUDIT.md).
- Revision rating (`RatingStrip`) is integration only, not Revision Review (no queue advance or batching). It relies on `review_revision(expected_step)` rejecting stale steps.
- NCERT chapter PYQ card lists per-mapped-topic counts; the headline is the primary topic, not a de-duplicated total.
- Topic completion is the learner's own value; it is not rolled up from subtopics (no rollup exists in SQL).
- Subtopics have no detail page; "Exit" returns to the parent topic page.
- Fixture preview simplifies mastery changes locally; real mastery is derived in SQL.
- No browser run: layouts at 360/390/412 are by construction (see below), not observed.

## Layout notes (unobserved)
Phone: single column, sticky bottom bar (`pb-[env(safe-area-inset-bottom)]`, 44px targets), content has `pb-36`, header hides the mastery badge under 640px, native `<dialog>` bottom sheets. Inputs use 16px text on mobile (no iOS zoom). Desktop ≥1024px: content + sticky 340px side panel, controls in the header.

## Tests (Node, no DB, no browser)
`node tests/study/run.js` → 35 assertions (machine, controller with fake API, nextStep, explainMastery ↔ SQL constants, labels, error mapping, routes, fixture honesty/isolation).
`node scripts_audit.js` → import/export, server/client boundary, route duplicates, TODO/FIXME, fixture-wording, link scan.
