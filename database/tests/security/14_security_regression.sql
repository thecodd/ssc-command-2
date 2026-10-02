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
  and pg_temp.rows_as(null, $$select public.study_start('ssc_topic', '@T1@')$$) = -1 and pg_temp.rows_as(null, $$select public.set_progress('ssc_topic', '@T1@', 'completed', 100, 5)$$) = -1 and pg_temp.rows_as(null, $$select public.start_practice('ssc_topic', '@T1@', 5)$$) = -1);

-- ============ C. authenticated, allowed ============
select pg_temp.check_('SEC authenticated: allowed RPCs work for a normal user', pg_temp.rows_as('@A@', $$select * from public.revision_queue()$$) >= 0 and pg_temp.rows_as('@A@', $$select * from public.daily_focus(3)$$) >= 0
  and pg_temp.rows_as('@A@', $$select * from public.user_entity_signals()$$) >= 0 and pg_temp.rows_as('@A@', $$select * from public.dashboard_summary()$$) >= 0);
-- state for the cross-user tests: A has progress, an open session, an open revision, a practice session
select pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T1@', 'learning', 30, 3)$$);
select pg_temp.rows_as('@A@', $$select public.study_start('ssc_topic', '@T1@')$$);
select pg_temp.rows_as('@A@', $$select public.schedule_revision('ssc_topic', '@T1@')$$);
select pg_temp.rows_as('@A@', $$select public.start_practice('ssc_topic', '@T1@', 5)$$);
insert into t_runs (k, id) select 'sec_sess', id from study_sessions where user_id = '@A@' and state in ('active', 'paused') limit 1;
insert into t_runs (k, id) select 'sec_rev', id from revision_schedule where user_id = '@A@' and entity_id = '@T1@' and not done;
insert into t_runs (k, id) select 'sec_ps', id from practice_sessions where user_id = '@A@' and state = 'active' limit 1;
select pg_temp.check_('SEC fixture: A has a session, an open revision and a practice session', (select count(*) = 3 from t_runs where k in ('sec_sess', 'sec_rev', 'sec_ps')));

-- ============ D. forbidden RPCs ============
select pg_temp.check_('SEC authenticated: internal helpers cannot be called with someone else''s ids', pg_temp.rows_as('@B@', $$select public._seed_revision('@A@', 'ssc_topic', '@T1@', 'manual')$$) = -1
  and pg_temp.rows_as('@B@', $$select public._touch_streak('@A@', current_date)$$) = -1 and pg_temp.rows_as('@B@', format($f$select public._close_session(%L, 'abandoned', now())$f$, (select id from t_runs where k = 'sec_sess'))) = -1);
select pg_temp.check_('SEC authenticated: service-only jobs cannot be called', pg_temp.rows_as('@A@', $$select public.study_sweep_stale()$$) = -1 and pg_temp.rows_as('@A@', $$select * from public.entities_integrity_report()$$) = -1);
select pg_temp.check_('SEC authenticated: admin RPCs are refused for a normal user', pg_temp.rows_as('@A@', $$select public.set_publish_status('book', '@BK1@', 'archived')$$) = -1 and pg_temp.rows_as('@A@', $$select public.verify_source('@SRC1@', true)$$) = -1
  and pg_temp.rows_as('@A@', $$select public.import_create_run('x.json', 'abc', '{}'::jsonb, true)$$) = -1);

-- ============ E. cross-user reads ============
select pg_temp.check_('SEC B sees none of A''s rows in any user table', pg_temp.rows_as('@B@', $$select * from user_progress where user_id = '@A@'$$) = 0 and pg_temp.rows_as('@B@', $$select * from study_sessions where user_id = '@A@'$$) = 0
  and pg_temp.rows_as('@B@', $$select * from revision_schedule where user_id = '@A@'$$) = 0 and pg_temp.rows_as('@B@', $$select * from practice_sessions where user_id = '@A@'$$) = 0
  and pg_temp.rows_as('@B@', $$select * from pyq_attempts where user_id = '@A@'$$) = 0 and pg_temp.rows_as('@B@', $$select * from profiles where id = '@A@'$$) = 0);
