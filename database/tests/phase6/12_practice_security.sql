-- ============ 012/014: practice security, answer key, search, function privileges ============
-- SQL NOT EXECUTED when written (no Postgres available). Runs inside the phase4 harness transaction (users A, B normal; C admin; fixtures Q1-Q3 on T1/T2).
-- Fixture answers: Q1 = B ("because b"), Q2 = A ("because a"), Q3 = C (topic T2). T1 has Q1+Q2 and subtopic ST1 (Q1).
select pg_temp.set_now('2026-10-01 12:00:00+00');

-- extra fixtures (owner path): an ARCHIVED question and a question WITHOUT a key, both linked to T1; an archived book + archived chapter for search
insert into pyqs (id, paper_id, question, options, correct_answer, explanation, difficulty_level, archived) values
  ('@Q4@', '@P2@', 'TEST archived question', '{"A":"a4","B":"b4"}', 'A', 'because archived', 'easy', true);
insert into pyqs (id, paper_id, question, options, correct_answer, difficulty_level) values
  ('@Q5@', '@P2@', 'TEST keyless question', null, null, 'easy');
insert into pyq_topics (pyq_id, ssc_topic_id) values ('@Q4@', '@T1@'), ('@Q5@', '@T1@');
insert into books (id, subject_id, title, status) values ('@BKA@', '@SUBJ@', 'TEST archived book', 'archived');
insert into chapters (id, book_id, title) values ('@CHA@', '@BKA@', 'TEST zebra archived-book chapter');
insert into chapters (id, book_id, title, archived) values ('@CHB@', '@BK1@', 'TEST zebra archived chapter', true);
insert into chapters (id, book_id, title) values ('@CHC@', '@BK1@', 'TEST zebra visible chapter');

-- ---------------- answer key is unreadable by clients ----------------
select pg_temp.check_('012 A cannot read correct_answer', pg_temp.rows_as('@A@', $$select correct_answer from pyqs$$) = -1);
select pg_temp.check_('012 A cannot read explanation', pg_temp.rows_as('@A@', $$select explanation from pyqs$$) = -1);
select pg_temp.check_('012 A cannot read content_hash', pg_temp.rows_as('@A@', $$select content_hash from pyqs$$) = -1);
select pg_temp.check_('012 A cannot select * from pyqs (it includes the key)', pg_temp.rows_as('@A@', $$select * from pyqs$$) = -1);
select pg_temp.check_('012 A can read question + options', pg_temp.rows_as('@A@', $$select id, question, options from pyqs where id = '@Q1@'$$) = 1);
select pg_temp.check_('012 filtering BY the key is also blocked (no boolean oracle)', pg_temp.rows_as('@A@', $$select id from pyqs where correct_answer = 'B'$$) = -1);
select pg_temp.check_('012 anonymous cannot read pyqs at all', pg_temp.rows_as(null, $$select id from pyqs$$) = -1);
select pg_temp.check_('012 embedding pyqs(correct_answer) through pyq_topics is blocked too', pg_temp.rows_as('@A@', $$select y.correct_answer from pyq_topics pt join pyqs y on y.id = pt.pyq_id$$) = -1);
select pg_temp.check_('012 has_valid_key is readable and says only whether a key exists', pg_temp.val_as('@A@', $$select has_valid_key from pyqs where id = '@Q1@'$$) = 'true');
select pg_temp.check_('012 keyless question has has_valid_key = false', (select not has_valid_key from pyqs where id = '@Q5@'));

select pg_temp.owner_try($$update pyqs set has_valid_key = true where id = '@Q5@'$$);
select pg_temp.check_('012 has_valid_key cannot be forced: it is recomputed on every update (keyless question stays false)', (select not has_valid_key from pyqs where id = '@Q5@'));

