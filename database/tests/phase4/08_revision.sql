-- ============ 008 revision engine ============
select pg_temp.set_now('2026-10-01 12:00:00+00');
update profiles set revision_intervals = '{1,3,7,15,30}', last_study_date = null, streak_count = 0 where id = '@A@';
-- completion seeds exactly one open revision
select pg_temp.rows_as('@A@', $$select public.set_progress('ncert_chapter', '@CH2@', 'completed')$$);
select pg_temp.check_('008 completing seeds ONE open revision (step 0, due +1, reason completion)',
  (select count(*) || '|' || min(step) || '|' || min(due_date) || '|' || min(reason) from revision_schedule where user_id = '@A@' and entity_id = '@CH2@' and not done) = '1|0|2026-10-02|completion');
insert into t_runs select 'rev1', (select id from revision_schedule where user_id = '@A@' and entity_id = '@CH2@' and not done);
select pg_temp.set_now('2026-10-01 15:00:00+00');
select pg_temp.rows_as('@A@', $$select public.set_progress('ncert_chapter', '@CH2@', 'completed')$$);
select pg_temp.check_('008 completing again does NOT reset the ladder', (select id::text || '|' || due_date from revision_schedule where user_id = '@A@' and entity_id = '@CH2@' and not done) = (select id::text from t_runs where k = 'rev1') || '|2026-10-02');
select pg_temp.rows_as('@A@', $$select public.set_progress('ncert_chapter', '@CH2@', 'learning')$$);
select pg_temp.rows_as('@A@', $$select public.set_progress('ncert_chapter', '@CH2@', 'completed')$$);
select pg_temp.check_('008 complete -> learning -> complete keeps the SAME open row and due date', (select count(*) || '|' || min(id::text) || '|' || min(due_date) from revision_schedule where user_id = '@A@' and entity_id = '@CH2@' and not done) = '1|' || (select id::text from t_runs where k = 'rev1') || '|2026-10-02');
select pg_temp.check_('008 one open row per entity is enforced by the database', pg_temp.owner_try($$insert into revision_schedule (user_id, entity_type, entity_id, due_date, interval_days) values ('@A@','ncert_chapter','@CH2@', date '2026-10-09', 7)$$) = -1);
select pg_temp.check_('008 direct writes to revision tables denied', pg_temp.rows_as('@A@', $$update revision_schedule set due_date = date '2030-01-01' where user_id = '@A@'$$) = -1
  and pg_temp.rows_as('@A@', $$insert into revision_reviews (user_id, entity_type, entity_id, due_date, reviewed_on, rating) values ('@A@','ncert_chapter','@CH2@', current_date, current_date, 'easy')$$) = -1);
select pg_temp.set_now('2026-10-01 12:00:00+00');

-- rating vectors through the RPC (ladder 1,3,7,15,30). Each case first forces the row to (step, due today), then reviews as A.
create or replace function pg_temp.review_case(p_step int, p_rating text, p_chapter text default '@CH2@') returns text language plpgsql as $$
declare v_id uuid; v_res text;
begin
  update revision_schedule set step = p_step, due_date = date '2026-10-01', done = false, done_at = null where user_id = '@A@' and entity_id = p_chapter::uuid and not done returning id into v_id;
  if v_id is null then
    select id into v_id from revision_schedule where user_id = '@A@' and entity_id = p_chapter::uuid order by created_at desc limit 1;
    update revision_schedule set step = p_step, due_date = date '2026-10-01', done = false, done_at = null where id = v_id;
  end if;
  perform pg_temp.rows_as('@A@', format($f$select public.review_revision(%L, %L, %s)$f$, v_id, p_rating, p_step));
  select step || '|' || done || '|' || due_date into v_res from revision_schedule where id = v_id;
  return v_res;
end $$;
select pg_temp.check_('008 good: step 0 -> 1, due +3', pg_temp.review_case(0, 'good') = '1|false|2026-10-04');
select pg_temp.check_('008 easy: step 1 -> 3, due +15', pg_temp.review_case(1, 'easy') = '3|false|2026-10-16');
select pg_temp.check_('008 hard: step 3 -> 2, due +1 (shortest gap)', pg_temp.review_case(3, 'hard') = '2|false|2026-10-02');
select pg_temp.check_('008 hard at the floor stays at 0, due +1', pg_temp.review_case(0, 'hard') = '0|false|2026-10-02');
select pg_temp.check_('008 good on the last step graduates (row done)', pg_temp.review_case(4, 'good') like '5|true|%');
select pg_temp.check_('008 graduated: no open row remains', (select count(*) from revision_schedule where user_id = '@A@' and entity_id = '@CH2@' and not done) = 0);
select pg_temp.check_('008 history appended one row per review (5)', (select count(*) from revision_reviews where user_id = '@A@' and entity_id = '@CH2@' and source = 'app') = 5);
select pg_temp.check_('008 history rows carry step before/after, interval and local review date',
  (select step_before || '>' || step_after || '|' || interval_days_after || '|' || reviewed_on || '|' || rating from revision_reviews where user_id = '@A@' and entity_id = '@CH2@' and rating = 'good' and step_before = 0 limit 1) = '0>1|3|2026-10-01|good');
