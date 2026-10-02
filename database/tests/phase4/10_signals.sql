-- ============ 010 learning signals ============
select pg_temp.set_now('2026-10-01 12:00:00+00');
\ir ../reference/generated_vectors.sql
-- helper scenario for user F on topics T1 (mapped to chapter CH1) / T2 / T3 and chapter CH1, CH2
select pg_temp.check_('010 priority_rank order', public.priority_rank('very_high') > public.priority_rank('high') and public.priority_rank('high') > public.priority_rank('medium') and public.priority_rank('medium') > public.priority_rank('low'));
select pg_temp.check_('010 signals empty for a user with no progress', pg_temp.rows_as('@F@', 'select 1 from public.user_entity_signals()') = 0);
select pg_temp.check_('010 daily_focus start_next skips topics whose foundation chapter is not completed', pg_temp.val_as('@F@', $$select entity_id::text from public.daily_focus() where kind = 'start_next' order by rank limit 1$$) is distinct from '@T1@');
select pg_temp.check_('010 start_next offers a topic with no foundation requirement', pg_temp.val_as('@F@', $$select count(*)::text from public.daily_focus() where entity_id in ('@T2@','@T3@')$$) = '2');
-- complete the foundation chapter => T1 becomes startable
select pg_temp.rows_as('@F@', $$select public.set_progress('ncert_chapter', '@CH1@', 'completed')$$);
select pg_temp.check_('010 after the foundation chapter is done T1 is offered', pg_temp.val_as('@F@', $$select count(*)::text from public.daily_focus() where entity_id = '@T1@' and kind = 'start_next'$$) = '1');
-- ordering: picked > overdue > due > weak > continue > start
insert into tasks (user_id, title, entity_type, entity_id, due_date) values ('@F@', 'TEST picked', 'ssc_topic', '@T3@', date '2026-10-01');
select pg_temp.rows_as('@F@', $$select public.set_progress('ssc_topic', '@T2@', 'completed')$$);      -- seeds a revision due 10-02
update revision_schedule set due_date = date '2026-09-28' where user_id = '@F@' and entity_id = '@T2@' and not done;   -- overdue by 3
select pg_temp.rows_as('@F@', $$select public.set_progress('ssc_subtopic', '@ST1@', 'learning', 20)$$);
select pg_temp.rows_as('@F@', $$select public.set_progress('ssc_topic', '@T1@', 'learning', 40, 2)$$);     -- weak by low confidence
select pg_temp.check_('010 focus order: picked first', pg_temp.val_as('@F@', $$select kind from public.daily_focus() order by rank limit 1$$) = 'picked');
select pg_temp.check_('010 focus order: overdue revision second', pg_temp.val_as('@F@', $$select kind from public.daily_focus() order by rank offset 1 limit 1$$) = 'overdue_revision');
select pg_temp.check_('010 focus order: weak after revisions', pg_temp.val_as('@F@', $$select kind from public.daily_focus() order by rank offset 2 limit 1$$) = 'weak');
select pg_temp.check_('010 every focus row has a non-empty reason', pg_temp.val_as('@F@', $$select count(*)::text from public.daily_focus() where coalesce(btrim(reason), '') = ''$$) = '0');
select pg_temp.check_('010 an item appears at most once (dedupe)', pg_temp.val_as('@F@', $$select (count(*) - count(distinct (entity_type, entity_id)))::text from public.daily_focus()$$) = '0');
select pg_temp.check_('010 focus is capped at 5', pg_temp.val_as('@F@', $$select (count(*) <= 5)::text from public.daily_focus(50)$$) = 'true');
select pg_temp.check_('010 focus is private (B sees nothing of F)', pg_temp.val_as('@B@', $$select count(*)::text from public.daily_focus() where kind in ('overdue_revision','weak','picked')$$) = '0');
select pg_temp.check_('010 anonymous cannot call daily_focus / signals / dashboard', pg_temp.rows_as(null, 'select * from public.daily_focus()') = -1 and pg_temp.rows_as(null, 'select * from public.user_entity_signals()') = -1 and pg_temp.rows_as(null, 'select * from public.dashboard_summary()') = -1);
-- topic mastery uses subtopic completion
select pg_temp.check_('010 topic with subtopics shows subtopic-derived completion (0 of 1 done => 0)', pg_temp.val_as('@F@', $$select completion::text from public.user_entity_signals('ssc_topic', '@T1@')$$) = '0');
select pg_temp.rows_as('@F@', $$select public.set_progress('ssc_subtopic', '@ST1@', 'completed')$$);
select pg_temp.check_('010 ... and 100 once its only subtopic is completed', pg_temp.val_as('@F@', $$select completion::text from public.user_entity_signals('ssc_topic', '@T1@')$$) = '100');
-- archived entities leave every count and the focus list
select pg_temp.owner_try($$update ssc_topics set archived = true where id = '@T3@'$$);
select pg_temp.check_('010 archived topic disappears from focus', pg_temp.val_as('@F@', $$select count(*)::text from public.daily_focus() where entity_id = '@T3@'$$) = '0');
select pg_temp.check_('010 archived topic disappears from signals', pg_temp.rows_as('@F@', $$select 1 from public.user_entity_signals('ssc_topic', '@T3@')$$) = 0);
update ssc_topics set archived = false where id = '@T3@';
-- dashboard denominators
create temp table t_dash (k text primary key, v int);
insert into t_dash select 'before', pg_temp.val_as('@F@', $$select ncert_total::text from public.dashboard_summary()$$)::int;
select pg_temp.check_('010 CH1 (recommended mapping) is counted, CH2 (unmapped) is not: un-recommending CH1 lowers the NCERT total by exactly 1',
  pg_temp.owner_try($$update ncert_ssc_mappings set recommended = false where id = '@MAP1@'$$) = 1
  and pg_temp.val_as('@F@', $$select ncert_total::text from public.dashboard_summary()$$)::int = (select v - 1 from t_dash where k = 'before'));