-- ---------------- counts only include practisable questions ----------------
select pg_temp.check_('012 topic_pyq_stats ignores archived and keyless questions (T1 = 2)', pg_temp.val_as('@A@', $$select pyq_count from public.topic_pyq_stats('@T1@')$$) = '2');
select pg_temp.check_('012 topic_pyqs lists no archived/keyless question', pg_temp.rows_as('@A@', $$select * from public.topic_pyqs('@T1@', 20)$$) = 2);
select pg_temp.check_('012 subject_pyq_counts agrees', pg_temp.val_as('@A@', $$select n from public.subject_pyq_counts('@SS1@') where ssc_topic_id = '@T1@'$$) = '2');
select pg_temp.check_('012 practice_options total equals topic_pyq_stats (2)', pg_temp.val_as('@A@', $$select public.practice_options('ssc_topic', '@T1@') ->> 'total'$$) = '2');

-- ---------------- sessions: start, order, ownership ----------------
select pg_temp.check_('012 A starts topic practice with a stable ordered snapshot (2 questions)', pg_temp.val_as('@A@', $$select public.start_practice('ssc_topic', '@T1@', 10) ->> 'total'$$) = '2');
insert into t_runs (k, id) select 'p6s', id from practice_sessions where user_id = '@A@' and state = 'active';
select pg_temp.check_('012 snapshot never contains archived or keyless questions', (select not (pyq_ids && array['@Q4@', '@Q5@']::uuid[]) from practice_sessions where id = (select id from t_runs where k = 'p6s')));
select pg_temp.check_('012 snapshot only has questions linked to the scope', (select pyq_ids <@ array['@Q1@', '@Q2@']::uuid[] from practice_sessions where id = (select id from t_runs where k = 'p6s')));
create temp table t_order as select pyq_ids as ids from practice_sessions where id = (select id from t_runs where k = 'p6s');
insert into pyqs (id, paper_id, question, options, correct_answer, difficulty_level) values ('@Q6@', '@P1@', 'TEST late question', '{"A":"x","B":"y"}', 'A', 'easy');
insert into pyq_topics (pyq_id, ssc_topic_id) values ('@Q6@', '@T1@');
select pg_temp.check_('012 questions added after the start do not change the session (order preserved)', (select pyq_ids = (select ids from t_order) from practice_sessions where id = (select id from t_runs where k = 'p6s')));
select pg_temp.check_('012 practice_state returns pyq_ids in the stored order', pg_temp.val_as('@A@', format($f$select (public.practice_state(%L) -> 'pyq_ids')::text$f$, (select id from t_runs where k = 'p6s'))) = (select to_jsonb(ids)::text from t_order));
select pg_temp.check_('012 same scope + filters returns the SAME session', pg_temp.val_as('@A@', $$select public.start_practice('ssc_topic', '@T1@', 10) ->> 'id'$$) = (select id::text from t_runs where k = 'p6s'));
select pg_temp.check_('012 B cannot read A session state', pg_temp.rows_as('@B@', format($f$select public.practice_state(%L)$f$, (select id from t_runs where k = 'p6s'))) = -1);
select pg_temp.check_('012 B cannot read A question', pg_temp.rows_as('@B@', format($f$select public.practice_question(%L, '@Q1@')$f$, (select id from t_runs where k = 'p6s'))) = -1);
select pg_temp.check_('012 B cannot finish A session', pg_temp.rows_as('@B@', format($f$select public.finish_practice(%L, false)$f$, (select id from t_runs where k = 'p6s'))) = -1);
select pg_temp.check_('012 B cannot submit into A session', pg_temp.rows_as('@B@', format($f$select public.submit_pyq_answer(%L, '@Q1@', 'B', 5)$f$, (select id from t_runs where k = 'p6s'))) = -1);
select pg_temp.check_('012 a question outside the session is rejected (Q3 belongs to T2)', pg_temp.rows_as('@A@', format($f$select public.practice_question(%L, '@Q3@')$f$, (select id from t_runs where k = 'p6s'))) = -1);
select pg_temp.check_('012 submitting a question outside the session is rejected', pg_temp.rows_as('@A@', format($f$select public.submit_pyq_answer(%L, '@Q3@', 'C', 5)$f$, (select id from t_runs where k = 'p6s'))) = -1);
select pg_temp.check_('012 anonymous cannot call practice RPCs', pg_temp.rows_as(null, format($f$select public.practice_question(%L, '@Q1@')$f$, (select id from t_runs where k = 'p6s'))) = -1);

