-- PHASE 4 DATABASE TEST SUITE — SQL NOT EXECUTED when this was written (no Postgres available). Run after migrations 001-011.
-- One transaction, ends in ROLLBACK. The clock is pinned with app_now()'s test GUCs so every duration is deterministic.
-- Read the final result table: every row must say PASS. Fixtures use "TEST ..." names and are rolled back.
begin;
create temp table t_results (n serial, label text, passed boolean, detail text);
create temp table t_runs (k text primary key, id uuid);
create temp table t_ret (k text primary key, n bigint);                      -- results of actions run in their OWN statement (see the visibility note below)
create temp table t_errors (n serial, uid uuid, sqlstate text, message text, stmt text);   -- every error the helpers swallowed (kept for diagnostics; the kit prints it as CGL_ERR lines)

-- HARNESS RULES (learned from the first real runs):
--  1. A SELECT cannot see rows written by a VOLATILE function called in the SAME statement. Never write `rows_as(<write>) >= 0 and (select <read of what it wrote>)`:
--     run the action in its own statement (`insert into t_ret select k, rows_as(...)`) and check the resulting state in the NEXT statement.
--  2. `select count(*) from (select stable_fn(...)) q` never EVALUATES a STABLE/IMMUTABLE function nobody reads (no error, no privilege check). rows_as therefore
--     consumes every output column (count of the row text), so errors and EXECUTE-privilege failures of STABLE functions are really observed.

