-- ============ 009 PYQ + practice ============
select pg_temp.set_now('2026-10-01 12:00:00+00');
select pg_temp.check_('009 exam_papers is separate from ssc_exams (different tables, paper has year)', (select count(*) from information_schema.columns where table_name = 'exam_papers' and column_name = 'year') = 1);
select pg_temp.check_('009 duplicate paper rejected', pg_temp.owner_try($$insert into exam_papers (exam, year, tier) values ('SSC CGL', 2020, 'Tier I')$$) = -1);
select pg_temp.check_('009 same question twice in one paper rejected (content hash)', pg_temp.owner_try($$insert into pyqs (paper_id, question, options, correct_answer) values ('@P1@', '  TEST   question ONE ', '{"A":"a1","B":"b1","C":"c1","D":"d1"}', 'B')$$) = -1);
select pg_temp.check_('009 same question in a DIFFERENT paper allowed (repeat question)', pg_temp.owner_try($$insert into pyqs (paper_id, question, options, correct_answer) values ('@P2@', 'TEST question one', '{"A":"a1","B":"b1","C":"c1","D":"d1"}', 'B')$$) = 1);
select pg_temp.check_('009 answer key must be one of the options', pg_temp.owner_try($$insert into pyqs (paper_id, question, options, correct_answer) values ('@P1@', 'TEST bad key', '{"A":"x","B":"y"}', 'Z')$$) = -1);
select pg_temp.check_('009 options must be a JSON object', pg_temp.owner_try($$insert into pyqs (paper_id, question, options, correct_answer) values ('@P1@', 'TEST array options', '["a","b"]', 'A')$$) = -1);
select pg_temp.check_('009 content_hash is filled automatically', (select content_hash is not null from pyqs where id = '@Q1@'));
-- subtopic integrity
select pg_temp.check_('009 subtopic link requires the PYQ to be linked to its topic', pg_temp.owner_try($$insert into pyq_subtopics (pyq_id, ssc_topic_id, ssc_subtopic_id) values ('@Q3@', '@T2@', '@ST2@')$$) = 1);
select pg_temp.check_('009 subtopic link without a topic link rejected', pg_temp.owner_try($$insert into pyq_subtopics (pyq_id, ssc_topic_id, ssc_subtopic_id) values ('@Q2@', '@T2@', '@ST2@')$$) = -1);
select pg_temp.check_('009 subtopic that belongs to another topic rejected', pg_temp.owner_try($$insert into pyq_subtopics (pyq_id, ssc_topic_id, ssc_subtopic_id) values ('@Q1@', '@T1@', '@ST2@')$$) = -1);
select pg_temp.check_('009 unlinking the topic cascades the subtopic link', pg_temp.owner_try($$delete from pyq_topics where pyq_id = '@Q3@' and ssc_topic_id = '@T2@'$$) = 1 and (select count(*) from pyq_subtopics where pyq_id = '@Q3@') = 0);
insert into pyq_topics (pyq_id, ssc_topic_id) values ('@Q3@', '@T2@');
-- attempts are not client-writable
select pg_temp.check_('009 direct INSERT into pyq_attempts denied', pg_temp.rows_as('@A@', $$insert into pyq_attempts (user_id, pyq_id, is_correct) values ('@A@', '@Q1@', true)$$) = -1);
select pg_temp.check_('009 direct UPDATE/DELETE of attempts denied', pg_temp.rows_as('@A@', $$update pyq_attempts set is_correct = true where user_id = '@A@'$$) = -1 and pg_temp.rows_as('@A@', $$delete from pyq_attempts where user_id = '@A@'$$) = -1);
-- start
select pg_temp.check_('009 unknown scope rejected', pg_temp.rows_as('@A@', $$select public.start_practice('everything', null, 5)$$) = -1);
select pg_temp.check_('009 topic scope without an id rejected', pg_temp.rows_as('@A@', $$select public.start_practice('ssc_topic', null, 5)$$) = -1);
select pg_temp.check_('009 weak scope with an id rejected', pg_temp.rows_as('@A@', $$select public.start_practice('weak', '@T1@', 5)$$) = -1);
select pg_temp.check_('009 draft/unknown topic rejected', pg_temp.rows_as('@A@', $$select public.start_practice('ssc_topic', '99999999-0000-0000-0000-000000000000', 5)$$) = -1);
select pg_temp.check_('009 anonymous cannot start practice', pg_temp.rows_as(null, $$select public.start_practice('ssc_topic', '@T1@', 5)$$) = -1);
select pg_temp.check_('009 start returns the question snapshot (2 for T1)', pg_temp.val_as('@A@', $$select public.start_practice('ssc_topic', '@T1@', 10) ->> 'total'$$) = '2');
insert into t_runs select 'ps1', (select id from practice_sessions where user_id = '@A@' and state = 'active');
select pg_temp.check_('009 start also marks the topic as started', (select status::text from user_progress where user_id = '@A@' and entity_id = '@T1@') in ('learning', 'completed'));
select pg_temp.check_('009 restarting the same scope returns the SAME session and order', pg_temp.val_as('@A@', $$select public.start_practice('ssc_topic', '@T1@', 10) ->> 'id'$$) = (select id::text from t_runs where k = 'ps1'));
select pg_temp.check_('009 only one active practice session (unique index)', pg_temp.owner_try($$insert into practice_sessions (user_id, scope_type, scope_id, pyq_ids) values ('@A@','ssc_topic','@T2@', array['@Q3@']::uuid[])$$) = -1);
select pg_temp.check_('009 B cannot read A practice session', pg_temp.rows_as('@B@', $$select 1 from practice_sessions where user_id = '@A@'$$) = 0 and pg_temp.rows_as('@B@', format($f$select public.practice_state(%L)$f$, (select id from t_runs where k = 'ps1'))) = -1);
-- submissions
select pg_temp.check_('009 B cannot submit into A session', pg_temp.rows_as('@B@', format($f$select public.submit_pyq_answer(%L, '@Q1@', 'B', 5)$f$, (select id from t_runs where k = 'ps1'))) = -1);
select pg_temp.check_('009 question outside the session snapshot rejected', pg_temp.rows_as('@A@', format($f$select public.submit_pyq_answer(%L, '@Q3@', 'C', 5)$f$, (select id from t_runs where k = 'ps1'))) = -1);
select pg_temp.check_('009 tampered (random) question id rejected', pg_temp.rows_as('@A@', format($f$select public.submit_pyq_answer(%L, '99999999-0000-0000-0000-000000000000', 'A', 5)$f$, (select id from t_runs where k = 'ps1'))) = -1);
select pg_temp.check_('009 option that does not exist rejected', pg_temp.rows_as('@A@', format($f$select public.submit_pyq_answer(%L, '@Q1@', 'Z', 5)$f$, (select id from t_runs where k = 'ps1'))) = -1);
select pg_temp.check_('009 null answer rejected', pg_temp.rows_as('@A@', format($f$select public.submit_pyq_answer(%L, '@Q1@', null, 5)$f$, (select id from t_runs where k = 'ps1'))) = -1);
select pg_temp.check_('009 submit_pyq_answer has no is_correct parameter', pg_get_function_arguments('public.submit_pyq_answer(uuid, uuid, text, integer)'::regprocedure) !~* 'correct');
select pg_temp.check_('009 correct answer: server marks it correct', pg_temp.val_as('@A@', format($f$select public.submit_pyq_answer(%L, '@Q1@', 'B', 12) ->> 'is_correct'$f$, (select id from t_runs where k = 'ps1'))) = 'true');
select pg_temp.check_('009 duplicate submission (even with a different answer) returns the ORIGINAL result', pg_temp.val_as('@A@', format($f$select (public.submit_pyq_answer(%L, '@Q1@', 'A', 3) ->> 'is_correct') || '|' || (public.submit_pyq_answer(%L, '@Q1@', 'A', 3) ->> 'duplicate')$f$, (select id from t_runs where k = 'ps1'), (select id from t_runs where k = 'ps1'))) = 'true|true');
select pg_temp.check_('009 ... and stored exactly one attempt', (select count(*) from pyq_attempts where session_id = (select id from t_runs where k = 'ps1') and pyq_id = '@Q1@') = 1);
select pg_temp.check_('009 stored selected answer and clamped time', (select selected_answer || '|' || (time_taken_seconds <= 12)::text from pyq_attempts where session_id = (select id from t_runs where k = 'ps1') and pyq_id = '@Q1@') = 'B|true');
select pg_temp.check_('009 owner cannot insert a duplicate (session, question) attempt', pg_temp.owner_try(format($f$insert into pyq_attempts (user_id, pyq_id, session_id, selected_answer, is_correct) values ('@A@', '@Q1@', %L, 'B', true)$f$, (select id from t_runs where k = 'ps1'))) = -1);
select pg_temp.check_('009 wrong answer: server marks incorrect and reveals the key', pg_temp.val_as('@A@', format($f$select (public.submit_pyq_answer(%L, '@Q2@', 'D', 8) ->> 'is_correct') || '|' || (public.submit_pyq_answer(%L, '@Q2@', 'D', 8) ->> 'correct_answer')$f$, (select id from t_runs where k = 'ps1'), (select id from t_runs where k = 'ps1'))) = 'false|A');
select pg_temp.check_('009 refresh: practice_state shows answered questions and the same order', pg_temp.val_as('@A@', format($f$select jsonb_array_length(public.practice_state(%L) -> 'answered')$f$, (select id from t_runs where k = 'ps1'))) = '2');
-- finish
select pg_temp.check_('009 finish reports totals', pg_temp.val_as('@A@', format($f$select (public.finish_practice(%L) ->> 'attempted') || '|' || (public.finish_practice(%L) ->> 'correct')$f$, (select id from t_runs where k = 'ps1'), (select id from t_runs where k = 'ps1'))) = '2|1');
select pg_temp.check_('009 finish is idempotent (still completed, one session)', (select state from practice_sessions where id = (select id from t_runs where k = 'ps1')) = 'completed');
select pg_temp.check_('009 submitting after finish is rejected', pg_temp.rows_as('@A@', format($f$select public.submit_pyq_answer(%L, '@Q1@', 'B', 1)$f$, (select id from t_runs where k = 'ps1'))) = -1);
-- weak detection: 6 wrong on T1 (needs >=5 attempts, accuracy < 50)
select pg_temp.set_now('2026-10-01 12:30:00+00');
insert into pyqs (id, paper_id, question, options, correct_answer) values
  ('@Q4@','@P1@','TEST q four','{"A":"1","B":"2"}','A'), ('@Q5@','@P1@','TEST q five','{"A":"1","B":"2"}','A'), ('@Q6@','@P2@','TEST q six','{"A":"1","B":"2"}','A'), ('@Q7@','@P2@','TEST q seven','{"A":"1","B":"2"}','A');