select pg_temp.check_('SEC B''s queue and signals never include A''s items', pg_temp.rows_as('@B@', $$select * from public.revision_queue()$$) = 0 and pg_temp.rows_as('@B@', $$select * from public.user_entity_signals() where entity_id = '@T1@'$$) = 0);
select pg_temp.check_('SEC B cannot read A''s practice session or its questions', pg_temp.rows_as('@B@', format($f$select public.practice_state(%L)$f$, (select id from t_runs where k = 'sec_ps'))) = -1
  and pg_temp.rows_as('@B@', format($f$select public.practice_question(%L, '@Q1@')$f$, (select id from t_runs where k = 'sec_ps'))) = -1);

-- ============ F. cross-user writes / session + revision ownership ============
select pg_temp.check_('SEC B cannot write A''s progress (direct write or RPC for A)', pg_temp.rows_as('@B@', $$update user_progress set status = 'completed' where user_id = '@A@'$$) = -1 and pg_temp.rows_as('@B@', $$delete from user_progress$$) = -1
  and pg_temp.rows_as('@B@', $$insert into user_progress (user_id, entity_type, entity_id, status) values ('@A@', 'ssc_topic', '@T2@', 'completed')$$) = -1);
select pg_temp.check_('SEC B cannot pause, resume, heartbeat or finish A''s study session', pg_temp.rows_as('@B@', format($f$select public.study_pause(%L)$f$, (select id from t_runs where k = 'sec_sess'))) = -1
  and pg_temp.rows_as('@B@', format($f$select public.study_resume(%L)$f$, (select id from t_runs where k = 'sec_sess'))) = -1 and pg_temp.rows_as('@B@', format($f$select public.study_heartbeat(%L)$f$, (select id from t_runs where k = 'sec_sess'))) = -1
  and pg_temp.rows_as('@B@', format($f$select public.study_finish(%L)$f$, (select id from t_runs where k = 'sec_sess'))) = -1);
select pg_temp.check_('SEC B cannot review A''s revision (looks like not found) and A''s row is unchanged', pg_temp.rows_as('@B@', format($f$select public.review_revision(%L, 'easy', 0)$f$, (select id from t_runs where k = 'sec_rev'))) = -1
  and (select count(*) = 0 from revision_reviews where user_id = '@A@') and (select not done and step = 0 from revision_schedule where id = (select id from t_runs where k = 'sec_rev')));
select pg_temp.check_('SEC B cannot submit into, or finish, A''s practice session', pg_temp.rows_as('@B@', format($f$select public.submit_pyq_answer(%L, '@Q1@', 'B', 5)$f$, (select id from t_runs where k = 'sec_ps'))) = -1
  and pg_temp.rows_as('@B@', format($f$select public.finish_practice(%L, false)$f$, (select id from t_runs where k = 'sec_ps'))) = -1 and (select count(*) = 0 from pyq_attempts where user_id = '@A@'));
select pg_temp.check_('SEC B cannot schedule a revision for an item B never started', pg_temp.rows_as('@B@', $$select public.schedule_revision('ssc_topic', '@T2@')$$) = -1);

-- ============ G. forged progress / mastery / revision interval or date / duration ============
select pg_temp.check_('SEC A cannot write progress, sessions, revisions, reviews or attempts directly', pg_temp.rows_as('@A@', $$update user_progress set status = 'completed', completion = 100$$) = -1
  and pg_temp.rows_as('@A@', $$insert into user_progress (user_id, entity_type, entity_id, status) values ('@A@', 'ssc_topic', '@T3@', 'completed')$$) = -1
  and pg_temp.rows_as('@A@', $$update study_sessions set seconds = 99999$$) = -1 and pg_temp.rows_as('@A@', $$update revision_schedule set due_date = date '2030-01-01', interval_days = 1, step = 4$$) = -1
  and pg_temp.rows_as('@A@', $$insert into revision_schedule (user_id, entity_type, entity_id, due_date, interval_days, step) values ('@A@', 'ssc_topic', '@T3@', current_date, 1, 0)$$) = -1
  and pg_temp.rows_as('@A@', $$update revision_reviews set rating = 'easy'$$) = -1 and pg_temp.rows_as('@A@', $$insert into pyq_attempts (user_id, pyq_id, is_correct) values ('@A@', '@Q1@', true)$$) = -1
  and pg_temp.rows_as('@A@', $$update pyq_attempts set is_correct = true$$) = -1 and pg_temp.rows_as('@A@', $$update practice_sessions set pyq_ids = '{}'$$) = -1);