-- rows visible / affected for a statement run AS a user (null = anon), or -1 if it raised (the error is recorded in t_errors).
create or replace function pg_temp.rows_as(uid uuid, stmt text) returns bigint language plpgsql as $$
declare n bigint; v_state text; v_msg text;
begin
  perform set_config('request.jwt.claims', case when uid is null then '' else json_build_object('sub', uid, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute case when uid is null then 'set local role anon' else 'set local role authenticated' end;
  begin
    if lower(ltrim(stmt)) like 'select%' then execute 'select count(t) from (select q::text as t from (' || stmt || ') q) z' into n;
    else execute stmt; get diagnostics n = row_count; end if;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; n := -1;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  if n = -1 then insert into t_errors (uid, sqlstate, message, stmt) values (uid, v_state, v_msg, left(regexp_replace(stmt, '\s+', ' ', 'g'), 240)); end if;
  return n;
end $$;
-- first column of first row as text (NULL on error / no rows)
create or replace function pg_temp.val_as(uid uuid, stmt text) returns text language plpgsql as $$
declare v text; v_state text; v_msg text; v_err boolean := false;
begin
  perform set_config('request.jwt.claims', case when uid is null then '' else json_build_object('sub', uid, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute case when uid is null then 'set local role anon' else 'set local role authenticated' end;
  begin execute 'select x::text from (' || stmt || ') q(x) limit 1' into v;
  exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; v := null; v_err := true; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  if v_err then insert into t_errors (uid, sqlstate, message, stmt) values (uid, v_state, v_msg, left(regexp_replace(stmt, '\s+', ' ', 'g'), 240)); end if;
  return v;
end $$;
-- run as the session owner (bypasses RLS, no JWT): rows affected or -1 on error
create or replace function pg_temp.owner_try(stmt text) returns bigint language plpgsql as $$
declare n bigint; v_state text; v_msg text;
begin
  begin execute stmt; get diagnostics n = row_count;
  exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; n := -1; end;
  if n = -1 then insert into t_errors (uid, sqlstate, message, stmt) values (null, v_state, v_msg, left(regexp_replace(stmt, '\s+', ' ', 'g'), 240)); end if;
  return n;
end $$;
create or replace function pg_temp.check_(label text, cond boolean, detail text default null) returns void language plpgsql as $$
begin insert into t_results (label, passed, detail) values (label, coalesce(cond, false), detail); end $$;
create or replace function pg_temp.set_now(ts text) returns void language plpgsql as $$
begin perform set_config('app.allow_test_clock', 'on', true); perform set_config('app.test_now', ts, true); end $$;

select pg_temp.set_now('2026-10-01 12:00:00+00');      -- 17:30 in Asia/Kolkata: local date 2026-10-01

-- ---------------- users: A, B normal; C admin; D custom-content deletion; E revision-history deletion; F signals scenario ----------------
insert into auth.users (id, aud, role, email) values
  ('eda6c4d2-347b-52c8-92c4-bd428277acd4','authenticated','authenticated','a@test.local'), ('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed','authenticated','authenticated','b@test.local'), ('b2251d3c-7aed-5d3b-bb07-97b3955353d1','authenticated','authenticated','c@test.local'),
  ('dd8bf13c-afd3-55de-baa3-ebe7023bb7ce','authenticated','authenticated','d@test.local'), ('b21625f9-8563-531b-be14-6b7f593a1386','authenticated','authenticated','e@test.local'), ('169cdb0c-67ce-5430-9955-84300141af00','authenticated','authenticated','f@test.local');
update profiles set is_admin = true where id = 'b2251d3c-7aed-5d3b-bb07-97b3955353d1';       -- owner path: no JWT, so the guard allows it

-- ---------------- curriculum fixtures (inserted as owner; status set explicitly, owner bypasses the draft-on-insert rule) ----------------
insert into sources (id, name, source_url) values ('eb424051-fc9e-5703-85b7-4a0069f25278', 'TEST source', 'https://example.test/source'), ('72a81bcc-e8fb-5a14-b351-3ba6b50baadd', 'TEST source 2', null);
insert into classes (id, grade) values ('fb5f25f0-3b05-5ed1-96da-54a85b4acf1e', 6);
insert into subjects (id, class_id, name) values ('10f0ecb3-91d2-5665-918d-cd0db35ae41d', 'fb5f25f0-3b05-5ed1-96da-54a85b4acf1e', 'TEST subject');
insert into books (id, subject_id, source_id, title, status) values ('c199e71a-db01-5359-b575-151d904fa192', '10f0ecb3-91d2-5665-918d-cd0db35ae41d', 'eb424051-fc9e-5703-85b7-4a0069f25278', 'TEST book', 'published');
insert into chapters (id, book_id, number, title) values ('17277ef4-ed1d-5063-9ec5-55919f09e403', 'c199e71a-db01-5359-b575-151d904fa192', 1, 'TEST official chapter'), ('dd124977-1642-564e-8776-86a09a5ccdbf', 'c199e71a-db01-5359-b575-151d904fa192', 2, 'TEST unmapped chapter');
insert into ssc_exams (id, exam_version, source_id, status) values ('a9bf7926-de18-5045-b7dd-86ddeec8e566', 'TEST', 'eb424051-fc9e-5703-85b7-4a0069f25278', 'published');
insert into ssc_tiers (id, exam_id, name) values ('22a043c4-9517-55a8-91b8-a00922343ab2', 'a9bf7926-de18-5045-b7dd-86ddeec8e566', 'TEST tier');
insert into ssc_subjects (id, tier_id, name) values ('a3acba5a-8f9d-55b0-b7dd-8e359ac3e7d6', '22a043c4-9517-55a8-91b8-a00922343ab2', 'TEST ssc subject');
insert into ssc_topics (id, subject_id, title, priority, position) values
  ('f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'a3acba5a-8f9d-55b0-b7dd-8e359ac3e7d6', 'TEST official topic', 'high', 1), ('21ef5dcf-fc38-5b60-9404-dc99fea1f286', 'a3acba5a-8f9d-55b0-b7dd-8e359ac3e7d6', 'TEST second topic', 'medium', 2), ('ee476413-2e8e-5c56-bbf5-b6cf5bdb2876', 'a3acba5a-8f9d-55b0-b7dd-8e359ac3e7d6', 'TEST third topic', 'high', 3);
insert into ssc_subtopics (id, topic_id, title) values ('4654f3fc-fa66-5d7d-9e71-91c21c483300', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'TEST subtopic one'), ('eebfdd69-ca02-5ff1-ae3f-1cf817ae21e4', '21ef5dcf-fc38-5b60-9404-dc99fea1f286', 'TEST subtopic two');
insert into ncert_ssc_mappings (id, ncert_chapter_id, ssc_topic_id, mapping_type, relevance, recommended) values ('1419c6dc-bb1d-59f4-8631-4a3c5e01e0d0', '17277ef4-ed1d-5063-9ec5-55919f09e403', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'foundation', 'high', true);
insert into exam_papers (id, exam, year, tier) values ('45075014-9a46-5d77-9064-50eb4f553616', 'SSC CGL', 2020, 'Tier I'), ('14901406-fdf3-5de1-a2b2-692f750c1df5', 'SSC CGL', 2021, 'Tier I');
insert into pyqs (id, paper_id, question, options, correct_answer, explanation, difficulty_level) values
  ('6923f5c9-c73b-50f3-aef9-ac779ca167bf', '45075014-9a46-5d77-9064-50eb4f553616', 'TEST question one', '{"A":"a1","B":"b1","C":"c1","D":"d1"}', 'B', 'because b', 'medium'),
  ('07eb48c9-f9a3-509c-b73e-b75054a43319', '14901406-fdf3-5de1-a2b2-692f750c1df5', 'TEST question two', '{"A":"a2","B":"b2","C":"c2","D":"d2"}', 'A', 'because a', 'easy'),
  ('538b4267-45b8-521c-afd0-73e417e5dccc', '45075014-9a46-5d77-9064-50eb4f553616', 'TEST question three', '{"A":"a3","B":"b3","C":"c3","D":"d3"}', 'C', 'because c', 'hard');
insert into pyq_topics (pyq_id, ssc_topic_id) values ('6923f5c9-c73b-50f3-aef9-ac779ca167bf','f1ce1c0d-5eed-5602-b11f-afc5a71e886e'), ('07eb48c9-f9a3-509c-b73e-b75054a43319','f1ce1c0d-5eed-5602-b11f-afc5a71e886e'), ('538b4267-45b8-521c-afd0-73e417e5dccc','21ef5dcf-fc38-5b60-9404-dc99fea1f286');
insert into pyq_subtopics (pyq_id, ssc_topic_id, ssc_subtopic_id) values ('6923f5c9-c73b-50f3-aef9-ac779ca167bf','f1ce1c0d-5eed-5602-b11f-afc5a71e886e','4654f3fc-fa66-5d7d-9e71-91c21c483300');
-- a DRAFT book / exam (invisible to normal users)
insert into books (id, subject_id, title, status) values ('8e13634d-020d-5112-9139-869a20128d95', '10f0ecb3-91d2-5665-918d-cd0db35ae41d', 'TEST draft book', 'draft');
insert into chapters (id, book_id, title) values ('32f2c6be-9cba-573e-aece-f70dd81e2320', '8e13634d-020d-5112-9139-869a20128d95', 'TEST draft chapter');
insert into ssc_exams (id, exam_version, status) values ('cde61646-7000-5450-aa81-6ead9f1aabf9', 'TESTDRAFT', 'draft');

-- ---- SEC catalog (generated by scripts/validate/sqlbuild.mjs from function_matrix.js; 98 functions) ----
create temp table t_fn_expect (sig text, name text, cls text, auth_exec boolean, svc_only boolean);
insert into t_fn_expect values
  ('public.handle_new_user()', 'handle_new_user', 'trigger', false, false),
  ('public.is_admin()', 'is_admin', 'rls', true, false),
  ('public.profiles_guard()', 'profiles_guard', 'trigger', false, false),
  ('public.search_rank(text,text,text,text)', 'search_rank', 'pure', true, false),
  ('public.topic_pyq_stats(uuid)', 'topic_pyq_stats', 'rpc', true, false),
  ('public.subject_pyq_counts(uuid)', 'subject_pyq_counts', 'rpc', true, false),
  ('public.app_now()', 'app_now', 'pure', true, false),
  ('public.user_today(uuid)', 'user_today', 'pure', true, false),
  ('public.lc_min_attempts()', 'lc_min_attempts', 'pure', true, false),
  ('public.lc_recent_window()', 'lc_recent_window', 'pure', true, false),
  ('public.lc_weak_accuracy()', 'lc_weak_accuracy', 'pure', true, false),
  ('public.lc_strong_accuracy()', 'lc_strong_accuracy', 'pure', true, false),
  ('public.lc_mastered_accuracy()', 'lc_mastered_accuracy', 'pure', true, false),
  ('public.lc_weak_confidence()', 'lc_weak_confidence', 'pure', true, false),
  ('public.lc_strong_confidence()', 'lc_strong_confidence', 'pure', true, false),
  ('public.lc_hard_streak()', 'lc_hard_streak', 'pure', true, false),
  ('public.lc_default_ladder()', 'lc_default_ladder', 'pure', true, false),
  ('public.lc_max_intervals()', 'lc_max_intervals', 'pure', true, false),
  ('public.lc_max_interval_days()', 'lc_max_interval_days', 'pure', true, false),
  ('public.lc_step_good()', 'lc_step_good', 'pure', true, false),
  ('public.lc_step_easy()', 'lc_step_easy', 'pure', true, false),
  ('public.lc_stale_seconds()', 'lc_stale_seconds', 'pure', true, false),
  ('public.lc_stale_credit_seconds()', 'lc_stale_credit_seconds', 'pure', true, false),
  ('public.lc_min_session_seconds()', 'lc_min_session_seconds', 'pure', true, false),
  ('public.lc_max_session_seconds()', 'lc_max_session_seconds', 'pure', true, false),
  ('public.lc_focus_max()', 'lc_focus_max', 'pure', true, false),
  ('public.touch_updated_at()', 'touch_updated_at', 'trigger', false, false),
  ('public.forbid_official_delete()', 'forbid_official_delete', 'trigger', false, false),
  ('public.tasks_completed_at()', 'tasks_completed_at', 'trigger', false, false),
  ('public.entity_register()', 'entity_register', 'trigger', false, false),
  ('public.entity_unregister()', 'entity_unregister', 'trigger', false, false),
  ('public.entities_integrity_report()', 'entities_integrity_report', 'service', false, true),
  ('public._require_uid()', '_require_uid', 'pure', true, false),
  ('public._user_tz(uuid)', '_user_tz', 'pure', true, false),
  ('public._touch_streak(uuid,date)', '_touch_streak', 'internal', false, false),
  ('public.entity_accessible(public.entity_t,uuid,uuid)', 'entity_accessible', 'internal', false, false),
  ('public.set_progress(public.entity_t,uuid,text,int,int)', 'set_progress', 'rpc', true, false),
  ('public._segment_credit(public.study_sessions,timestamptz)', '_segment_credit', 'internal', false, false),
  ('public._session_json(public.study_sessions,timestamptz)', '_session_json', 'internal', false, false),
  ('public._close_session(uuid,public.session_state_t,timestamptz)', '_close_session', 'internal', false, false),
  ('public._recover_stale(uuid,timestamptz)', '_recover_stale', 'internal', false, false),
  ('public.study_start(public.entity_t,uuid)', 'study_start', 'rpc', true, false),
  ('public.study_pause(uuid)', 'study_pause', 'rpc', true, false),
  ('public.study_resume(uuid)', 'study_resume', 'rpc', true, false),
  ('public.study_heartbeat(uuid)', 'study_heartbeat', 'rpc', true, false),
  ('public.study_finish(uuid,int)', 'study_finish', 'rpc', true, false),
  ('public.study_recover()', 'study_recover', 'rpc', true, false),
  ('public.study_sweep_stale()', 'study_sweep_stale', 'service', false, true),
  ('public.revision_reviews_append_only()', 'revision_reviews_append_only', 'trigger', false, false),
  ('public.revision_next(int,text,int[],date)', 'revision_next', 'pure', true, false),
  ('public._ladder(uuid)', '_ladder', 'pure', true, false),
  ('public._seed_revision(uuid,public.entity_t,uuid,text)', '_seed_revision', 'internal', false, false),
  ('public.progress_seed_revision()', 'progress_seed_revision', 'trigger', false, false),
  ('public._open_weakness_revision(uuid,public.entity_t,uuid)', '_open_weakness_revision', 'internal', false, false),
  ('public.schedule_revision(public.entity_t,uuid)', 'schedule_revision', 'rpc', true, false),
  ('public.review_revision(uuid,text,int,int)', 'review_revision', 'rpc', true, false),
  ('public.pyq_answer_valid(jsonb,text)', 'pyq_answer_valid', 'pure', true, false),
  ('public.pyqs_set_hash()', 'pyqs_set_hash', 'trigger', false, false),
  ('public._ensure_topic_progress(uuid,uuid,timestamptz)', '_ensure_topic_progress', 'internal', false, false),
  ('public._practice_json(public.practice_sessions)', '_practice_json', 'internal', false, false),
  ('public.practice_state(uuid)', 'practice_state', 'rpc', true, false),
  ('public.submit_pyq_answer(uuid,uuid,text,int)', 'submit_pyq_answer', 'rpc', true, false),
  ('public.finish_practice(uuid,boolean)', 'finish_practice', 'rpc', true, false),
  ('public.topic_pyqs(uuid,int)', 'topic_pyqs', 'rpc', true, false),
  ('public.priority_rank(public.priority_t)', 'priority_rank', 'pure', true, false),
  ('public.learning_weak_reason(int,numeric,int,text[])', 'learning_weak_reason', 'pure', true, false),
  ('public.learning_mastery(text,int,int,int,int,numeric,date,date,text[],int,boolean)', 'learning_mastery', 'pure', true, false),
  ('public.active_entities()', 'active_entities', 'rpc', true, false),
  ('public.user_entity_signals(public.entity_t,uuid)', 'user_entity_signals', 'rpc', true, false),
  ('public.daily_focus(int)', 'daily_focus', 'rpc', true, false),
  ('public.dashboard_summary()', 'dashboard_summary', 'rpc', true, false),
  ('public.enforce_publish_rules()', 'enforce_publish_rules', 'trigger', false, false),
  ('public.guard_trust_flags()', 'guard_trust_flags', 'trigger', false, false),
  ('public.set_publish_status(text,uuid,public.publish_status_t)', 'set_publish_status', 'admin', true, false),
  ('public.verify_source(uuid,boolean)', 'verify_source', 'admin', true, false),
  ('public.set_exam_official(uuid,boolean)', 'set_exam_official', 'admin', true, false),
  ('public.is_book_visible(uuid)', 'is_book_visible', 'rls', true, false),
  ('public.is_chapter_visible(uuid)', 'is_chapter_visible', 'rls', true, false),
  ('public.is_exam_visible(uuid)', 'is_exam_visible', 'rls', true, false),
  ('public.is_tier_visible(uuid)', 'is_tier_visible', 'rls', true, false),
  ('public.is_ssc_subject_visible(uuid)', 'is_ssc_subject_visible', 'rls', true, false),
  ('public.is_topic_visible(uuid)', 'is_topic_visible', 'rls', true, false),
  ('public._import_err(text,text)', '_import_err', 'internal', false, false),
  ('public._import_admin()', '_import_admin', 'internal', false, false),
  ('public.import_create_run(text,text,jsonb,boolean)', 'import_create_run', 'admin', true, false),
  ('public.import_stage_rows(uuid,text,jsonb)', 'import_stage_rows', 'admin', true, false),
  ('public._import_chapter_matches(uuid,text,text,text,text,text)', '_import_chapter_matches', 'internal', false, false),
  ('public._import_topic_matches(uuid,text,text,text,text,text)', '_import_topic_matches', 'internal', false, false),
  ('public.import_validate_run(uuid)', 'import_validate_run', 'admin', true, false),
  ('public.import_apply_run(uuid)', 'import_apply_run', 'admin', true, false),
  ('public.import_discard_run(uuid)', 'import_discard_run', 'admin', true, false),
  ('public._practice_candidates(uuid,text,uuid,int,public.difficulty_t,uuid)', '_practice_candidates', 'internal', false, false),
  ('public._practice_check_scope(uuid,text,uuid)', '_practice_check_scope', 'internal', false, false),
  ('public.start_practice(text,uuid,int,public.difficulty_t,uuid)', 'start_practice', 'rpc', true, false),
  ('public.practice_options(text,uuid)', 'practice_options', 'rpc', true, false),
  ('public.practice_question(uuid,uuid)', 'practice_question', 'rpc', true, false),
  ('public.global_search(text,int)', 'global_search', 'rpc', true, false),
  ('public.revision_queue()', 'revision_queue', 'rpc', true, false);

-- ============ SECURITY REGRESSION PACKAGE ============
-- SQL NOT EXECUTED when written (no Postgres available). Built into security_all.sql by scripts/validate/sqlbuild.mjs: harness (users A,B normal; C admin; fixtures T1 with Q1+Q2,
-- CH1/CH2, BK1 ...) + the generated catalog table t_fn_expect + this file. One transaction, ends in ROLLBACK. Run after migrations 001-014 on a SCRATCH database.
select pg_temp.set_now('2026-10-01 12:00:00+00');

-- ============ A. function execution catalog (generated from function_matrix.js) ============
select pg_temp.check_('SEC every classified function exists with exactly that signature', (select count(*) = 0 from t_fn_expect e where to_regprocedure(e.sig) is null),
  (select string_agg(e.sig, '; ') from t_fn_expect e where to_regprocedure(e.sig) is null));
select pg_temp.check_('SEC every function we own in schema public is classified (nothing unreviewed is callable)', (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') and p.oid not in (select to_regprocedure(e.sig)::oid from t_fn_expect e where to_regprocedure(e.sig) is not null)),
  (select string_agg(p.oid::regprocedure::text, '; ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') and p.oid not in (select to_regprocedure(e.sig)::oid from t_fn_expect e where to_regprocedure(e.sig) is not null)));
select pg_temp.check_('SEC anon cannot execute ANY classified function', (select count(*) = 0 from t_fn_expect e where to_regprocedure(e.sig) is not null and has_function_privilege('anon', to_regprocedure(e.sig), 'execute')),
  (select string_agg(e.sig, '; ') from t_fn_expect e where to_regprocedure(e.sig) is not null and has_function_privilege('anon', to_regprocedure(e.sig), 'execute')));
select pg_temp.check_('SEC PUBLIC cannot execute ANY classified function', (select count(*) = 0 from t_fn_expect e where to_regprocedure(e.sig) is not null and has_function_privilege('public', to_regprocedure(e.sig), 'execute')),
  (select string_agg(e.sig, '; ') from t_fn_expect e where to_regprocedure(e.sig) is not null and has_function_privilege('public', to_regprocedure(e.sig), 'execute')));
select pg_temp.check_('SEC authenticated can execute exactly the allow-listed functions (client RPCs, RLS helpers, pure helpers)', (select count(*) = 0 from t_fn_expect e where to_regprocedure(e.sig) is not null and has_function_privilege('authenticated', to_regprocedure(e.sig), 'execute') <> e.auth_exec),
  (select string_agg(e.sig || ' expected=' || e.auth_exec, '; ') from t_fn_expect e where to_regprocedure(e.sig) is not null and has_function_privilege('authenticated', to_regprocedure(e.sig), 'execute') <> e.auth_exec));
select pg_temp.check_('SEC service-only functions: service_role yes, authenticated no', (select count(*) = 0 from t_fn_expect e where e.svc_only and (has_function_privilege('authenticated', to_regprocedure(e.sig), 'execute') or not has_function_privilege('service_role', to_regprocedure(e.sig), 'execute'))));
select pg_temp.check_('SEC every SECURITY DEFINER function pins search_path', (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')), (select string_agg(p.oid::regprocedure::text, '; ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')));
-- INPUT arguments only. pg_proc.proargnames also lists OUT / TABLE(...) result columns (revision_queue, user_entity_signals, dashboard_summary, topic_pyq_stats ... return columns such as
-- accuracy, seconds_spent, streak); those are outputs, not inputs, and must not be inspected here. proargmodes: NULL = all inputs; i = IN, b = INOUT, v = VARIADIC are inputs.
create or replace function pg_temp.input_arg_names(p_oid oid) returns text[] language sql as $$
  select coalesce(array_agg(a.n order by a.ord), '{}') from pg_proc pr, unnest(pr.proargnames) with ordinality as a(n, ord)
   where pr.oid = p_oid and (pr.proargmodes is null or (pr.proargmodes)[a.ord] in ('i', 'b', 'v')) $$;
select pg_temp.check_('SEC no client RPC takes an INPUT that the server must own (time, duration, interval, due date, correctness, mastery, score), except the documented telemetry below', (select count(*) = 0 from t_fn_expect e
   cross join lateral unnest(pg_temp.input_arg_names(to_regprocedure(e.sig)::oid)) as a(name) where e.cls = 'rpc' and a.name ~* '(^|_)(now|seconds|elapsed|duration|started|ended|is_correct|correct|mastery|interval|due|due_date|score|accuracy|streak)(_|$)'
     and not (e.name = 'submit_pyq_answer' and a.name = 'p_time_seconds')),
  (select string_agg(e.sig || ' input ' || a.name, '; ') from t_fn_expect e cross join lateral unnest(pg_temp.input_arg_names(to_regprocedure(e.sig)::oid)) as a(name) where e.cls = 'rpc' and a.name ~* '(^|_)(now|seconds|elapsed|duration|started|ended|is_correct|correct|mastery|interval|due|due_date|score|accuracy|streak)(_|$)' and not (e.name = 'submit_pyq_answer' and a.name = 'p_time_seconds')));
select pg_temp.check_('SEC the check inspects inputs only: revision_queue/user_entity_signals/dashboard_summary/topic_pyq_stats have RETURN columns with such names but no such INPUT', (select count(*) > 0 from pg_proc p where p.proname in ('revision_queue', 'user_entity_signals', 'dashboard_summary', 'topic_pyq_stats') and exists (select 1 from unnest(p.proargnames) n where n ~* '(^|_)(accuracy|seconds|streak|correct|attempts)(_|$)'))
   and (select count(*) = 0 from pg_proc p cross join lateral unnest(pg_temp.input_arg_names(p.oid)) a(n) where p.proname in ('revision_queue', 'dashboard_summary') ));
-- submit_pyq_answer(p_time_seconds) is INFORMATIONAL telemetry by design (009): stored in pyq_attempts.time_taken_seconds, clamped to [0, 7200] and to the session's own elapsed time + 5 s, and never used for grading,
-- accuracy, mastery or scheduling. This proves the shape of that exception so it cannot silently become authoritative.
select pg_temp.check_('SEC p_time_seconds of submit_pyq_answer is clamped server-side and used ONLY to fill time_taken_seconds', (select (length(d) - length(replace(d, 'p_time_seconds', ''))) / length('p_time_seconds') = 2 and d ~ 'least\(greatest\(coalesce\(p_time_seconds, 0\), 0\), 7200, floor\(extract\(epoch from \(v_now - s\.started_at\)\)\)::int \+ 5\)'
    from (select pg_get_functiondef(to_regprocedure('public.submit_pyq_answer(uuid, uuid, text, int)')) as d) q));
select pg_temp.check_('SEC every client-callable SECURITY DEFINER RPC/admin function derives identity from auth.uid()/_require_uid()/is_admin() (no caller-supplied user id)', (select count(*) = 0 from t_fn_expect e join pg_proc p on p.oid = to_regprocedure(e.sig)
   where e.cls in ('rpc', 'admin') and p.prosecdef and pg_get_functiondef(p.oid) !~ '(auth\.uid\(\)|_require_uid\(\)|is_admin\(\)|_import_admin\(\))'),
  (select string_agg(e.sig, '; ') from t_fn_expect e join pg_proc p on p.oid = to_regprocedure(e.sig) where e.cls in ('rpc', 'admin') and p.prosecdef and pg_get_functiondef(p.oid) !~ '(auth\.uid\(\)|_require_uid\(\)|is_admin\(\)|_import_admin\(\))'));
select pg_temp.check_('SEC no client RPC takes a user id parameter (p_uid / p_user)', (select count(*) = 0 from t_fn_expect e join pg_proc p on p.oid = to_regprocedure(e.sig) where e.cls in ('rpc', 'admin') and exists (select 1 from unnest(coalesce(p.proargnames, '{}')) a where a in ('p_uid', 'p_user', 'p_user_id', 'uid', 'user_id'))));

-- table-level catalog checks (RLS coverage and grants), independent of fixtures
select pg_temp.check_('SEC every table in schema public has row level security enabled (the kit''s own ledger table excepted)', (select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity and c.relname <> '_cgl_validation_ledger'),
  (select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity and c.relname <> '_cgl_validation_ledger'));
select pg_temp.check_('SEC anon holds no privilege on any table in schema public', (select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')),
  (select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')));
select pg_temp.check_('SEC server-owned tables grant authenticated nothing but SELECT (all writes go through RPCs)', (select count(*) = 0 from unnest(array['user_progress', 'study_sessions', 'revision_schedule', 'revision_reviews', 'pyq_attempts', 'practice_sessions']) t
   where has_table_privilege('authenticated', 'public.' || t, 'insert,update,delete,truncate') or not has_table_privilege('authenticated', 'public.' || t, 'select')));
select pg_temp.check_('SEC authenticated cannot TRUNCATE any table in schema public', (select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> '_cgl_validation_ledger' and has_table_privilege('authenticated', c.oid, 'truncate')),
  (select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> '_cgl_validation_ledger' and has_table_privilege('authenticated', c.oid, 'truncate')));

-- ============ B. anonymous access ============
select pg_temp.check_('SEC anon: no user data table is readable', pg_temp.rows_as(null, $$select * from user_progress$$) = -1 and pg_temp.rows_as(null, $$select * from revision_schedule$$) = -1 and pg_temp.rows_as(null, $$select * from revision_reviews$$) = -1
  and pg_temp.rows_as(null, $$select * from study_sessions$$) = -1 and pg_temp.rows_as(null, $$select * from practice_sessions$$) = -1 and pg_temp.rows_as(null, $$select * from pyq_attempts$$) = -1 and pg_temp.rows_as(null, $$select * from profiles$$) = -1);
select pg_temp.check_('SEC anon: curriculum and questions are not readable', pg_temp.rows_as(null, $$select * from chapters$$) = -1 and pg_temp.rows_as(null, $$select * from pyqs$$) = -1 and pg_temp.rows_as(null, $$select * from ncert_ssc_mappings$$) = -1);
select pg_temp.check_('SEC anon: client RPCs cannot be called', pg_temp.rows_as(null, $$select * from public.revision_queue()$$) = -1 and pg_temp.rows_as(null, $$select * from public.daily_focus(3)$$) = -1
  and pg_temp.rows_as(null, $$select public.study_start('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e')$$) = -1 and pg_temp.rows_as(null, $$select public.set_progress('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'completed', 100, 5)$$) = -1 and pg_temp.rows_as(null, $$select public.start_practice('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 5)$$) = -1);

-- ============ C. authenticated, allowed ============
select pg_temp.check_('SEC authenticated: allowed RPCs work for a normal user', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select * from public.revision_queue()$$) >= 0 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select * from public.daily_focus(3)$$) >= 0
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select * from public.user_entity_signals()$$) >= 0 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select * from public.dashboard_summary()$$) >= 0);
-- state for the cross-user tests: A has progress, an open session, an open revision, a practice session
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'learning', 30, 3)$$);
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.study_start('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e')$$);
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.schedule_revision('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e')$$);
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.start_practice('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 5)$$);
insert into t_runs (k, id) select 'sec_sess', id from study_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state in ('active', 'paused') limit 1;
insert into t_runs (k, id) select 'sec_rev', id from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e' and not done;
insert into t_runs (k, id) select 'sec_ps', id from practice_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state = 'active' limit 1;
select pg_temp.check_('SEC fixture: A has a session, an open revision and a practice session', (select count(*) = 3 from t_runs where k in ('sec_sess', 'sec_rev', 'sec_ps')));

-- ============ D. forbidden RPCs ============
select pg_temp.check_('SEC authenticated: internal helpers cannot be called with someone else''s ids', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select public._seed_revision('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'manual')$$) = -1
  and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select public._touch_streak('eda6c4d2-347b-52c8-92c4-bd428277acd4', current_date)$$) = -1 and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public._close_session(%L, 'abandoned', now())$f$, (select id from t_runs where k = 'sec_sess'))) = -1);
select pg_temp.check_('SEC authenticated: service-only jobs cannot be called', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.study_sweep_stale()$$) = -1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select * from public.entities_integrity_report()$$) = -1);
select pg_temp.check_('SEC authenticated: admin RPCs are refused for a normal user', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_publish_status('book', 'c199e71a-db01-5359-b575-151d904fa192', 'archived')$$) = -1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.verify_source('eb424051-fc9e-5703-85b7-4a0069f25278', true)$$) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.import_create_run('x.json', 'abc', '{}'::jsonb, true)$$) = -1);