-- ---------------- the answer is withheld until the question is answered ----------------
select pg_temp.check_('012 before answering: answer is null', pg_temp.val_as('@A@', format($f$select (public.practice_question(%L, '@Q1@') -> 'answer')::text$f$, (select id from t_runs where k = 'p6s'))) is null
  or pg_temp.val_as('@A@', format($f$select (public.practice_question(%L, '@Q1@') -> 'answer')::text$f$, (select id from t_runs where k = 'p6s'))) = 'null');
select pg_temp.check_('012 before answering: the payload contains neither the explanation nor the key text', pg_temp.val_as('@A@', format($f$select (position('because' in public.practice_question(%L, '@Q1@')::text) = 0)::text$f$, (select id from t_runs where k = 'p6s'))) = 'true');
select pg_temp.check_('012 before answering: no mapped topic or concept hints', pg_temp.val_as('@A@', format($f$select (public.practice_question(%L, '@Q1@') -> 'topics')::text$f$, (select id from t_runs where k = 'p6s'))) in ('null') or pg_temp.val_as('@A@', format($f$select (public.practice_question(%L, '@Q1@') -> 'topics')::text$f$, (select id from t_runs where k = 'p6s'))) is null);
select pg_temp.check_('012 options are returned (question is answerable)', pg_temp.val_as('@A@', format($f$select (public.practice_question(%L, '@Q1@') -> 'options' ->> 'B')$f$, (select id from t_runs where k = 'p6s'))) = 'b1');

-- ---------------- server-side grading ----------------
select pg_temp.check_('012 submit_pyq_answer has no correctness parameter', (select pg_get_function_arguments(p.oid) !~* 'correct' from pg_proc p where p.proname = 'submit_pyq_answer'));
select pg_temp.check_('012 an option that does not exist is rejected', pg_temp.rows_as('@A@', format($f$select public.submit_pyq_answer(%L, '@Q1@', 'Z', 5)$f$, (select id from t_runs where k = 'p6s'))) = -1);
select pg_temp.check_('012 correct pick graded correct BY THE SERVER', pg_temp.val_as('@A@', format($f$select public.submit_pyq_answer(%L, '@Q1@', 'B', 7) ->> 'is_correct'$f$, (select id from t_runs where k = 'p6s'))) = 'true');
select pg_temp.rows_as('@A@', format($f$select public.submit_pyq_answer(%L, '@Q2@', 'D', 7)$f$, (select id from t_runs where k = 'p6s')));
select pg_temp.check_('012 wrong pick graded incorrect BY THE SERVER (stored with is_correct = false)', (select not is_correct and selected_answer = 'D' from pyq_attempts where session_id = (select id from t_runs where k = 'p6s') and pyq_id = '@Q2@'));
select pg_temp.check_('012 duplicate submit changes nothing and reports duplicate', pg_temp.val_as('@A@', format($f$select public.submit_pyq_answer(%L, '@Q1@', 'A', 7) ->> 'duplicate'$f$, (select id from t_runs where k = 'p6s'))) = 'true');
select pg_temp.check_('012 duplicate with a DIFFERENT option still returns the ORIGINAL result', (select is_correct and selected_answer = 'B' from pyq_attempts where session_id = (select id from t_runs where k = 'p6s') and pyq_id = '@Q1@'));
select pg_temp.check_('012 exactly one attempt per question per session', (select count(*) = 2 from pyq_attempts where session_id = (select id from t_runs where k = 'p6s')));
select pg_temp.check_('012 after answering: key, explanation and topic are returned', pg_temp.val_as('@A@', format($f$select public.practice_question(%L, '@Q1@') -> 'answer' ->> 'explanation'$f$, (select id from t_runs where k = 'p6s'))) = 'because b'
  and pg_temp.val_as('@A@', format($f$select jsonb_array_length(public.practice_question(%L, '@Q1@') -> 'topics')::text$f$, (select id from t_runs where k = 'p6s'))) = '1');
