// Single source of truth for WHO may EXECUTE each function in schema public. build_privileges.js turns this into
// migrations/014_function_privileges.sql and docs/SECURITY_FUNCTION_MATRIX.md, and tests/study/security.test.ts fails if a function exists in
// the migrations but is missing here (a new function must be classified before it can ship).
// classes: rpc (client RPC) | admin (client RPC, admin check inside) | rls (used by RLS policies) | pure (no data access / own-row only)
//          trigger (never called directly) | internal (called only by other SECURITY DEFINER code) | service (service_role only)
const C = (cls, purpose, risk) => ({ cls, purpose, risk });
const rpc = (p, r = "Low: derives the user from auth.uid(); ownership enforced in the body") => C("rpc", p, r);
const admin = (p) => C("admin", p, "Medium: is_admin() checked first (errcode 42501); only admins can change curriculum state");
const rls = (p) => C("rls", p, "Low: returns a boolean about published/visible content; reveals nothing beyond what RLS already allows");
const pure = (p) => C("pure", p, "None: pure function or reads only the caller's own row");
const trig = (p) => C("trigger", p, "None: cannot be called as a function (returns trigger)");
const internal = (p, r) => C("internal", p, r || "High if exposed: takes a user/session id as a parameter and bypasses RLS, so it is NOT executable by clients");
const service = (p) => C("service", p, "Medium: maintenance only; service_role key never reaches the browser");