-- ============ E. cross-user reads ============
select pg_temp.check_('SEC B sees none of A''s rows in any user table', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select * from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = 0 and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select * from study_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = 0
  and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select * from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = 0 and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select * from practice_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = 0
  and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select * from pyq_attempts where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = 0 and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select * from profiles where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = 0);
select pg_temp.check_('SEC B''s queue and signals never include A''s items', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select * from public.revision_queue()$$) = 0 and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select * from public.user_entity_signals() where entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e'$$) = 0);
select pg_temp.check_('SEC B cannot read A''s practice session or its questions', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.practice_state(%L)$f$, (select id from t_runs where k = 'sec_ps'))) = -1
  and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.practice_question(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf')$f$, (select id from t_runs where k = 'sec_ps'))) = -1);

-- ============ F. cross-user writes / session + revision ownership ============
select pg_temp.check_('SEC B cannot write A''s progress (direct write or RPC for A)', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$update user_progress set status = 'completed' where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1 and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$delete from user_progress$$) = -1
  and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$insert into user_progress (user_id, entity_type, entity_id, status) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'ssc_topic', '21ef5dcf-fc38-5b60-9404-dc99fea1f286', 'completed')$$) = -1);
select pg_temp.check_('SEC B cannot pause, resume, heartbeat or finish A''s study session', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.study_pause(%L)$f$, (select id from t_runs where k = 'sec_sess'))) = -1
  and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.study_resume(%L)$f$, (select id from t_runs where k = 'sec_sess'))) = -1 and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.study_heartbeat(%L)$f$, (select id from t_runs where k = 'sec_sess'))) = -1
  and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.study_finish(%L)$f$, (select id from t_runs where k = 'sec_sess'))) = -1);