select pg_temp.check_('008 graduation is recorded in history', (select count(*) from revision_reviews where user_id = '@A@' and entity_id = '@CH2@' and graduated) = 1);
select pg_temp.check_('008 revision_count incremented once per review (5)', (select revision_count from user_progress where user_id = '@A@' and entity_id = '@CH2@') = 5);
select pg_temp.check_('008 last_studied_at set by a review', (select last_studied_at from user_progress where user_id = '@A@' and entity_id = '@CH2@') = timestamptz '2026-10-01 12:00:00+00');
select pg_temp.check_('008 a review counts for the streak', (select streak_count from profiles where id = '@A@') = 1);
-- confidence on review
select pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T3@', 'completed')$$);
insert into t_runs select 'rev3', (select id from revision_schedule where user_id = '@A@' and entity_id = '@T3@' and not done);
select pg_temp.rows_as('@A@', format($f$select public.review_revision(%L, 'good', 0, 4)$f$, (select id from t_runs where k = 'rev3')));
select pg_temp.check_('008 review can set confidence', (select confidence from user_progress where user_id = '@A@' and entity_id = '@T3@') = 4);
-- duplicate / stale review protection
select pg_temp.check_('008 double-submit with the same expected step is rejected', pg_temp.rows_as('@A@', format($f$select public.review_revision(%L, 'good', 0)$f$, (select id from t_runs where k = 'rev3'))) = -1);
select pg_temp.check_('008 ... and added no extra history row', (select count(*) from revision_reviews where user_id = '@A@' and entity_id = '@T3@') = 1);
select pg_temp.check_('008 invalid rating rejected', pg_temp.rows_as('@A@', format($f$select public.review_revision(%L, 'perfect', 1)$f$, (select id from t_runs where k = 'rev3'))) = -1);
select pg_temp.check_('008 B cannot review A schedule', pg_temp.rows_as('@B@', format($f$select public.review_revision(%L, 'good', 1)$f$, (select id from t_runs where k = 'rev3'))) = -1);
select pg_temp.check_('008 unknown schedule id rejected', pg_temp.rows_as('@A@', $$select public.review_revision('99999999-0000-0000-0000-000000000000', 'good', 0)$$) = -1);
select pg_temp.check_('008 a finished (graduated) revision cannot be reviewed again', pg_temp.rows_as('@A@', format($f$select public.review_revision(%L, 'good', 5)$f$, (select id from revision_schedule where user_id = '@A@' and entity_id = '@CH2@' and done limit 1))) = -1);
select pg_temp.check_('008 B cannot read A schedule or history', pg_temp.rows_as('@B@', $$select 1 from revision_schedule where user_id = '@A@'$$) = 0 and pg_temp.rows_as('@B@', $$select 1 from revision_reviews where user_id = '@A@'$$) = 0);
select pg_temp.check_('008 anonymous cannot review', pg_temp.rows_as(null, $$select public.review_revision('99999999-0000-0000-0000-000000000000', 'good', 0)$$) = -1);
-- append-only history
select pg_temp.check_('008 history UPDATE refused (user)', pg_temp.rows_as('@A@', $$update revision_reviews set rating = 'easy' where user_id = '@A@'$$) = -1);
select pg_temp.check_('008 history DELETE refused (user)', pg_temp.rows_as('@A@', $$delete from revision_reviews where user_id = '@A@'$$) = -1);
select pg_temp.check_('008 history UPDATE refused even for the owner', pg_temp.owner_try($$update revision_reviews set rating = 'easy' where user_id = '@A@'$$) = -1);
select pg_temp.check_('008 history DELETE refused even for the owner (direct statement)', pg_temp.owner_try($$delete from revision_reviews where user_id = '@A@'$$) = -1);
-- custom ladder: validation, future scheduling only, history untouched
select pg_temp.check_('008 invalid ladder {3,3} rejected', pg_temp.rows_as('@A@', $$update profiles set revision_intervals = '{3,3}' where id = '@A@'$$) = -1);
select pg_temp.check_('008 invalid ladder {0,2} rejected', pg_temp.rows_as('@A@', $$update profiles set revision_intervals = '{0,2}' where id = '@A@'$$) = -1);
select pg_temp.check_('008 invalid ladder (decreasing) rejected', pg_temp.rows_as('@A@', $$update profiles set revision_intervals = '{5,2}' where id = '@A@'$$) = -1);
select pg_temp.check_('008 invalid ladder (13 entries) rejected', pg_temp.rows_as('@A@', $$update profiles set revision_intervals = '{1,2,3,4,5,6,7,8,9,10,11,12,13}' where id = '@A@'$$) = -1);
select pg_temp.check_('008 invalid ladder (over 365 days) rejected', pg_temp.rows_as('@A@', $$update profiles set revision_intervals = '{1,366}' where id = '@A@'$$) = -1);
select pg_temp.check_('008 invalid ladder (empty) rejected', pg_temp.rows_as('@A@', $$update profiles set revision_intervals = '{}' where id = '@A@'$$) = -1);
create temp table t_hist as select id, rating, step_before, step_after, interval_days_after from revision_reviews where user_id = '@A@' order by id;
select pg_temp.check_('008 a valid custom ladder {2,5,9} is accepted', pg_temp.rows_as('@A@', $$update profiles set revision_intervals = '{2,5,9}' where id = '@A@'$$) = 1);
-- A NEW schedule needs an item with no open revision. T2 has had one since 007 (it was completed there, and completing an already-scheduled item never
-- reschedules, by design), so re-completing T2 cannot test this; the first completion of ST2 does. The assertion is the same: the seeded schedule uses the custom ladder.
select pg_temp.check_('008 precondition: ST2 has no revision yet', (select count(*) from revision_schedule where user_id = '@A@' and entity_id = '@ST2@') = 0);
select pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T2@', 'completed')$$);
select pg_temp.rows_as('@A@', $$select public.set_progress('ssc_subtopic', '@ST2@', 'completed')$$);
select pg_temp.check_('008 new schedule uses the custom ladder (due +2)', (select due_date from revision_schedule where user_id = '@A@' and entity_id = '@ST2@' and not done) = date '2026-10-03',
  (select format('due=%s step=%s interval=%s reason=%s today=%s ladder=%s', due_date, step, interval_days, reason, public.user_today('@A@'), public._ladder('@A@')) from revision_schedule where user_id = '@A@' and entity_id = '@ST2@' and not done));