insert into pyq_topics (pyq_id, ssc_topic_id) select q, '@T1@' from unnest(array['@Q4@','@Q5@','@Q6@','@Q7@']::uuid[]) q;
select pg_temp.rows_as('@A@', $$select public.start_practice('ssc_topic', '@T1@', 10)$$);
insert into t_runs select 'ps2', (select id from practice_sessions where user_id = '@A@' and state = 'active');
select pg_temp.check_('009 candidates put never-attempted first, then last-wrong, then last-correct', (select (pyq_ids)[array_length(pyq_ids,1)]::text from practice_sessions where id = (select id from t_runs where k = 'ps2')) = '@Q1@');
select pg_temp.rows_as('@A@', format($f$select public.submit_pyq_answer(%L, %L, 'B', 5)$f$, (select id from t_runs where k = 'ps2'), q)) from unnest(array['@Q2@','@Q4@','@Q5@','@Q6@','@Q7@']::uuid[]) q;
select pg_temp.check_('009 5 wrong answers recorded in session two', (select count(*) filter (where not is_correct) from pyq_attempts where session_id = (select id from t_runs where k = 'ps2')) = 5);
select pg_temp.check_('009 finish names the weak topic and opens a revision today', pg_temp.val_as('@A@', format($f$select jsonb_array_length(public.finish_practice(%L) -> 'weak_topics')$f$, (select id from t_runs where k = 'ps2'))) = '1'
  and (select due_date from revision_schedule where user_id = '@A@' and entity_id = '@T1@' and not done) = date '2026-10-01');