select pg_temp.check_('SEC B cannot review A''s revision (looks like not found) and A''s row is unchanged', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.review_revision(%L, 'easy', 0)$f$, (select id from t_runs where k = 'sec_rev'))) = -1
  and (select count(*) = 0 from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4') and (select not done and step = 0 from revision_schedule where id = (select id from t_runs where k = 'sec_rev')));
select pg_temp.check_('SEC B cannot submit into, or finish, A''s practice session', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.submit_pyq_answer(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'B', 5)$f$, (select id from t_runs where k = 'sec_ps'))) = -1
  and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.finish_practice(%L, false)$f$, (select id from t_runs where k = 'sec_ps'))) = -1 and (select count(*) = 0 from pyq_attempts where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'));
select pg_temp.check_('SEC B cannot schedule a revision for an item B never started', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select public.schedule_revision('ssc_topic', '21ef5dcf-fc38-5b60-9404-dc99fea1f286')$$) = -1);

-- ============ G. forged progress / mastery / revision interval or date / duration ============
select pg_temp.check_('SEC A cannot write progress, sessions, revisions, reviews or attempts directly', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update user_progress set status = 'completed', completion = 100$$) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into user_progress (user_id, entity_type, entity_id, status) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'ssc_topic', 'ee476413-2e8e-5c56-bbf5-b6cf5bdb2876', 'completed')$$) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update study_sessions set seconds = 99999$$) = -1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update revision_schedule set due_date = date '2030-01-01', interval_days = 1, step = 4$$) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into revision_schedule (user_id, entity_type, entity_id, due_date, interval_days, step) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'ssc_topic', 'ee476413-2e8e-5c56-bbf5-b6cf5bdb2876', current_date, 1, 0)$$) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update revision_reviews set rating = 'easy'$$) = -1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into pyq_attempts (user_id, pyq_id, is_correct) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4', '6923f5c9-c73b-50f3-aef9-ac779ca167bf', true)$$) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update pyq_attempts set is_correct = true$$) = -1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update practice_sessions set pyq_ids = '{}'$$) = -1);
select pg_temp.check_('SEC progress RPC validates its input (bad status / completion / confidence rejected)', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'mastered', 100, 5)$$) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'completed', 150, 5)$$) = -1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'completed', 100, 9)$$) = -1);
select pg_temp.check_('SEC no way to pass an interval or due date to the revision RPCs (unknown named argument fails)', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(p_schedule => %L, p_rating => 'good', p_expected_step => 0, p_due_date => date '2030-01-01')$f$, (select id from t_runs where k = 'sec_rev'))) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(p_schedule => %L, p_rating => 'good', p_expected_step => 0, p_interval_days => 365)$f$, (select id from t_runs where k = 'sec_rev'))) = -1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.schedule_revision('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', date '2030-01-01')$$) = -1);
select pg_temp.check_('SEC no way to pass a duration or timestamp to the study RPCs', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.study_finish(p_session => %L, p_seconds => 99999)$f$, (select id from t_runs where k = 'sec_sess'))) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.study_heartbeat(p_session => %L, p_now => now() + interval '9 hours')$f$, (select id from t_runs where k = 'sec_sess'))) = -1);
select pg_temp.check_('SEC after all attempts A''s revision, session and progress are exactly as the server left them', (select step = 0 and not done from revision_schedule where id = (select id from t_runs where k = 'sec_rev'))
  and (select state in ('active', 'paused') from study_sessions where id = (select id from t_runs where k = 'sec_sess')) and (select completion = 30 and status = 'learning' from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e'));
select pg_temp.check_('SEC revision history is append-only for everyone, including the table owner', pg_temp.owner_try($$update revision_reviews set rating = 'easy'$$) in (0, -1) and pg_temp.owner_try($$delete from revision_reviews$$) in (0, -1));

-- ============ H. server-side grading, answer key, forged correctness, has_valid_key ============
select pg_temp.check_('SEC answer key columns are unreadable (direct, filter, embed, select *)', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select correct_answer from pyqs$$) = -1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select explanation from pyqs$$) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select id from pyqs where correct_answer = 'B'$$) = -1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select * from pyqs$$) = -1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select y.correct_answer from pyq_topics t join pyqs y on y.id = t.pyq_id$$) = -1);
select pg_temp.check_('SEC before answering, the question payload has no answer and no explanation text', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select (public.practice_question(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf') -> 'answer')::text$f$, (select id from t_runs where k = 'sec_ps'))) in ('null')
  and pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select (position('because' in public.practice_question(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf')::text) = 0)::text$f$, (select id from t_runs where k = 'sec_ps'))) = 'true');
select pg_temp.check_('SEC submit_pyq_answer has no correctness/score parameter and forging one fails', (select pg_get_function_arguments(p.oid) !~* 'correct|score|result' from pg_proc p where p.proname = 'submit_pyq_answer')
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'D', 5, true)$f$, (select id from t_runs where k = 'sec_ps'))) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(p_session => %L, p_pyq => '6923f5c9-c73b-50f3-aef9-ac779ca167bf', p_selected => 'D', p_seconds => 5, p_is_correct => true)$f$, (select id from t_runs where k = 'sec_ps'))) = -1);
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'D', 5)$f$, (select id from t_runs where k = 'sec_ps')));      -- Q1's key is B
select pg_temp.check_('SEC a wrong pick is graded incorrect by the server; resubmitting the right option cannot change it', (select not is_correct and selected_answer = 'D' from pyq_attempts where session_id = (select id from t_runs where k = 'sec_ps') and pyq_id = '6923f5c9-c73b-50f3-aef9-ac779ca167bf')
  and pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'B', 5) ->> 'duplicate'$f$, (select id from t_runs where k = 'sec_ps'))) = 'true'
  and (select not is_correct and selected_answer = 'D' from pyq_attempts where session_id = (select id from t_runs where k = 'sec_ps') and pyq_id = '6923f5c9-c73b-50f3-aef9-ac779ca167bf') and (select count(*) = 1 from pyq_attempts where session_id = (select id from t_runs where k = 'sec_ps')));
