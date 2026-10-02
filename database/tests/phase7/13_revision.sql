-- ============ 013 revision queue + Phase 7 revision behaviour ============
-- SQL NOT EXECUTED when written (no Postgres available). Runs inside the phase4 harness transaction (users A, B normal; C admin; fixtures CH2, T1-T3, ST1).
-- Ladder for A = 1,3,7,15,30 (indexes 0..4). B gets a custom ladder 2,5,20.
select pg_temp.set_now('2026-10-01 12:00:00+00');
update profiles set revision_intervals = '{1,3,7,15,30}' where id = '@A@';
update profiles set revision_intervals = '{2,5,20}' where id = '@B@';

-- A: four items with progress; revisions scheduled through the CLIENT rpc, due dates then placed by the owner
select pg_temp.rows_as('@A@', $$select public.set_progress('ncert_chapter', '@CH2@', 'learning', 50, 4)$$);
select pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T1@', 'learning', 60, 4)$$);
select pg_temp.rows_as('@A@', $$select public.set_progress('ssc_topic', '@T2@', 'completed', 100, 1)$$);     -- confidence 1 -> weak; completion seeds its own revision
select pg_temp.rows_as('@A@', $$select public.set_progress('ssc_subtopic', '@ST1@', 'learning', 20, 3)$$);
select pg_temp.rows_as('@A@', $$select public.schedule_revision('ncert_chapter', '@CH2@')$$);
select pg_temp.rows_as('@A@', $$select public.schedule_revision('ssc_topic', '@T1@')$$);
select pg_temp.rows_as('@A@', $$select public.schedule_revision('ssc_subtopic', '@ST1@')$$);
update revision_schedule set due_date = '2026-09-28', step = 1 where user_id = '@A@' and entity_id = '@CH2@' and not done;   -- overdue by 3
update revision_schedule set due_date = '2026-10-01', step = 2 where user_id = '@A@' and entity_id = '@T1@' and not done;     -- due today
update revision_schedule set due_date = '2026-10-01', step = 0 where user_id = '@A@' and entity_id = '@T2@' and not done;     -- due today (weak)
update revision_schedule set due_date = '2026-10-05', step = 3 where user_id = '@A@' and entity_id = '@ST1@' and not done;    -- upcoming

-- ---------------- one open row ----------------
select pg_temp.check_('013 exactly one open revision per item (A, 4 items)', (select count(*) = 4 and count(distinct entity_id) = 4 from revision_schedule where user_id = '@A@' and not done));
select pg_temp.check_('013 a second open row for the same item is rejected by the database', pg_temp.owner_try($$insert into revision_schedule (user_id, entity_type, entity_id, due_date, interval_days, step) values ('@A@', 'ssc_topic', '@T1@', date '2026-10-09', 1, 0)$$) = -1);
select pg_temp.check_('013 schedule_revision twice does not create a second open row', (select pg_temp.rows_as('@A@', $$select public.schedule_revision('ssc_topic', '@T1@')$$)) >= 0 and (select count(*) = 1 from revision_schedule where user_id = '@A@' and entity_id = '@T1@' and not done));
select pg_temp.check_('013 cannot schedule an item you never started', pg_temp.rows_as('@B@', $$select public.schedule_revision('ssc_topic', '@T2@')$$) = -1);