select pg_temp.check_('008 re-completing T2, which already had an open revision, kept exactly that one open revision', (select count(*) = 1 from revision_schedule where user_id = '@A@' and entity_id = '@T2@' and not done));
select pg_temp.rows_as('@A@', format($f$select public.review_revision(%L, 'good', 0)$f$, (select id from revision_schedule where user_id = '@A@' and entity_id = '@T2@' and not done)));
select pg_temp.check_('008 good on the custom ladder: step 1, due +5', (select step || '|' || due_date from revision_schedule where user_id = '@A@' and entity_id = '@T2@' and not done) = '1|2026-10-06');
select pg_temp.check_('008 changing the ladder did not rewrite earlier history', (select count(*) from t_hist h join revision_reviews v on v.id = h.id where v.rating = h.rating and v.step_before is not distinct from h.step_before and v.step_after is not distinct from h.step_after and v.interval_days_after is not distinct from h.interval_days_after) = (select count(*) from t_hist));
-- manual schedule + weakness helper
select pg_temp.check_('008 manual revision needs a started item', pg_temp.rows_as('@B@', $$select public.schedule_revision('ssc_topic', '@T3@')$$) = -1);
select pg_temp.rows_as('@A@', $$select public.set_progress('ssc_subtopic', '@ST1@', 'learning', 30)$$);
insert into t_ret select 'manual_st1', pg_temp.rows_as('@A@', $$select public.schedule_revision('ssc_subtopic', '@ST1@')$$);
select pg_temp.check_('008 manual revision on a started item opens one due today (reason manual)', (select n from t_ret where k = 'manual_st1') = 1
  and (select due_date || '|' || reason from revision_schedule where user_id = '@A@' and entity_id = '@ST1@' and not done) = '2026-10-01|manual');
select pg_temp.owner_try($$select public._open_weakness_revision('@A@', 'ssc_topic', '@T2@')$$);
select pg_temp.check_('008 weakness pulls an open revision forward to today (reason weakness)', (select due_date || '|' || reason from revision_schedule where user_id = '@A@' and entity_id = '@T2@' and not done) = '2026-10-01|weakness');
-- deleting a user cascades their append-only history (cascade is allowed, direct delete is not)
select pg_temp.rows_as('@E@', $$select public.set_progress('ssc_topic', '@T1@', 'completed')$$);
select pg_temp.rows_as('@E@', format($f$select public.review_revision(%L, 'good', 0)$f$, (select id from revision_schedule where user_id = '@E@' and not done limit 1)));
select pg_temp.check_('008 user E has history before deletion', (select count(*) from revision_reviews where user_id = '@E@') = 1);
select pg_temp.check_('008 deleting the user succeeds', pg_temp.owner_try($$delete from auth.users where id = '@E@'$$) = 1);
select pg_temp.check_('008 ... and cascades their history', (select count(*) from revision_reviews where user_id = '@E@') = 0);
update profiles set revision_intervals = '{1,3,7,15,30}' where id = '@A@';