select pg_temp.check_('SEC a question outside the session is refused (read and submit)', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.practice_question(%L, '538b4267-45b8-521c-afd0-73e417e5dccc')$f$, (select id from t_runs where k = 'sec_ps'))) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(%L, '538b4267-45b8-521c-afd0-73e417e5dccc', 'C', 5)$f$, (select id from t_runs where k = 'sec_ps'))) = -1);
-- custom questions: ownership and forged has_valid_key
select pg_temp.owner_try($$insert into pyqs (id, paper_id, question, options, correct_answer, owner_id, has_valid_key) values ('11111111-aaaa-4aaa-8aaa-000000000001', '45075014-9a46-5d77-9064-50eb4f553616', 'TEST SEC keyless custom', null, null, 'eda6c4d2-347b-52c8-92c4-bd428277acd4', true)$$);
select pg_temp.check_('SEC has_valid_key cannot be forged: a keyless question stays false even when inserted with true', (select not has_valid_key from pyqs where id = '11111111-aaaa-4aaa-8aaa-000000000001'));
select pg_temp.owner_try($$update pyqs set has_valid_key = true where id = '11111111-aaaa-4aaa-8aaa-000000000001'$$);
select pg_temp.check_('SEC ... nor by a later UPDATE of that column alone', (select not has_valid_key from pyqs where id = '11111111-aaaa-4aaa-8aaa-000000000001'));
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update pyqs set has_valid_key = true where id = '11111111-aaaa-4aaa-8aaa-000000000001'$$);
select pg_temp.check_('SEC ... nor by the owning client', (select not has_valid_key from pyqs where id = '11111111-aaaa-4aaa-8aaa-000000000001'));
select pg_temp.check_('SEC a client cannot create or edit OFFICIAL questions, nor questions owned by someone else', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into pyqs (id, paper_id, question, options, correct_answer) values ('11111111-aaaa-4aaa-8aaa-000000000002', '45075014-9a46-5d77-9064-50eb4f553616', 'TEST SEC official', '{"A":"x","B":"y"}', 'A')$$) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into pyqs (id, paper_id, question, options, correct_answer, owner_id) values ('11111111-aaaa-4aaa-8aaa-000000000003', '45075014-9a46-5d77-9064-50eb4f553616', 'TEST SEC for B', '{"A":"x","B":"y"}', 'A', '7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed')$$) = -1
  and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$update pyqs set question = 'hijacked' where id = '11111111-aaaa-4aaa-8aaa-000000000001'$$) in (0, -1) and (select question = 'TEST SEC keyless custom' from pyqs where id = '11111111-aaaa-4aaa-8aaa-000000000001'));
