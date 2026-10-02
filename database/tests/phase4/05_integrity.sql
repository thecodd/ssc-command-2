-- ============ 005 integrity + indexes ============
select pg_temp.check_('005 index exists: ' || i, exists (select 1 from pg_indexes where schemaname = 'public' and indexname = i))
  from unnest(array['books_natural_key','chapters_official_key','chapters_custom_key','ssc_topics_official_key','pyq_topics_topic_idx','pyq_attempts_user_pyq_idx','revision_open_due_idx','tasks_open_due_idx','resources_entity_idx']) i;
select pg_temp.check_('005 owner FK is ON DELETE CASCADE: ' || t,
  (select confdeltype from pg_constraint where conname = t || '_owner_id_fkey' and conrelid = ('public.' || t)::regclass) = 'c')
  from unnest(array['chapters','concepts','ssc_topics','ssc_subtopics','pyqs']) t;
-- natural keys
select pg_temp.check_('005 duplicate official chapter rejected', pg_temp.owner_try($$insert into chapters (book_id, title) values ('@BK1@', 'TEST official chapter')$$) = -1);
select pg_temp.check_('005 same title in another book allowed', pg_temp.owner_try($$insert into chapters (book_id, title) values ('@BKD@', 'TEST official chapter')$$) = 1);
select pg_temp.check_('005 duplicate official topic rejected', pg_temp.owner_try($$insert into ssc_topics (subject_id, title) values ('@SS1@', 'TEST official topic')$$) = -1);
select pg_temp.check_('005 duplicate book (same edition) rejected', pg_temp.owner_try($$insert into books (subject_id, title) values ('@SUBJ@', 'TEST book')$$) = -1);
select pg_temp.check_('005 same book, new edition allowed', pg_temp.owner_try($$insert into books (subject_id, title, edition) values ('@SUBJ@', 'TEST book', '2030')$$) = 1);
select pg_temp.check_('005 first custom chapter for an owner accepted', pg_temp.owner_try($$insert into chapters (book_id, title, owner_id) values ('@BK1@', 'TEST mine', '@A@')$$) = 1);
select pg_temp.check_('005 duplicate custom chapter for the same owner rejected', pg_temp.owner_try($$insert into chapters (book_id, title, owner_id) values ('@BK1@', 'TEST mine', '@A@')$$) = -1);
select pg_temp.check_('005 same custom title for another owner allowed', pg_temp.owner_try($$insert into chapters (book_id, title, owner_id) values ('@BK1@', 'TEST mine', '@B@')$$) = 1);
-- deleting a user with custom content is NOT blocked, and the content goes with them
insert into chapters (id, book_id, title, owner_id) values ('@CHDEL@', '@BK1@', 'TEST D custom chapter', '@D@');
insert into ssc_topics (id, subject_id, title, owner_id) values ('@TDEL@', '@SS1@', 'TEST D custom topic', '@D@');
insert into pyqs (id, question, owner_id) values ('@QDEL@', 'TEST D custom question', '@D@');
insert into notes (user_id, entity_type, entity_id, content) values ('@D@', 'ncert_chapter', '@CHDEL@', 'note on a custom chapter');
select pg_temp.check_('005 deleting a user with custom content succeeds', pg_temp.owner_try($$delete from auth.users where id = '@D@'$$) = 1);
select pg_temp.check_('005 ... and their custom rows are gone', (select count(*) from chapters where owner_id = '@D@') + (select count(*) from ssc_topics where owner_id = '@D@') + (select count(*) from pyqs where owner_id = '@D@') + (select count(*) from notes where user_id = '@D@') = 0);
-- official rows cannot be hard-deleted through the API (admin JWT), but the break-glass (no JWT) path still works
select pg_temp.check_('005 admin cannot delete official chapter', pg_temp.rows_as('@C@', $$delete from chapters where id = '@CH2@'$$) = -1);
select pg_temp.check_('005 admin cannot delete a published book', pg_temp.rows_as('@C@', $$delete from books where id = '@BK1@'$$) = -1);
select pg_temp.check_('005 admin cannot delete an exam version', pg_temp.rows_as('@C@', $$delete from ssc_exams where id = '@EX1@'$$) = -1);
select pg_temp.check_('005 admin cannot delete a source', pg_temp.rows_as('@C@', $$delete from sources where id = '@SRC1@'$$) = -1);
insert into chapters (id, book_id, title) values ('@CHTMP@', '@BK1@', 'TEST throwaway official');
select pg_temp.check_('005 break-glass (no JWT) delete still works', pg_temp.owner_try($$delete from chapters where id = '@CHTMP@'$$) = 1);
-- tasks
select pg_temp.check_('005 task with half an entity reference rejected', pg_temp.rows_as('@A@', $$insert into tasks (user_id, title, entity_type) values ('@A@', 'x', 'ssc_topic')$$) = -1);
select pg_temp.rows_as('@A@', $$insert into tasks (id, user_id, title) values ('@TASK0@', '@A@', 'TEST plain task')$$);
select pg_temp.rows_as('@A@', $$update tasks set status = 'completed' where id = '@TASK0@'$$);
select pg_temp.check_('005 task completed_at set when completed', (select completed_at from tasks where id = '@TASK0@') = timestamptz '2026-10-01 12:00:00+00');
select pg_temp.rows_as('@A@', $$update tasks set status = 'todo' where id = '@TASK0@'$$);
select pg_temp.check_('005 task completed_at cleared when reopened', (select completed_at from tasks where id = '@TASK0@') is null);
-- notes.updated_at maintained
insert into notes (id, user_id, entity_type, entity_id, content) values ('@NOTE0@', '@A@', 'ssc_topic', '@T1@', 'first');
select pg_temp.set_now('2026-10-01 13:00:00+00');
update notes set content = 'second' where id = '@NOTE0@';
select pg_temp.check_('005 notes.updated_at follows the app clock', (select updated_at from notes where id = '@NOTE0@') = timestamptz '2026-10-01 13:00:00+00');
select pg_temp.set_now('2026-10-01 12:00:00+00');