-- ---------------- revision_queue: buckets, order, signals ----------------
select pg_temp.check_('013 queue has A''s four open revisions', pg_temp.rows_as('@A@', $$select * from public.revision_queue()$$) = 4);
select pg_temp.check_('013 buckets are overdue, today, today, upcoming in rank order', pg_temp.val_as('@A@', $$select string_agg(bucket, ',' order by rank) from public.revision_queue()$$) = 'overdue,today,today,upcoming');
select pg_temp.check_('013 rank 1 is the overdue item (CH2, 3 days)', pg_temp.val_as('@A@', $$select entity_id || '|' || days_overdue from public.revision_queue() where rank = 1$$) = '@CH2@|3');
select pg_temp.check_('013 among same-day items the WEAK one comes first (T2 before T1)', pg_temp.val_as('@A@', $$select entity_id from public.revision_queue() where rank = 2$$) = '@T2@');
select pg_temp.check_('013 ranks are 1..n without gaps or duplicates', pg_temp.val_as('@A@', $$select (count(distinct rank) = count(*) and min(rank) = 1 and max(rank) = count(*))::text from public.revision_queue()$$) = 'true');
select pg_temp.check_('013 days_until for the upcoming item is 4', pg_temp.val_as('@A@', $$select days_until::text from public.revision_queue() where bucket = 'upcoming'$$) = '4');
select pg_temp.check_('013 each row carries mastery, confidence and the user''s ladder', pg_temp.val_as('@A@', $$select mastery || '|' || confidence || '|' || ladder::text from public.revision_queue() where entity_id = '@T2@'$$) = 'weak|1|{1,3,7,15,30}');
-- oldest due beats weak: make T1 older than T2 -> T1 first
update revision_schedule set due_date = '2026-09-29' where user_id = '@A@' and entity_id = '@T1@' and not done;
update revision_schedule set due_date = '2026-09-30' where user_id = '@A@' and entity_id = '@T2@' and not done;
select pg_temp.check_('013 oldest due beats weak (among overdue: CH2, then T1, then T2)', pg_temp.val_as('@A@', $$select string_agg(entity_id::text, ',' order by rank) from public.revision_queue() where bucket = 'overdue'$$) = '@CH2@,@T1@,@T2@');
update revision_schedule set due_date = '2026-10-01' where user_id = '@A@' and entity_id in ('@T1@', '@T2@') and not done;
-- single source of truth: the first due item equals the first revision item of daily_focus()
select pg_temp.check_('013 first due queue row = first revision row of daily_focus()', pg_temp.val_as('@A@', $$select entity_id from public.daily_focus(10) where kind in ('overdue_revision', 'due_revision') order by rank limit 1$$)
  = pg_temp.val_as('@A@', $$select entity_id from public.revision_queue() where bucket in ('overdue', 'today') order by rank limit 1$$));
select pg_temp.check_('013 overdue revision surfaces in daily_focus as overdue_revision', pg_temp.val_as('@A@', $$select kind from public.daily_focus(10) where entity_id = '@CH2@'$$) = 'overdue_revision');
-- ownership
select pg_temp.check_('013 B sees none of A''s queue', pg_temp.rows_as('@B@', $$select * from public.revision_queue()$$) = 0);
select pg_temp.check_('013 anonymous cannot call revision_queue', pg_temp.rows_as(null, $$select * from public.revision_queue()$$) = -1);
select pg_temp.check_('013 revision_queue is executable by authenticated, not anon', has_function_privilege('authenticated', 'public.revision_queue()'::regprocedure, 'execute') and not has_function_privilege('anon', 'public.revision_queue()'::regprocedure, 'execute'));
select pg_temp.owner_try($$update ssc_topics set archived = true where id = '@T2@'$$);
select pg_temp.check_('013 an archived item disappears from the queue', pg_temp.val_as('@A@', $$select count(*)::text from public.revision_queue() where entity_id = '@T2@'$$) = '0');
select pg_temp.owner_try($$update ssc_topics set archived = false where id = '@T2@'$$);
select pg_temp.check_('013 and returns when it is un-archived', pg_temp.val_as('@A@', $$select count(*)::text from public.revision_queue() where entity_id = '@T2@'$$) = '1');
-- custom ladder shows up in the queue and in scheduling.
-- Two DIFFERENT anchors, both by design (008): COMPLETING an item seeds its first revision at today + ladder[1]; schedule_revision() ("revise this now") pulls an open
-- revision to TODAY (or opens one due today) and records interval_days = ladder[1].
select pg_temp.rows_as('@B@', $$select public.set_progress('ssc_topic', '@T1@', 'completed', 100, 3)$$);
select pg_temp.check_('013 custom ladder: COMPLETING seeds B''s first revision at +2 days (ladder 2,5,20), step 0, reason completion', pg_temp.val_as('@B@', $$select (due_date - today)::text || '|' || ladder::text || '|' || step || '|' || reason from public.revision_queue()$$) = '2|{2,5,20}|0|completion');
select pg_temp.rows_as('@B@', $$select public.schedule_revision('ssc_topic', '@T1@')$$);
select pg_temp.check_('013 schedule_revision("revise now") pulls the open revision to TODAY, keeps step 0, still one open row, history untouched', pg_temp.val_as('@B@', $$select (due_date - today)::text || '|' || step || '|' || reason from public.revision_queue()$$) = '0|0|manual'
  and (select count(*) = 1 from revision_schedule where user_id = '@B@' and entity_id = '@T1@' and not done) and (select count(*) = 0 from revision_reviews where user_id = '@B@'));