select pg_temp.check_('SEC another user''s custom question is invisible (granted columns only: SELECT * is refused by the column grants)', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select id, question from pyqs where id = '11111111-aaaa-4aaa-8aaa-000000000001'$$) = 0
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select id, question from pyqs where id = '11111111-aaaa-4aaa-8aaa-000000000001'$$) = 1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select * from pyqs$$) = -1);

-- ============ I. admin-only curriculum mutations and privilege escalation ============
select pg_temp.check_('SEC a normal user cannot become admin (update, insert, upsert)', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update profiles set is_admin = true where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into profiles (id, display_name, is_admin) values (gen_random_uuid(), 'x', true)$$) = -1 and (select not is_admin from profiles where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'));
select pg_temp.check_('SEC a normal user cannot edit or create OFFICIAL curriculum', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update chapters set title = 'hijacked' where id = '17277ef4-ed1d-5063-9ec5-55919f09e403'$$) in (0, -1) and (select title = 'TEST official chapter' from chapters where id = '17277ef4-ed1d-5063-9ec5-55919f09e403')
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into chapters (id, book_id, number, title) values (gen_random_uuid(), 'c199e71a-db01-5359-b575-151d904fa192', 9, 'TEST SEC official insert')$$) = -1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$delete from chapters where id = '17277ef4-ed1d-5063-9ec5-55919f09e403'$$) in (0, -1)
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update books set status = 'archived' where id = 'c199e71a-db01-5359-b575-151d904fa192'$$) in (0, -1) and (select status = 'published' from books where id = 'c199e71a-db01-5359-b575-151d904fa192')
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into ncert_ssc_mappings (ncert_chapter_id, ssc_topic_id, mapping_type, relevance) values ('dd124977-1642-564e-8776-86a09a5ccdbf', 'ee476413-2e8e-5c56-bbf5-b6cf5bdb2876', 'direct', 'high')$$) = -1);
-- (each action in its own statement; a SELECT cannot see rows written by a function called in the same statement)
insert into t_ret select 'ch_forB', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into chapters (id, book_id, number, title, owner_id) values ('11111111-bbbb-4bbb-8bbb-000000000001', 'c199e71a-db01-5359-b575-151d904fa192', 50, 'TEST SEC for B', '7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed')$$);
insert into t_ret select 'ch_mine', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into chapters (id, book_id, number, title, owner_id) values ('11111111-bbbb-4bbb-8bbb-000000000002', 'c199e71a-db01-5359-b575-151d904fa192', 51, 'TEST SEC mine', 'eda6c4d2-347b-52c8-92c4-bd428277acd4')$$);
select pg_temp.check_('SEC a custom chapter: creating one OWNED BY SOMEONE ELSE is refused', (select n from t_ret where k = 'ch_forB') = -1 and (select count(*) = 0 from chapters where id = '11111111-bbbb-4bbb-8bbb-000000000001'));
select pg_temp.check_('SEC a custom chapter: creating one owned by yourself is allowed (insert policy: owner_id = auth.uid() and the book is visible)', (select n from t_ret where k = 'ch_mine') = 1, (select 'rows_as=' || n from t_ret where k = 'ch_mine'));
select pg_temp.check_('SEC a custom chapter is invisible to other users and visible to its owner', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select id from chapters where id = '11111111-bbbb-4bbb-8bbb-000000000002'$$) = 0
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select id from chapters where id = '11111111-bbbb-4bbb-8bbb-000000000002'$$) = 1);
insert into t_ret select 'ch_reassign', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update chapters set owner_id = null where id = '11111111-bbbb-4bbb-8bbb-000000000002'$$);
insert into t_ret select 'ch_steal', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$update chapters set title = 'hijacked', owner_id = '7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed' where id = '11111111-bbbb-4bbb-8bbb-000000000002'$$);
select pg_temp.check_('SEC a custom chapter cannot be reassigned to the official catalogue (owner_id = null) nor taken over by another user, and is unchanged', (select n from t_ret where k = 'ch_reassign') in (0, -1) and (select n from t_ret where k = 'ch_steal') in (0, -1)
  and (select owner_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and title = 'TEST SEC mine' from chapters where id = '11111111-bbbb-4bbb-8bbb-000000000002'));
select pg_temp.check_('SEC an admin (C) CAN do what A cannot (positive control: the denials above are about authority, not a broken fixture)', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.verify_source('72a81bcc-e8fb-5a14-b351-3ba6b50baadd', true)$$) >= 0 and pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$update chapters set title = 'TEST official chapter' where id = '17277ef4-ed1d-5063-9ec5-55919f09e403'$$) = 1);
select pg_temp.owner_try($$update books set status = 'archived' where id = 'c199e71a-db01-5359-b575-151d904fa192'$$);
select pg_temp.check_('SEC archived/unpublished content is not visible to a normal user but is to an admin', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select * from global_search('TEST official chapter', 10) where kind = 'chapter'$$) = 0
  and pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select * from global_search('TEST official chapter', 10) where kind = 'chapter'$$) >= 1);

-- ======================= RESULTS =======================
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed, count(*) as total from t_results;
select n, label, detail from t_results where not passed order by n;      -- empty = everything passed
select n, case when passed then 'PASS' else 'FAIL' end as result, label from t_results order by n;
rollback;