select pg_temp.check_('012 informational time is clamped (never above 7200)', (select max(time_taken_seconds) <= 7200 from pyq_attempts where session_id = (select id from t_runs where k = 'p6s')));

-- ---------------- attempts cannot be forged or read across users ----------------
select pg_temp.check_('012 A cannot INSERT an attempt directly', pg_temp.rows_as('@A@', $$insert into pyq_attempts (user_id, pyq_id, is_correct) values ('@A@', '@Q1@', true)$$) = -1);
select pg_temp.check_('012 A cannot UPDATE an attempt (forge correctness)', pg_temp.rows_as('@A@', $$update pyq_attempts set is_correct = true$$) = -1);
select pg_temp.check_('012 A cannot DELETE an attempt', pg_temp.rows_as('@A@', $$delete from pyq_attempts$$) = -1);
select pg_temp.check_('012 B sees none of A attempts', pg_temp.rows_as('@B@', $$select * from pyq_attempts$$) = 0);
select pg_temp.check_('012 A sees own attempts', pg_temp.rows_as('@A@', $$select * from pyq_attempts$$) = 2);
select pg_temp.check_('012 B cannot UPDATE A attempts', pg_temp.rows_as('@B@', $$update pyq_attempts set is_correct = false$$) = -1);
select pg_temp.check_('012 clients cannot write practice_sessions directly', pg_temp.rows_as('@A@', $$update practice_sessions set pyq_ids = array['@Q3@']::uuid[]$$) = -1);
select pg_temp.check_('012 B sees no practice sessions of A', pg_temp.rows_as('@B@', $$select * from practice_sessions$$) = 0);

-- ---------------- finish + ended sessions ----------------
select pg_temp.check_('012 finish returns server totals (2 attempted, 1 correct, accuracy 50)', pg_temp.val_as('@A@', format($f$select concat_ws('/', j ->> 'attempted', j ->> 'correct', j ->> 'accuracy') from (select public.finish_practice(%L, false) j) q$f$, (select id from t_runs where k = 'p6s'))) = '2/1/50');
select pg_temp.check_('012 finish twice returns the same summary (idempotent)', pg_temp.val_as('@A@', format($f$select public.finish_practice(%L, false) ->> 'correct'$f$, (select id from t_runs where k = 'p6s'))) = '1');
select pg_temp.check_('012 submitting to an ENDED session is rejected', pg_temp.rows_as('@A@', format($f$select public.submit_pyq_answer(%L, '@Q1@', 'B', 1)$f$, (select id from t_runs where k = 'p6s'))) = -1);
select pg_temp.check_('012 an ended session can still be read by its owner (summary / review)', pg_temp.rows_as('@A@', format($f$select public.practice_state(%L)$f$, (select id from t_runs where k = 'p6s'))) = 1);

-- ---------------- filters ----------------
select pg_temp.check_('012 unknown difficulty is rejected by the type', pg_temp.rows_as('@B@', $$select public.start_practice('ssc_topic', '@T1@', 5, 'impossible', null)$$) = -1);
select pg_temp.check_('012 unknown paper is rejected', pg_temp.rows_as('@B@', $$select public.start_practice('ssc_topic', '@T1@', 5, null, '99999999-0000-0000-0000-000000000000')$$) = -1);
select pg_temp.check_('012 difficulty filter narrows the snapshot', pg_temp.val_as('@B@', $$select public.start_practice('ssc_topic', '@T1@', 10, 'easy', null) ->> 'total'$$) = '2');
select pg_temp.check_('012 a different filter abandons the old session and starts a new one (one active session)', pg_temp.val_as('@B@', $$select public.start_practice('ssc_topic', '@T1@', 10, 'medium', null) ->> 'total'$$) = '1'
  and (select count(*) = 1 from practice_sessions where user_id = '@B@' and state = 'active'));
select pg_temp.check_('012 count is clamped to 50', pg_temp.rows_as('@B@', $$select public.start_practice('mixed', null, 100000)$$) >= 0);