select pg_temp.check_('SEC progress RPC validates its input (bad status / completion / confidence rejected)', pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T1@', 'mastered', 100, 5)$$) = -1
  and pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T1@', 'completed', 150, 5)$$) = -1 and pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T1@', 'completed', 100, 9)$$) = -1);
select pg_temp.check_('SEC no way to pass an interval or due date to the revision RPCs (unknown named argument fails)', pg_temp.rows_as('@A@', format($f$select public.review_revision(p_schedule => %L, p_rating => 'good', p_expected_step => 0, p_due_date => date '2030-01-01')$f$, (select id from t_runs where k = 'sec_rev'))) = -1
  and pg_temp.rows_as('@A@', format($f$select public.review_revision(p_schedule => %L, p_rating => 'good', p_expected_step => 0, p_interval_days => 365)$f$, (select id from t_runs where k = 'sec_rev'))) = -1 and pg_temp.rows_as('@A@', $$select public.schedule_revision('ssc_topic', '@T1@', date '2030-01-01')$$) = -1);
select pg_temp.check_('SEC no way to pass a duration or timestamp to the study RPCs', pg_temp.rows_as('@A@', format($f$select public.study_finish(p_session => %L, p_seconds => 99999)$f$, (select id from t_runs where k = 'sec_sess'))) = -1
  and pg_temp.rows_as('@A@', format($f$select public.study_heartbeat(p_session => %L, p_now => now() + interval '9 hours')$f$, (select id from t_runs where k = 'sec_sess'))) = -1);
select pg_temp.check_('SEC after all attempts A''s revision, session and progress are exactly as the server left them', (select step = 0 and not done from revision_schedule where id = (select id from t_runs where k = 'sec_rev'))
  and (select state in ('active', 'paused') from study_sessions where id = (select id from t_runs where k = 'sec_sess')) and (select completion = 30 and status = 'learning' from user_progress where user_id = '@A@' and entity_id = '@T1@'));
select pg_temp.check_('SEC revision history is append-only for everyone, including the table owner', pg_temp.owner_try($$update revision_reviews set rating = 'easy'$$) in (0, -1) and pg_temp.owner_try($$delete from revision_reviews$$) in (0, -1));

-- ============ H. server-side grading, answer key, forged correctness, has_valid_key ============
select pg_temp.check_('SEC answer key columns are unreadable (direct, filter, embed, select *)', pg_temp.rows_as('@A@', $$select correct_answer from pyqs$$) = -1 and pg_temp.rows_as('@A@', $$select explanation from pyqs$$) = -1
  and pg_temp.rows_as('@A@', $$select id from pyqs where correct_answer = 'B'$$) = -1 and pg_temp.rows_as('@A@', $$select * from pyqs$$) = -1 and pg_temp.rows_as('@A@', $$select y.correct_answer from pyq_topics t join pyqs y on y.id = t.pyq_id$$) = -1);
select pg_temp.check_('SEC before answering, the question payload has no answer and no explanation text', pg_temp.val_as('@A@', format($f$select (public.practice_question(%L, '@Q1@') -> 'answer')::text$f$, (select id from t_runs where k = 'sec_ps'))) in ('null')
  and pg_temp.val_as('@A@', format($f$select (position('because' in public.practice_question(%L, '@Q1@')::text) = 0)::text$f$, (select id from t_runs where k = 'sec_ps'))) = 'true');
select pg_temp.check_('SEC submit_pyq_answer has no correctness/score parameter and forging one fails', (select pg_get_function_arguments(p.oid) !~* 'correct|score|result' from pg_proc p where p.proname = 'submit_pyq_answer')
  and pg_temp.rows_as('@A@', format($f$select public.submit_pyq_answer(%L, '@Q1@', 'D', 5, true)$f$, (select id from t_runs where k = 'sec_ps'))) = -1
  and pg_temp.rows_as('@A@', format($f$select public.submit_pyq_answer(p_session => %L, p_pyq => '@Q1@', p_selected => 'D', p_seconds => 5, p_is_correct => true)$f$, (select id from t_runs where k = 'sec_ps'))) = -1);