-- ---------------- revision_next as the interval preview (pure, client-callable, any ladder) ----------------
select pg_temp.check_('013 preview Good from step 1 on 2,5,20 -> step 2, 20 days', pg_temp.val_as('@B@', $$select step || '|' || interval_days from public.revision_next(1, 'good', '{2,5,20}', date '2026-10-01')$$) = '2|20');
select pg_temp.check_('013 preview Hard from step 2 -> step 1 and the SHORTEST interval (2)', pg_temp.val_as('@B@', $$select step || '|' || interval_days from public.revision_next(2, 'hard', '{2,5,20}', date '2026-10-01')$$) = '1|2');
select pg_temp.check_('013 preview Easy from step 1 on 3 steps graduates (no interval, no date)', pg_temp.val_as('@B@', $$select graduated::text || '|' || coalesce(interval_days::text, 'null') from public.revision_next(1, 'easy', '{2,5,20}', date '2026-10-01')$$) = 'true|null');
select pg_temp.check_('013 preview uses the ladder it is given (default ladder: Good from step 0 -> 3 days)', pg_temp.val_as('@A@', $$select interval_days::text from public.revision_next(0, 'good', '{1,3,7,15,30}', date '2026-10-01')$$) = '3');

-- NOTE (harness rule 1): a SELECT cannot see rows written by a volatile function called in the SAME statement, so each action runs in its own statement
-- (results kept in t_ret) and the state it produced is verified in the next one.
-- ---------------- review: Good ----------------
insert into t_runs (k, id) select 'p7ch2', id from revision_schedule where user_id = '@A@' and entity_id = '@CH2@' and not done;
insert into t_ret select 'good1', pg_temp.rows_as('@A@', format($f$select public.review_revision(%L, 'good', 1)$f$, (select id from t_runs where k = 'p7ch2')));
select pg_temp.check_('013 Good at step 1: the RPC succeeded', (select n from t_ret where k = 'good1') >= 0, (select 'rows_as=' || n from t_ret where k = 'good1'));
select pg_temp.check_('013 Good at step 1 -> step 2, due +7 days (ladder 1,3,7,15,30 from the review date), one history row appended', (select step || '|' || due_date from revision_schedule where id = (select id from t_runs where k = 'p7ch2')) = '2|2026-10-08'
  and (select count(*) = 1 and bool_and(rating = 'good' and step_before = 1 and step_after = 2 and interval_days_after = 7 and not graduated) from revision_reviews where user_id = '@A@' and entity_id = '@CH2@'));
select pg_temp.check_('013 reviewed item leaves the overdue bucket (becomes upcoming)', pg_temp.val_as('@A@', $$select bucket from public.revision_queue() where entity_id = '@CH2@'$$) = 'upcoming');
-- ---------------- duplicate / stale ----------------
select pg_temp.check_('013 duplicate review with the old expected_step is rejected', pg_temp.rows_as('@A@', format($f$select public.review_revision(%L, 'good', 1)$f$, (select id from t_runs where k = 'p7ch2'))) = -1);
select pg_temp.check_('013 the duplicate changed nothing (still one history row, still step 2)', (select count(*) = 1 from revision_reviews where user_id = '@A@' and entity_id = '@CH2@') and (select step = 2 from revision_schedule where id = (select id from t_runs where k = 'p7ch2')));
insert into t_runs (k, id) select 'p7t1', id from revision_schedule where user_id = '@A@' and entity_id = '@T1@' and not done;
select pg_temp.check_('013 wrong expected_step (3, actual 2) is rejected and writes nothing', pg_temp.rows_as('@A@', format($f$select public.review_revision(%L, 'easy', 3)$f$, (select id from t_runs where k = 'p7t1'))) = -1
  and (select count(*) = 0 from revision_reviews where user_id = '@A@' and entity_id = '@T1@') and (select step = 2 from revision_schedule where id = (select id from t_runs where k = 'p7t1')));