update ncert_ssc_mappings set recommended = true where id = '@MAP1@';
select pg_temp.check_('010 restoring the mapping restores the total', pg_temp.val_as('@F@', $$select ncert_total::text from public.dashboard_summary()$$)::int = (select v from t_dash where k = 'before'));
select pg_temp.check_('010 an unmapped chapter never inflates the total (completing CH2 leaves ncert_total unchanged)', pg_temp.rows_as('@F@', $$select public.set_progress('ncert_chapter', '@CH2@', 'completed')$$) = 1
  and pg_temp.val_as('@F@', $$select ncert_total::text from public.dashboard_summary()$$)::int = (select v from t_dash where k = 'before'));
select pg_temp.check_('010 percentages never exceed 100', pg_temp.val_as('@F@', $$select (ncert_percent <= 100 and ssc_percent <= 100 and overall_percent <= 100 and pyq_percent <= 100 and revision_percent <= 100)::text from public.dashboard_summary()$$) = 'true');
select pg_temp.check_('010 done counts never exceed totals', pg_temp.val_as('@F@', $$select (ncert_done <= ncert_total and ssc_done <= ssc_total)::text from public.dashboard_summary()$$) = 'true');
select pg_temp.check_('010 dashboard shows F completed topics (T2 done => ssc_done >= 1)', pg_temp.val_as('@F@', $$select (ssc_done >= 1)::text from public.dashboard_summary()$$) = 'true');
select pg_temp.check_('010 dashboard revisions_due counts the overdue one', pg_temp.val_as('@F@', $$select (revisions_due >= 1)::text from public.dashboard_summary()$$) = 'true');
select pg_temp.check_('010 dashboard is isolated: B has no progress, no due revisions', pg_temp.val_as('@B@', $$select (ssc_done = 0 and revisions_due = 0 and weak_count = 0)::text from public.dashboard_summary()$$) = 'true');
select pg_temp.check_('010 today seconds respect the user timezone day', pg_temp.val_as('@A@', $$select today_seconds::text from public.dashboard_summary()$$) is not null);