module.exports = {
  // --- client RPCs ---
  set_progress: rpc("Set completion/confidence/status on one item for the caller"),
  study_start: rpc("Start (or return the existing) study session for an item"), study_pause: rpc("Pause the caller's session"), study_resume: rpc("Resume the caller's session"),
  study_heartbeat: rpc("Keep the caller's session alive; server credits time"), study_finish: rpc("Close the caller's session once (idempotent)"), study_recover: rpc("Return the caller's open session, after closing stale ones"),
  schedule_revision: rpc("Create a revision schedule for an item the caller has started"), review_revision: rpc("Rate a revision; the ladder advances in SQL (expected_step guards double submits)"),
  start_practice: rpc("Create a practice session: ordered, snapshotted question ids"), practice_state: rpc("The caller's practice session (ids, answered summary; no keys)"),
  practice_question: rpc("One question of the caller's session; answer, explanation and topic only after it is answered"), practice_options: rpc("Counts/difficulties/papers a scope can offer"),
  submit_pyq_answer: rpc("Grade one answer on the server; one attempt per question per session", "Medium-low: server derives correctness; session/question ownership and membership checked; duplicate returns the original"),
  finish_practice: rpc("Close a practice session and return the server-computed summary"),
  topic_pyqs: rpc("List linked questions of a topic (no key columns)", "Low: SECURITY INVOKER, RLS applies"), topic_pyq_stats: rpc("Per-topic PYQ count and the caller's attempts", "Low: SECURITY INVOKER, RLS applies"),
  subject_pyq_counts: rpc("PYQ counts per topic of a subject", "Low: SECURITY INVOKER, RLS applies"), global_search: rpc("Search the syllabus and the caller's own notes/resources/tasks", "Low: SECURITY INVOKER, RLS applies; archived/unpublished hidden for non-admins"),
  user_entity_signals: rpc("Mastery, weak reason, counts, revision state per item", "Low: SECURITY INVOKER, own rows via RLS"), daily_focus: rpc("Deterministic focus list", "Low: SECURITY INVOKER"),
  dashboard_summary: rpc("Dashboard numbers", "Low: SECURITY INVOKER"), active_entities: rpc("Live, published, non-archived entities", "Low: SECURITY INVOKER"),
  revision_queue: rpc("The caller's open revisions: bucket (overdue/today/upcoming), ordering and per-item signals", "Low: SECURITY INVOKER, own rows via RLS"),
  // --- admin RPCs ---
  set_publish_status: admin("Move a book/exam through draft, review, published, archived"), verify_source: admin("Mark a source verified (trust flag)"), set_exam_official: admin("Mark an exam version official (needs verified source + URL)"),
  import_create_run: admin("Create an import run"), import_stage_rows: admin("Stage rows of a run"), import_validate_run: admin("Validate a run"), import_apply_run: admin("Apply a validated run as DRAFT content"), import_discard_run: admin("Discard a run"),
  // --- RLS helpers ---
  is_admin: C("rls", "Is the caller an admin? (policies and admin RPCs)", "Low: returns only the caller's own flag; SECURITY DEFINER so it never re-enters a profiles policy"),
  is_book_visible: rls("Visibility check for policies"), is_chapter_visible: rls("Visibility check for policies"), is_exam_visible: rls("Visibility check for policies"), is_tier_visible: rls("Visibility check for policies"),
  is_ssc_subject_visible: rls("Visibility check for policies"), is_topic_visible: rls("Visibility check for policies"),
  // --- pure / own-row helpers (INVOKER functions call each other with the caller's rights, so these must stay executable) ---
  app_now: pure("The clock RPCs use (test pin only via server-side GUCs)"), user_today: pure("Caller's local date"), _user_tz: pure("Caller's own time zone"), _require_uid: pure("auth.uid() or raise"),
  search_rank: pure("Ranking helper"), priority_rank: pure("Ranking helper"), learning_weak_reason: pure("Pure rule"), learning_mastery: pure("Pure rule (mirrors lib/learning)"),
  revision_next: pure("Pure ladder arithmetic"), _ladder: pure("Pure ladder arithmetic"), pyq_answer_valid: pure("Checks an options/key pair (used by CHECK constraint)"),
  lc_min_attempts: pure("Learning constant"), lc_recent_window: pure("Learning constant"), lc_weak_accuracy: pure("Learning constant"), lc_strong_accuracy: pure("Learning constant"),
  lc_mastered_accuracy: pure("Learning constant"), lc_weak_confidence: pure("Learning constant"), lc_strong_confidence: pure("Learning constant"), lc_hard_streak: pure("Learning constant"),
  lc_default_ladder: pure("Learning constant"), lc_max_intervals: pure("Learning constant"), lc_max_interval_days: pure("Learning constant"), lc_step_good: pure("Learning constant"),
  lc_step_easy: pure("Learning constant"), lc_stale_seconds: pure("Learning constant"), lc_stale_credit_seconds: pure("Learning constant"), lc_min_session_seconds: pure("Learning constant"),
  lc_max_session_seconds: pure("Learning constant"), lc_focus_max: pure("Learning constant"),
  // --- triggers ---
  handle_new_user: trig("Create the profile row for a new auth user"), profiles_guard: trig("Stop clients changing protected profile columns"), touch_updated_at: trig("updated_at maintenance"),
  forbid_official_delete: trig("Official curriculum is archived, never deleted"), tasks_completed_at: trig("completed_at maintenance"), entity_register: trig("Keep the entity registry in sync"),
  entity_unregister: trig("Keep the entity registry in sync"), revision_reviews_append_only: trig("Revision history is append-only"), progress_seed_revision: trig("Seed a revision on the first completion"),
  pyqs_set_hash: trig("Maintain content_hash"), enforce_publish_rules: trig("Imports land as draft; publishing rules"), guard_trust_flags: trig("Trust flags change only through the admin workflow"),
  // --- internal (SECURITY DEFINER helpers that take ids) ---
  // (the old public touch_streak() was already dropped in 007; a client-callable streak bump would let users fake study days)
  _touch_streak: internal("Streak update for a given user/day"), entity_accessible: internal("Can this user study/practise this item?"), _close_session: internal("Close a session by id (applies counters/streak)"),
  _recover_stale: internal("Close stale sessions of a user"), _seed_revision: internal("Create a schedule for a given user"), _open_weakness_revision: internal("Open a weakness revision for a given user"),
  _ensure_topic_progress: internal("Mark a topic started for a given user"), _practice_candidates: internal("Ordered candidate questions for a given user (reads answer keys)"),
  _practice_check_scope: internal("Validate a practice scope for a given user"), _practice_json: internal("Serialise a practice session (called by SECURITY DEFINER functions)", "Low: pure serialiser, but only meaningful inside the RPCs"),
  _segment_credit: internal("Credit calculation (called by SECURITY DEFINER functions)", "Low: pure"), _session_json: internal("Serialise a study session", "Low: pure serialiser"),
  _import_err: internal("Error builder for imports", "Low"), _import_admin: internal("Admin guard used inside import RPCs", "Low"),
  _import_chapter_matches: internal("Match staged rows to chapters"), _import_topic_matches: internal("Match staged rows to topics"),
  // --- service role only ---
  study_sweep_stale: service("Close abandoned sessions for ALL users (scheduled job)"), entities_integrity_report: service("Registry integrity report across users"),
};