select pg_temp.check_('013 unknown rating rejected', pg_temp.rows_as('@A@', format($f$select public.review_revision(%L, 'perfect', 2)$f$, (select id from t_runs where k = 'p7t1'))) = -1);
select pg_temp.check_('013 confidence outside 1..5 rejected', pg_temp.rows_as('@A@', format($f$select public.review_revision(%L, 'good', 2, 9)$f$, (select id from t_runs where k = 'p7t1'))) = -1);
-- ---------------- Hard ----------------
insert into t_ret select 'hard1', pg_temp.rows_as('@A@', format($f$select public.review_revision(%L, 'hard', 2, 2)$f$, (select id from t_runs where k = 'p7t1')));
select pg_temp.check_('013 Hard at step 2: the RPC succeeded', (select n from t_ret where k = 'hard1') >= 0, (select 'rows_as=' || n from t_ret where k = 'hard1'));
select pg_temp.check_('013 Hard at step 2 -> step 1, interval = shortest (1 day), history appended not reset', (select step || '|' || due_date from revision_schedule where id = (select id from t_runs where k = 'p7t1')) = '1|2026-10-02'
  and (select count(*) = 1 and bool_and(rating = 'hard' and step_before = 2 and step_after = 1 and interval_days_after = 1 and confidence = 2) from revision_reviews where user_id = '@A@' and entity_id = '@T1@'));
insert into t_ret select 'hard2', pg_temp.rows_as('@A@', format($f$select public.review_revision(%L, 'hard', 1)$f$, (select id from t_runs where k = 'p7t1')));
select pg_temp.check_('013 a second Hard keeps adding history (2 rows), the first one is untouched, step 0', (select n from t_ret where k = 'hard2') >= 0
  and (select count(*) = 2 from revision_reviews where user_id = '@A@' and entity_id = '@T1@') and (select step = 0 from revision_schedule where id = (select id from t_runs where k = 'p7t1'))
  and (select count(*) = 1 from revision_reviews where user_id = '@A@' and entity_id = '@T1@' and step_before = 2 and step_after = 1 and interval_days_after = 1));
insert into t_ret select 'hard3', pg_temp.rows_as('@A@', format($f$select public.review_revision(%L, 'hard', 0)$f$, (select id from t_runs where k = 'p7t1')));
select pg_temp.check_('013 Hard at step 0 stays at step 0 (floor) and still appends history', (select n from t_ret where k = 'hard3') >= 0 and (select step = 0 from revision_schedule where id = (select id from t_runs where k = 'p7t1'))
  and (select count(*) = 3 from revision_reviews where user_id = '@A@' and entity_id = '@T1@'));
select pg_temp.check_('013 repeated Hard reviews leave the learning engine reporting the item as weak (reason is server-derived)', pg_temp.val_as('@A@', $$select mastery || '|' || (weak_reason is not null)::text from public.user_entity_signals('ssc_topic', '@T1@')$$) = 'weak|true');
-- ---------------- Easy + graduation ----------------
insert into t_runs (k, id) select 'p7st1', id from revision_schedule where user_id = '@A@' and entity_id = '@ST1@' and not done;
insert into t_ret select 'easy1', pg_temp.rows_as('@A@', format($f$select public.review_revision(%L, 'easy', 3)$f$, (select id from t_runs where k = 'p7st1')));
select pg_temp.check_('013 Easy at step 3 of 5 (3 + 2 = past the last step) graduates: row closed, no open row, history says graduated', (select n from t_ret where k = 'easy1') >= 0
  and (select done from revision_schedule where id = (select id from t_runs where k = 'p7st1')) and (select count(*) = 0 from revision_schedule where user_id = '@A@' and entity_id = '@ST1@' and not done)
  and (select count(*) = 1 and bool_and(graduated and interval_days_after is null) from revision_reviews where user_id = '@A@' and entity_id = '@ST1@'));