-- ---------------- search: archived / unpublished content is invisible to normal users ----------------
select pg_temp.check_('012 search hides a chapter whose BOOK is archived', pg_temp.rows_as('@A@', $$select * from public.global_search('zebra archived-book', 20)$$) = 0);
select pg_temp.check_('012 search hides an archived chapter', pg_temp.rows_as('@A@', $$select * from public.global_search('zebra archived chapter', 20) where kind = 'chapter'$$) = 0);
select pg_temp.check_('012 search still finds a visible chapter', pg_temp.rows_as('@A@', $$select * from public.global_search('zebra visible', 20) where kind = 'chapter'$$) = 1);
select pg_temp.check_('012 search hides archived pyqs', pg_temp.rows_as('@A@', $$select * from public.global_search('archived question', 20) where kind = 'pyq'$$) = 0);
select pg_temp.check_('012 admin still finds the archived-book chapter', pg_temp.rows_as('@C@', $$select * from public.global_search('zebra archived-book', 20)$$) >= 1);
select pg_temp.check_('012 admin still finds the archived chapter', pg_temp.rows_as('@C@', $$select * from public.global_search('zebra archived chapter', 20) where kind = 'chapter'$$) >= 1);
select pg_temp.check_('012 anonymous cannot search', pg_temp.rows_as(null, $$select * from public.global_search('zebra', 5)$$) = -1);

-- ---------------- 014: function execution privileges ----------------
select pg_temp.check_('014 no function of ours is executable by anon or PUBLIC', (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))));
select pg_temp.check_('014 internal definer helpers are not executable by authenticated', (select not has_function_privilege('authenticated', 'public._close_session(uuid, public.session_state_t, timestamptz)'::regprocedure, 'execute')
  and not has_function_privilege('authenticated', 'public._touch_streak(uuid, date)'::regprocedure, 'execute') and not has_function_privilege('authenticated', 'public._recover_stale(uuid, timestamptz)'::regprocedure, 'execute')
  and not has_function_privilege('authenticated', 'public.entity_accessible(public.entity_t, uuid, uuid)'::regprocedure, 'execute')));
select pg_temp.check_('014 service-only functions are not executable by authenticated', (select not has_function_privilege('authenticated', 'public.study_sweep_stale()'::regprocedure, 'execute') and not has_function_privilege('authenticated', 'public.entities_integrity_report()'::regprocedure, 'execute')
  and has_function_privilege('service_role', 'public.study_sweep_stale()'::regprocedure, 'execute')));
select pg_temp.check_('014 client RPCs ARE executable by authenticated and not anon', (select has_function_privilege('authenticated', 'public.study_start(public.entity_t, uuid)'::regprocedure, 'execute')
  and not has_function_privilege('anon', 'public.study_start(public.entity_t, uuid)'::regprocedure, 'execute') and has_function_privilege('authenticated', 'public.submit_pyq_answer(uuid, uuid, text, int)'::regprocedure, 'execute')));
select pg_temp.check_('014 every SECURITY DEFINER function pins search_path', (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')));
select pg_temp.check_('014 a normal user cannot run admin RPCs', pg_temp.rows_as('@A@', $$select public.import_create_run('x.json', 'abc', '{}'::jsonb, true)$$) = -1
  and pg_temp.rows_as('@A@', $$select public.verify_source('@SRC1@', true)$$) = -1 and pg_temp.rows_as('@A@', $$select public.set_publish_status('book', '@BK1@', 'archived')$$) = -1);
select pg_temp.check_('014 a normal user cannot call internal helpers with someone else''s id', pg_temp.rows_as('@A@', $$select public._close_session('00000000-0000-0000-0000-000000000000', 'abandoned', now())$$) = -1
  and pg_temp.rows_as('@A@', $$select public._touch_streak('@B@', current_date)$$) = -1);
select pg_temp.check_('014 a normal user cannot read ANOTHER user''s study session through the RPCs', pg_temp.rows_as('@B@', format($f$select public.study_pause(%L)$f$, '00000000-0000-0000-0000-000000000000')) = -1);
