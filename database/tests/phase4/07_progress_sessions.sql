-- ============ 007 progress ============
select pg_temp.check_('007 set_progress learning 40 is accepted', pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T1@', 'learning', 40)$$) = 1);
select pg_temp.check_('007 ... and stores status and completion', (select status::text || ':' || completion from user_progress where user_id = '@A@' and entity_id = '@T1@') = 'learning:40');
select pg_temp.check_('007 status strong is not writable', pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T1@', 'strong')$$) = -1);
select pg_temp.check_('007 status revision is not writable', pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T1@', 'revision')$$) = -1);
select pg_temp.check_('007 completion 101 rejected', pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T1@', null, 101)$$) = -1);
select pg_temp.check_('007 confidence 6 rejected', pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T1@', null, null, 6)$$) = -1);
select pg_temp.check_('007 unknown entity rejected', pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '99999999-0000-0000-0000-000000000000', 'learning')$$) = -1);
select pg_temp.check_('007 unsupported type rejected', pg_temp.rows_as('@A@', $$select public.set_progress('pyq', '@Q1@', 'learning')$$) = -1);
select pg_temp.check_('007 draft-container entity not trackable', pg_temp.rows_as('@A@', $$select public.set_progress('ncert_chapter', '@CHD@', 'learning')$$) = -1);
select pg_temp.check_('007 direct INSERT into user_progress denied', pg_temp.rows_as('@A@', $$insert into user_progress (user_id, entity_type, entity_id) values ('@A@','ssc_topic','@T2@')$$) = -1);
select pg_temp.check_('007 direct UPDATE of counters denied', pg_temp.rows_as('@A@', $$update user_progress set seconds_spent = 999999, sessions = 99, revision_count = 99 where user_id = '@A@'$$) = -1);
select pg_temp.check_('007 direct DELETE denied', pg_temp.rows_as('@A@', $$delete from user_progress where user_id = '@A@'$$) = -1);
select pg_temp.check_('007 set_progress cannot touch counters', (select seconds_spent + sessions + revision_count from user_progress where user_id = '@A@' and entity_id = '@T1@') = 0);
select pg_temp.check_('007 set_progress has no counter/time parameters', pg_get_function_arguments('public.set_progress(public.entity_t, uuid, text, integer, integer)'::regprocedure) !~* '(second|session|revision|streak|studied)');
-- completed_at semantics
select pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T2@', 'completed')$$);
select pg_temp.check_('007 completed => completion 100 and completed_at = now', (select completion || '|' || (completed_at = timestamptz '2026-10-01 12:00:00+00')::text from user_progress where user_id = '@A@' and entity_id = '@T2@') = '100|true');
select pg_temp.set_now('2026-10-01 13:00:00+00');
select pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T2@', 'completed')$$);
select pg_temp.check_('007 re-completing keeps the original completed_at', (select completed_at from user_progress where user_id = '@A@' and entity_id = '@T2@') = timestamptz '2026-10-01 12:00:00+00');
select pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T2@', 'learning')$$);
select pg_temp.check_('007 leaving completed clears completed_at and caps completion at 99', (select completion || '|' || (completed_at is null)::text from user_progress where user_id = '@A@' and entity_id = '@T2@') = '99|true');
select pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T2@', null, 100)$$);
select pg_temp.check_('007 completion 100 alone completes (and re-stamps completed_at)', (select status::text || '|' || (completed_at = timestamptz '2026-10-01 13:00:00+00')::text from user_progress where user_id = '@A@' and entity_id = '@T2@') = 'completed|true');
select pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T2@', 'not_started')$$);
select pg_temp.check_('007 not_started resets completion to 0', (select completion from user_progress where user_id = '@A@' and entity_id = '@T2@') = 0);
select pg_temp.set_now('2026-10-01 12:00:00+00');
select pg_temp.check_('007 constraint: completed <=> completion 100', pg_temp.owner_try($$update user_progress set status = 'completed', completion = 50 where user_id = '@A@' and entity_id = '@T1@'$$) = -1);
select pg_temp.check_('007 B cannot read A progress', pg_temp.rows_as('@B@', $$select 1 from user_progress where user_id = '@A@'$$) = 0);
select pg_temp.check_('007 B can set progress on their own row', pg_temp.rows_as('@B@', $$select public.set_progress('ssc_topic', '@T1@', 'learning')$$) = 1);
select pg_temp.check_('007 ... which creates B''s row and leaves A''s untouched', (select count(*) from user_progress where entity_id = '@T1@' and user_id = '@B@') = 1
  and (select status::text from user_progress where entity_id = '@T1@' and user_id = '@A@') = 'learning');
select pg_temp.check_('007 anonymous cannot call set_progress', pg_temp.rows_as(null, $$select public.set_progress('ssc_topic', '@T1@', 'learning')$$) = -1);
select pg_temp.check_('007 old touch_streak() is gone', pg_temp.rows_as('@A@', 'select public.touch_streak()') = -1);

-- ============ 007 study sessions ============
select pg_temp.check_('007 study_finish/pause/resume/heartbeat/start take no seconds',
  (select bool_and(pg_get_function_arguments(p.oid) !~* 'second') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('study_start','study_pause','study_resume','study_heartbeat','study_finish','study_recover')));
select pg_temp.set_now('2026-10-01 12:00:00+00');
select pg_temp.check_('007 start opens an active session', pg_temp.val_as('@A@', $$select public.study_start('ssc_topic', '@T1@') ->> 'state'$$) = 'active');
insert into t_runs select 's1', (select id from study_sessions where user_id = '@A@' and state = 'active');
select pg_temp.check_('007 duplicate start returns the SAME session', pg_temp.val_as('@A@', $$select public.study_start('ssc_topic', '@T1@') ->> 'id'$$) = (select id::text from t_runs where k = 's1'));
select pg_temp.check_('007 only one open session exists', (select count(*) from study_sessions where user_id = '@A@' and state in ('active','paused')) = 1);
select pg_temp.check_('007 owner cannot insert a second open session (unique index)', pg_temp.owner_try($$insert into study_sessions (user_id, entity_type, entity_id, state, active_since) values ('@A@','ssc_topic','@T2@','active', now())$$) = -1);
select pg_temp.check_('007 B cannot pause A session', pg_temp.rows_as('@B@', format($f$select public.study_pause(%L)$f$, (select id from t_runs where k = 's1'))) = -1);
select pg_temp.check_('007 B cannot finish A session', pg_temp.rows_as('@B@', format($f$select public.study_finish(%L)$f$, (select id from t_runs where k = 's1'))) = -1);
select pg_temp.check_('007 B cannot heartbeat A session', pg_temp.rows_as('@B@', format($f$select public.study_heartbeat(%L)$f$, (select id from t_runs where k = 's1'))) = -1);
select pg_temp.check_('007 B cannot see A sessions', pg_temp.rows_as('@B@', $$select 1 from study_sessions where user_id = '@A@'$$) = 0);
select pg_temp.set_now('2026-10-01 12:01:00+00');
select pg_temp.rows_as('@A@', format($f$select public.study_heartbeat(%L)$f$, (select id from t_runs where k = 's1')));
select pg_temp.set_now('2026-10-01 12:02:00+00');
select pg_temp.check_('007 pause credits 120 s (server time)', pg_temp.val_as('@A@', format($f$select public.study_pause(%L) ->> 'elapsed_seconds'$f$, (select id from t_runs where k = 's1'))) = '120');
select pg_temp.check_('007 pause is idempotent', pg_temp.val_as('@A@', format($f$select public.study_pause(%L) ->> 'elapsed_seconds'$f$, (select id from t_runs where k = 's1'))) = '120');
select pg_temp.set_now('2026-10-01 12:05:00+00');
select pg_temp.check_('007 paused time does not count; resume keeps 120', pg_temp.val_as('@A@', format($f$select public.study_resume(%L) ->> 'elapsed_seconds'$f$, (select id from t_runs where k = 's1'))) = '120');
select pg_temp.set_now('2026-10-01 12:05:30+00');
select pg_temp.rows_as('@A@', format($f$select public.study_heartbeat(%L)$f$, (select id from t_runs where k = 's1')));
select pg_temp.set_now('2026-10-01 12:06:00+00');
select pg_temp.check_('007 finish totals 180 s', pg_temp.val_as('@A@', format($f$select public.study_finish(%L) ->> 'seconds'$f$, (select id from t_runs where k = 's1'))) = '180');
select pg_temp.check_('007 counters updated atomically (seconds, sessions, last_studied_at)',
  (select seconds_spent || '|' || sessions || '|' || (last_studied_at = timestamptz '2026-10-01 12:06:00+00')::text from user_progress where user_id = '@A@' and entity_id = '@T1@') = '180|1|true');
select pg_temp.check_('007 streak started (local day 2026-10-01)', (select streak_count || '|' || last_study_date from profiles where id = '@A@') = '1|2026-10-01');
select pg_temp.rows_as('@A@', format($f$select public.study_finish(%L)$f$, (select id from t_runs where k = 's1')));
select pg_temp.check_('007 second finish does NOT double count', (select seconds_spent || '|' || sessions from user_progress where user_id = '@A@' and entity_id = '@T1@') = '180|1');
select pg_temp.check_('007 pausing a finished session is refused', pg_temp.rows_as('@A@', format($f$select public.study_pause(%L)$f$, (select id from t_runs where k = 's1'))) = -1);
select pg_temp.check_('007 direct writes to study_sessions denied', pg_temp.rows_as('@A@', $$update study_sessions set seconds = 99999 where user_id = '@A@'$$) = -1
  and pg_temp.rows_as('@A@', $$insert into study_sessions (user_id, entity_type, entity_id) values ('@A@','ssc_topic','@T1@')$$) = -1);
select pg_temp.check_('007 anonymous cannot start', pg_temp.rows_as(null, $$select public.study_start('ssc_topic', '@T1@')$$) = -1);
-- stale ACTIVE session: no heartbeat for an hour => abandoned, credited only heartbeat+90 s
select pg_temp.set_now('2026-10-01 12:10:00+00');
select pg_temp.rows_as('@A@', $$select public.study_start('ssc_topic', '@T2@')$$);
select pg_temp.set_now('2026-10-01 13:10:00+00');
select pg_temp.rows_as('@A@', 'select public.study_recover()');
select pg_temp.check_('007 recover abandoned the stale session', (select state::text || '|' || seconds from study_sessions where user_id = '@A@' and entity_id = '@T2@' order by started_at desc limit 1) = 'abandoned|90');
select pg_temp.check_('007 recover now reports no open session', pg_temp.val_as('@A@', 'select public.study_recover()::text') is null);
select pg_temp.check_('007 abandoned time is credited, not lost (and not inflated)', (select seconds_spent || '|' || sessions from user_progress where user_id = '@A@' and entity_id = '@T2@') = '90|1');
-- stale PAUSED session (> max session seconds untouched)
select pg_temp.rows_as('@A@', $$select public.study_start('ssc_topic', '@T1@')$$);
select pg_temp.set_now('2026-10-01 13:10:50+00');
select pg_temp.rows_as('@A@', format($f$select public.study_pause(%L)$f$, (select id from study_sessions where user_id = '@A@' and state = 'active')));
select pg_temp.set_now('2026-10-01 20:30:00+00');
select pg_temp.rows_as('@A@', 'select public.study_recover()');
select pg_temp.check_('007 stale paused session abandoned with only its accumulated time', (select state::text || '|' || seconds from study_sessions where user_id = '@A@' and entity_id = '@T1@' order by started_at desc limit 1) = 'abandoned|50');
-- switching topics closes the previous session
select pg_temp.set_now('2026-10-01 20:31:00+00');
select pg_temp.rows_as('@A@', $$select public.study_start('ssc_topic', '@T1@')$$);
select pg_temp.set_now('2026-10-01 20:31:30+00');
select pg_temp.rows_as('@A@', $$select public.study_start('ssc_topic', '@T2@')$$);
select pg_temp.check_('007 switching entity abandons the old session and opens one new', (select count(*) from study_sessions where user_id = '@A@' and state = 'active') = 1
  and (select entity_id from study_sessions where user_id = '@A@' and state = 'active') = '@T2@');
select pg_temp.rows_as('@A@', format($f$select public.study_finish(%L)$f$, (select id from study_sessions where user_id = '@A@' and state = 'active')));
-- very short session: no session count, no streak, no task completion
select pg_temp.set_now('2026-10-02 12:00:00+00');
update profiles set last_study_date = date '2026-10-01', streak_count = 7 where id = '@A@';
select pg_temp.rows_as('@A@', $$select public.study_start('ncert_chapter', '@CH1@')$$);
select pg_temp.rows_as('@A@', format($f$select public.study_finish(%L)$f$, (select id from study_sessions where user_id = '@A@' and state = 'active')));
select pg_temp.check_('007 a 0-second session does not count or touch the streak', (select sessions from user_progress where user_id = '@A@' and entity_id = '@CH1@') = 0 and (select streak_count from profiles where id = '@A@') = 7);
-- focus task auto-completes when the matching item is studied today
insert into tasks (id, user_id, title, entity_type, entity_id, due_date) values ('@TASK1@', '@A@', 'TEST focus', 'ssc_topic', '@T1@', date '2026-10-02');
select pg_temp.rows_as('@A@', $$select public.study_start('ssc_topic', '@T1@')$$);
select pg_temp.set_now('2026-10-02 12:00:30+00');
select pg_temp.rows_as('@A@', format($f$select public.study_heartbeat(%L)$f$, (select id from study_sessions where user_id = '@A@' and state = 'active')));
select pg_temp.set_now('2026-10-02 12:01:00+00');
select pg_temp.rows_as('@A@', format($f$select public.study_finish(%L)$f$, (select id from study_sessions where user_id = '@A@' and state = 'active')));
select pg_temp.check_('007 studying a focus item completes its task for today', (select status::text from tasks where id = '@TASK1@') = 'completed');
select pg_temp.check_('007 streak advanced to 8 for the next local day', (select streak_count || '|' || last_study_date from profiles where id = '@A@') = '8|2026-10-02');
-- midnight: a session crossing local midnight counts for BOTH days (Kolkata: 23:50 on Oct 3 -> 00:20 on Oct 4)
update profiles set last_study_date = date '2026-10-02', streak_count = 3 where id = '@A@';
select pg_temp.set_now('2026-10-03 18:20:00+00');
select pg_temp.rows_as('@A@', $$select public.study_start('ssc_topic', '@T2@')$$);
select pg_temp.set_now('2026-10-03 18:49:30+00');
select pg_temp.rows_as('@A@', format($f$select public.study_heartbeat(%L)$f$, (select id from study_sessions where user_id = '@A@' and state = 'active')));
select pg_temp.set_now('2026-10-03 18:50:00+00');
select pg_temp.check_('007 midnight-crossing session credits 1800 s', pg_temp.val_as('@A@', format($f$select public.study_finish(%L) ->> 'seconds'$f$, (select id from study_sessions where user_id = '@A@' and state = 'active'))) = '1800');
select pg_temp.check_('007 ... and extends the streak across both local days (3 -> 5, last day Oct 4)', (select streak_count || '|' || last_study_date from profiles where id = '@A@') = '5|2026-10-04');
select pg_temp.set_now('2026-10-01 12:00:00+00');