select pg_temp.check_('013 graduated item leaves the queue', pg_temp.rows_as('@A@', $$select * from public.revision_queue() where entity_id = '@ST1@'$$) = 0);
select pg_temp.check_('013 graduation does not delete progress (the item is still in the learner''s study list)', (select count(*) = 1 from user_progress where user_id = '@A@' and entity_id = '@ST1@'));
select pg_temp.check_('013 reviewing a CLOSED schedule is rejected', pg_temp.rows_as('@A@', format($f$select public.review_revision(%L, 'good', 4)$f$, (select id from t_runs where k = 'p7st1'))) = -1);
insert into t_ret select 'resched', pg_temp.rows_as('@A@', $$select public.schedule_revision('ssc_subtopic', '@ST1@')$$);
select pg_temp.check_('013 a graduated item can be scheduled again explicitly (one new open row, due today, step 0; the closed row and its history stay)', (select n from t_ret where k = 'resched') >= 0
  and (select count(*) = 1 from revision_schedule where user_id = '@A@' and entity_id = '@ST1@' and not done) and (select count(*) = 1 from revision_schedule where user_id = '@A@' and entity_id = '@ST1@' and done)
  and (select count(*) = 1 from revision_reviews where user_id = '@A@' and entity_id = '@ST1@'));
-- ---------------- custom ladder, full path for B ----------------
insert into t_runs (k, id) select 'p7b', id from revision_schedule where user_id = '@B@' and entity_id = '@T1@' and not done;
select pg_temp.set_now('2026-10-03 12:00:00+00');
insert into t_ret select 'bgood', pg_temp.rows_as('@B@', format($f$select public.review_revision(%L, 'good', 0)$f$, (select id from t_runs where k = 'p7b')));
select pg_temp.check_('013 B Good at step 0 on ladder 2,5,20 -> step 1, due +5 from the REVIEW date (2026-10-03 + 5)', (select n from t_ret where k = 'bgood') >= 0
  and (select step || '|' || due_date from revision_schedule where id = (select id from t_runs where k = 'p7b')) = '1|2026-10-08');
select pg_temp.owner_try($$update profiles set revision_intervals = '{1,2}' where id = '@B@'$$);
select pg_temp.check_('013 changing the ladder later does not rewrite history', (select revision_intervals = '{1,2}' from profiles where id = '@B@') and (select interval_days_after = 5 from revision_reviews where user_id = '@B@' and entity_id = '@T1@'));
select pg_temp.set_now('2026-10-01 12:00:00+00');
-- ---------------- append-only + cross-user ----------------
select pg_temp.check_('013 history cannot be UPDATEd by the owner role (append-only trigger)', pg_temp.owner_try($$update revision_reviews set rating = 'easy' where user_id = '@A@'$$) = -1);
select pg_temp.check_('013 history cannot be DELETEd directly', pg_temp.owner_try($$delete from revision_reviews where user_id = '@A@'$$) = -1);
select pg_temp.check_('013 clients cannot write history or schedule rows', pg_temp.rows_as('@A@', $$update revision_reviews set rating = 'easy'$$) = -1 and pg_temp.rows_as('@A@', $$delete from revision_reviews$$) = -1
  and pg_temp.rows_as('@A@', $$insert into revision_reviews (user_id, entity_type, entity_id, due_date, reviewed_on, rating) values ('@A@', 'ssc_topic', '@T1@', current_date, current_date, 'easy')$$) = -1
  and pg_temp.rows_as('@A@', $$update revision_schedule set due_date = date '2030-01-01'$$) = -1);
select pg_temp.check_('013 B cannot read A''s reviews or schedule rows', pg_temp.rows_as('@B@', $$select * from revision_reviews where user_id = '@A@'$$) = 0 and pg_temp.rows_as('@B@', $$select * from revision_schedule where user_id = '@A@'$$) = 0);
select pg_temp.check_('013 B cannot review A''s schedule (looks like not found)', pg_temp.rows_as('@B@', format($f$select public.review_revision(%L, 'easy', 2)$f$, (select id from t_runs where k = 'p7t1'))) = -1);
select pg_temp.check_('013 anonymous cannot review', pg_temp.rows_as(null, format($f$select public.review_revision(%L, 'easy', 2)$f$, (select id from t_runs where k = 'p7t1'))) = -1);
select pg_temp.check_('013 A''s history is intact after all attempts (CH2:1, T1:3, ST1:1 reviews)', (select count(*) from revision_reviews where user_id = '@A@') = 5);