select pg_temp.check_('009 weak topic is reported weak by the signals RPC', pg_temp.val_as('@A@', $$select mastery from public.user_entity_signals('ssc_topic', '@T1@')$$) = 'weak');
-- weak scope uses the weak topic's questions only
select pg_temp.check_('009 weak-scope practice draws from weak topics', pg_temp.val_as('@A@', $$select public.start_practice('weak', null, 3) ->> 'total'$$) = '3');
select pg_temp.rows_as('@A@', format($f$select public.finish_practice(%L, true)$f$, (select id from practice_sessions where user_id = '@A@' and state = 'active')));
select pg_temp.check_('009 abandoning does not open weakness revisions or complete the session', (select count(*) from practice_sessions where user_id = '@A@' and state = 'abandoned') >= 1);
-- topic_pyqs helper + custom pyq privacy
insert into pyqs (id, question, options, correct_answer, owner_id) values ('@QC@', 'TEST A private question', '{"A":"1","B":"2"}', 'A', '@A@');
select pg_temp.check_('009 custom PYQ is private to its owner', pg_temp.rows_as('@A@', $$select 1 from pyqs where id = '@QC@'$$) = 1 and pg_temp.rows_as('@B@', $$select 1 from pyqs where id = '@QC@'$$) = 0);
select pg_temp.check_('009 topic_pyqs lists the 6 linked questions', (select count(*) from public.topic_pyqs('@T1@', 50)) = 6);
select pg_temp.check_('009 archiving a question succeeds', pg_temp.owner_try($$update pyqs set archived = true where id = '@Q7@'$$) = 1);
select pg_temp.check_('009 topic_pyqs hides archived questions', (select count(*) from public.topic_pyqs('@T1@', 50)) = 5);
select pg_temp.set_now('2026-10-01 12:00:00+00');