select pg_temp.rows_as('@A@', format($f$select public.submit_pyq_answer(%L, '@Q1@', 'D', 5)$f$, (select id from t_runs where k = 'sec_ps')));      -- Q1's key is B
select pg_temp.check_('SEC a wrong pick is graded incorrect by the server; resubmitting the right option cannot change it', (select not is_correct and selected_answer = 'D' from pyq_attempts where session_id = (select id from t_runs where k = 'sec_ps') and pyq_id = '@Q1@')
  and pg_temp.val_as('@A@', format($f$select public.submit_pyq_answer(%L, '@Q1@', 'B', 5) ->> 'duplicate'$f$, (select id from t_runs where k = 'sec_ps'))) = 'true'
  and (select not is_correct and selected_answer = 'D' from pyq_attempts where session_id = (select id from t_runs where k = 'sec_ps') and pyq_id = '@Q1@') and (select count(*) = 1 from pyq_attempts where session_id = (select id from t_runs where k = 'sec_ps')));
select pg_temp.check_('SEC a question outside the session is refused (read and submit)', pg_temp.rows_as('@A@', format($f$select public.practice_question(%L, '@Q3@')$f$, (select id from t_runs where k = 'sec_ps'))) = -1
  and pg_temp.rows_as('@A@', format($f$select public.submit_pyq_answer(%L, '@Q3@', 'C', 5)$f$, (select id from t_runs where k = 'sec_ps'))) = -1);
-- custom questions: ownership and forged has_valid_key
select pg_temp.owner_try($$insert into pyqs (id, paper_id, question, options, correct_answer, owner_id, has_valid_key) values ('11111111-aaaa-4aaa-8aaa-000000000001', '@P1@', 'TEST SEC keyless custom', null, null, '@A@', true)$$);
select pg_temp.check_('SEC has_valid_key cannot be forged: a keyless question stays false even when inserted with true', (select not has_valid_key from pyqs where id = '11111111-aaaa-4aaa-8aaa-000000000001'));
select pg_temp.owner_try($$update pyqs set has_valid_key = true where id = '11111111-aaaa-4aaa-8aaa-000000000001'$$);
select pg_temp.check_('SEC ... nor by a later UPDATE of that column alone', (select not has_valid_key from pyqs where id = '11111111-aaaa-4aaa-8aaa-000000000001'));
select pg_temp.rows_as('@A@', $$update pyqs set has_valid_key = true where id = '11111111-aaaa-4aaa-8aaa-000000000001'$$);
select pg_temp.check_('SEC ... nor by the owning client', (select not has_valid_key from pyqs where id = '11111111-aaaa-4aaa-8aaa-000000000001'));
select pg_temp.check_('SEC a client cannot create or edit OFFICIAL questions, nor questions owned by someone else', pg_temp.rows_as('@A@', $$insert into pyqs (id, paper_id, question, options, correct_answer) values ('11111111-aaaa-4aaa-8aaa-000000000002', '@P1@', 'TEST SEC official', '{"A":"x","B":"y"}', 'A')$$) = -1
  and pg_temp.rows_as('@A@', $$insert into pyqs (id, paper_id, question, options, correct_answer, owner_id) values ('11111111-aaaa-4aaa-8aaa-000000000003', '@P1@', 'TEST SEC for B', '{"A":"x","B":"y"}', 'A', '@B@')$$) = -1
  and pg_temp.rows_as('@B@', $$update pyqs set question = 'hijacked' where id = '11111111-aaaa-4aaa-8aaa-000000000001'$$) in (0, -1) and (select question = 'TEST SEC keyless custom' from pyqs where id = '11111111-aaaa-4aaa-8aaa-000000000001'));
select pg_temp.check_('SEC another user''s custom question is invisible (granted columns only: SELECT * is refused by the column grants)', pg_temp.rows_as('@B@', $$select id, question from pyqs where id = '11111111-aaaa-4aaa-8aaa-000000000001'$$) = 0
  and pg_temp.rows_as('@A@', $$select id, question from pyqs where id = '11111111-aaaa-4aaa-8aaa-000000000001'$$) = 1 and pg_temp.rows_as('@A@', $$select * from pyqs$$) = -1);

-- ============ I. admin-only curriculum mutations and privilege escalation ============
select pg_temp.check_('SEC a normal user cannot become admin (update, insert, upsert)', pg_temp.rows_as('@A@', $$update profiles set is_admin = true where id = '@A@'$$) = -1
  and pg_temp.rows_as('@A@', $$insert into profiles (id, display_name, is_admin) values (gen_random_uuid(), 'x', true)$$) = -1 and (select not is_admin from profiles where id = '@A@'));
select pg_temp.check_('SEC a normal user cannot edit or create OFFICIAL curriculum', pg_temp.rows_as('@A@', $$update chapters set title = 'hijacked' where id = '@CH1@'$$) in (0, -1) and (select title = 'TEST official chapter' from chapters where id = '@CH1@')
  and pg_temp.rows_as('@A@', $$insert into chapters (id, book_id, number, title) values (gen_random_uuid(), '@BK1@', 9, 'TEST SEC official insert')$$) = -1 and pg_temp.rows_as('@A@', $$delete from chapters where id = '@CH1@'$$) in (0, -1)
  and pg_temp.rows_as('@A@', $$update books set status = 'archived' where id = '@BK1@'$$) in (0, -1) and (select status = 'published' from books where id = '@BK1@')
  and pg_temp.rows_as('@A@', $$insert into ncert_ssc_mappings (ncert_chapter_id, ssc_topic_id, mapping_type, relevance) values ('@CH2@', '@T3@', 'direct', 'high')$$) = -1);
-- (each action in its own statement; a SELECT cannot see rows written by a function called in the same statement)
insert into t_ret select 'ch_forB', pg_temp.rows_as('@A@', $$insert into chapters (id, book_id, number, title, owner_id) values ('11111111-bbbb-4bbb-8bbb-000000000001', '@BK1@', 50, 'TEST SEC for B', '@B@')$$);
insert into t_ret select 'ch_mine', pg_temp.rows_as('@A@', $$insert into chapters (id, book_id, number, title, owner_id) values ('11111111-bbbb-4bbb-8bbb-000000000002', '@BK1@', 51, 'TEST SEC mine', '@A@')$$);
select pg_temp.check_('SEC a custom chapter: creating one OWNED BY SOMEONE ELSE is refused', (select n from t_ret where k = 'ch_forB') = -1 and (select count(*) = 0 from chapters where id = '11111111-bbbb-4bbb-8bbb-000000000001'));
select pg_temp.check_('SEC a custom chapter: creating one owned by yourself is allowed (insert policy: owner_id = auth.uid() and the book is visible)', (select n from t_ret where k = 'ch_mine') = 1, (select 'rows_as=' || n from t_ret where k = 'ch_mine'));
select pg_temp.check_('SEC a custom chapter is invisible to other users and visible to its owner', pg_temp.rows_as('@B@', $$select id from chapters where id = '11111111-bbbb-4bbb-8bbb-000000000002'$$) = 0
  and pg_temp.rows_as('@A@', $$select id from chapters where id = '11111111-bbbb-4bbb-8bbb-000000000002'$$) = 1);
insert into t_ret select 'ch_reassign', pg_temp.rows_as('@A@', $$update chapters set owner_id = null where id = '11111111-bbbb-4bbb-8bbb-000000000002'$$);
insert into t_ret select 'ch_steal', pg_temp.rows_as('@B@', $$update chapters set title = 'hijacked', owner_id = '@B@' where id = '11111111-bbbb-4bbb-8bbb-000000000002'$$);
select pg_temp.check_('SEC a custom chapter cannot be reassigned to the official catalogue (owner_id = null) nor taken over by another user, and is unchanged', (select n from t_ret where k = 'ch_reassign') in (0, -1) and (select n from t_ret where k = 'ch_steal') in (0, -1)
  and (select owner_id = '@A@' and title = 'TEST SEC mine' from chapters where id = '11111111-bbbb-4bbb-8bbb-000000000002'));
select pg_temp.check_('SEC an admin (C) CAN do what A cannot (positive control: the denials above are about authority, not a broken fixture)', pg_temp.rows_as('@C@', $$select public.verify_source('@SRC2@', true)$$) >= 0 and pg_temp.rows_as('@C@', $$update chapters set title = 'TEST official chapter' where id = '@CH1@'$$) = 1);
select pg_temp.owner_try($$update books set status = 'archived' where id = '@BK1@'$$);
select pg_temp.check_('SEC archived/unpublished content is not visible to a normal user but is to an admin', pg_temp.rows_as('@A@', $$select * from global_search('TEST official chapter', 10) where kind = 'chapter'$$) = 0
  and pg_temp.rows_as('@C@', $$select * from global_search('TEST official chapter', 10) where kind = 'chapter'$$) >= 1);
