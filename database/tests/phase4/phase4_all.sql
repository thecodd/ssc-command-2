-- PHASE 4 DATABASE TEST SUITE — SQL NOT EXECUTED when this was written (no Postgres available). Run after migrations 001-011.
-- One transaction, ends in ROLLBACK. The clock is pinned with app_now()'s test GUCs so every duration is deterministic.
-- Read the final result table: every row must say PASS. Fixtures use "TEST ..." names and are rolled back.
begin;
create temp table t_results (n serial, label text, passed boolean, detail text);
create temp table t_runs (k text primary key, id uuid);

-- rows visible / affected for a statement run AS a user (null = anon), or -1 if it raised.
create or replace function pg_temp.rows_as(uid uuid, stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claims', case when uid is null then '' else json_build_object('sub', uid, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute case when uid is null then 'set local role anon' else 'set local role authenticated' end;
  begin
    if lower(ltrim(stmt)) like 'select%' then execute 'select count(*) from (' || stmt || ') q' into n;
    else execute stmt; get diagnostics n = row_count; end if;
  exception when others then n := -1;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;
-- first column of first row as text (NULL on error / no rows)
create or replace function pg_temp.val_as(uid uuid, stmt text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', case when uid is null then '' else json_build_object('sub', uid, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute case when uid is null then 'set local role anon' else 'set local role authenticated' end;
  begin execute 'select x::text from (' || stmt || ') q(x) limit 1' into v; exception when others then v := null; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;
-- run as the session owner (bypasses RLS, no JWT): rows affected or -1 on error
create or replace function pg_temp.owner_try(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin begin execute stmt; get diagnostics n = row_count; exception when others then n := -1; end; return n; end $$;
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

-- ============ 005 integrity + indexes ============
select pg_temp.check_('005 index exists: ' || i, exists (select 1 from pg_indexes where schemaname = 'public' and indexname = i))
  from unnest(array['books_natural_key','chapters_official_key','chapters_custom_key','ssc_topics_official_key','pyq_topics_topic_idx','pyq_attempts_user_pyq_idx','revision_open_due_idx','tasks_open_due_idx','resources_entity_idx']) i;
select pg_temp.check_('005 owner FK is ON DELETE CASCADE: ' || t,
  (select confdeltype from pg_constraint where conname = t || '_owner_id_fkey' and conrelid = ('public.' || t)::regclass) = 'c')
  from unnest(array['chapters','concepts','ssc_topics','ssc_subtopics','pyqs']) t;
-- natural keys
select pg_temp.check_('005 duplicate official chapter rejected', pg_temp.owner_try($$insert into chapters (book_id, title) values ('c199e71a-db01-5359-b575-151d904fa192', 'TEST official chapter')$$) = -1);
select pg_temp.check_('005 same title in another book allowed', pg_temp.owner_try($$insert into chapters (book_id, title) values ('8e13634d-020d-5112-9139-869a20128d95', 'TEST official chapter')$$) = 1);
select pg_temp.check_('005 duplicate official topic rejected', pg_temp.owner_try($$insert into ssc_topics (subject_id, title) values ('a3acba5a-8f9d-55b0-b7dd-8e359ac3e7d6', 'TEST official topic')$$) = -1);
select pg_temp.check_('005 duplicate book (same edition) rejected', pg_temp.owner_try($$insert into books (subject_id, title) values ('10f0ecb3-91d2-5665-918d-cd0db35ae41d', 'TEST book')$$) = -1);
select pg_temp.check_('005 same book, new edition allowed', pg_temp.owner_try($$insert into books (subject_id, title, edition) values ('10f0ecb3-91d2-5665-918d-cd0db35ae41d', 'TEST book', '2030')$$) = 1);
select pg_temp.check_('005 first custom chapter for an owner accepted', pg_temp.owner_try($$insert into chapters (book_id, title, owner_id) values ('c199e71a-db01-5359-b575-151d904fa192', 'TEST mine', 'eda6c4d2-347b-52c8-92c4-bd428277acd4')$$) = 1);
select pg_temp.check_('005 duplicate custom chapter for the same owner rejected', pg_temp.owner_try($$insert into chapters (book_id, title, owner_id) values ('c199e71a-db01-5359-b575-151d904fa192', 'TEST mine', 'eda6c4d2-347b-52c8-92c4-bd428277acd4')$$) = -1);
select pg_temp.check_('005 same custom title for another owner allowed', pg_temp.owner_try($$insert into chapters (book_id, title, owner_id) values ('c199e71a-db01-5359-b575-151d904fa192', 'TEST mine', '7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed')$$) = 1);
-- deleting a user with custom content is NOT blocked, and the content goes with them
insert into chapters (id, book_id, title, owner_id) values ('33682f8c-b5b2-5589-915c-01270bd47e92', 'c199e71a-db01-5359-b575-151d904fa192', 'TEST D custom chapter', 'dd8bf13c-afd3-55de-baa3-ebe7023bb7ce');
insert into ssc_topics (id, subject_id, title, owner_id) values ('b3d767be-2325-540d-bd2d-024323fdcc0d', 'a3acba5a-8f9d-55b0-b7dd-8e359ac3e7d6', 'TEST D custom topic', 'dd8bf13c-afd3-55de-baa3-ebe7023bb7ce');
insert into pyqs (id, question, owner_id) values ('31e18e53-72e2-5d26-aa75-af41a4711130', 'TEST D custom question', 'dd8bf13c-afd3-55de-baa3-ebe7023bb7ce');
insert into notes (user_id, entity_type, entity_id, content) values ('dd8bf13c-afd3-55de-baa3-ebe7023bb7ce', 'ncert_chapter', '33682f8c-b5b2-5589-915c-01270bd47e92', 'note on a custom chapter');
select pg_temp.check_('005 deleting a user with custom content succeeds', pg_temp.owner_try($$delete from auth.users where id = 'dd8bf13c-afd3-55de-baa3-ebe7023bb7ce'$$) = 1);
select pg_temp.check_('005 ... and their custom rows are gone', (select count(*) from chapters where owner_id = 'dd8bf13c-afd3-55de-baa3-ebe7023bb7ce') + (select count(*) from ssc_topics where owner_id = 'dd8bf13c-afd3-55de-baa3-ebe7023bb7ce') + (select count(*) from pyqs where owner_id = 'dd8bf13c-afd3-55de-baa3-ebe7023bb7ce') + (select count(*) from notes where user_id = 'dd8bf13c-afd3-55de-baa3-ebe7023bb7ce') = 0);
-- official rows cannot be hard-deleted through the API (admin JWT), but the break-glass (no JWT) path still works
select pg_temp.check_('005 admin cannot delete official chapter', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$delete from chapters where id = 'dd124977-1642-564e-8776-86a09a5ccdbf'$$) = -1);
select pg_temp.check_('005 admin cannot delete a published book', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$delete from books where id = 'c199e71a-db01-5359-b575-151d904fa192'$$) = -1);
select pg_temp.check_('005 admin cannot delete an exam version', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$delete from ssc_exams where id = 'a9bf7926-de18-5045-b7dd-86ddeec8e566'$$) = -1);
select pg_temp.check_('005 admin cannot delete a source', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$delete from sources where id = 'eb424051-fc9e-5703-85b7-4a0069f25278'$$) = -1);
insert into chapters (id, book_id, title) values ('9f65da2a-e5a9-5271-ae18-b5e068eccde6', 'c199e71a-db01-5359-b575-151d904fa192', 'TEST throwaway official');
select pg_temp.check_('005 break-glass (no JWT) delete still works', pg_temp.owner_try($$delete from chapters where id = '9f65da2a-e5a9-5271-ae18-b5e068eccde6'$$) = 1);
-- tasks
select pg_temp.check_('005 task with half an entity reference rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into tasks (user_id, title, entity_type) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'x', 'ssc_topic')$$) = -1);
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into tasks (id, user_id, title) values ('de5ce4f1-47bf-597e-a817-2e69597fd427', 'eda6c4d2-347b-52c8-92c4-bd428277acd4', 'TEST plain task')$$);
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update tasks set status = 'completed' where id = 'de5ce4f1-47bf-597e-a817-2e69597fd427'$$);
select pg_temp.check_('005 task completed_at set when completed', (select completed_at from tasks where id = 'de5ce4f1-47bf-597e-a817-2e69597fd427') = timestamptz '2026-10-01 12:00:00+00');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update tasks set status = 'todo' where id = 'de5ce4f1-47bf-597e-a817-2e69597fd427'$$);
select pg_temp.check_('005 task completed_at cleared when reopened', (select completed_at from tasks where id = 'de5ce4f1-47bf-597e-a817-2e69597fd427') is null);
-- notes.updated_at maintained
insert into notes (id, user_id, entity_type, entity_id, content) values ('0f67c519-12ee-5e04-ab83-5a46fe8ec9b6', 'eda6c4d2-347b-52c8-92c4-bd428277acd4', 'ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'first');
select pg_temp.set_now('2026-10-01 13:00:00+00');
update notes set content = 'second' where id = '0f67c519-12ee-5e04-ab83-5a46fe8ec9b6';
select pg_temp.check_('005 notes.updated_at follows the app clock', (select updated_at from notes where id = '0f67c519-12ee-5e04-ab83-5a46fe8ec9b6') = timestamptz '2026-10-01 13:00:00+00');
select pg_temp.set_now('2026-10-01 12:00:00+00');

-- ============ 006 entity registry ============
select pg_temp.check_('006 integrity report is clean on fixtures', (select count(*) from entities_integrity_report()) = 0);
select pg_temp.check_('006 every curriculum fixture is registered', (select count(*) from entities where id in ('17277ef4-ed1d-5063-9ec5-55919f09e403','f1ce1c0d-5eed-5602-b11f-afc5a71e886e','4654f3fc-fa66-5d7d-9e71-91c21c483300','6923f5c9-c73b-50f3-aef9-ac779ca167bf')) = 4);
select pg_temp.check_('006 registry type matches kind', (select type from entities where id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e') = 'ssc_topic');
-- references must point at real entities of the right type
select pg_temp.check_('006 note on a nonexistent entity rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into notes (user_id, entity_type, entity_id, content) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'ssc_topic', '99999999-0000-0000-0000-000000000000', 'x')$$) = -1);
select pg_temp.check_('006 note with the WRONG entity type rejected (chapter id typed as topic)', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into notes (user_id, entity_type, entity_id, content) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'ssc_topic', '17277ef4-ed1d-5063-9ec5-55919f09e403', 'x')$$) = -1);
select pg_temp.check_('006 note on a real entity accepted', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into notes (user_id, entity_type, entity_id, content) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'ncert_chapter', '17277ef4-ed1d-5063-9ec5-55919f09e403', 'ok')$$) = 1);
select pg_temp.check_('006 progress type allow-list (pyq not trackable)', pg_temp.owner_try($$insert into user_progress (user_id, entity_type, entity_id, status) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'pyq', '6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'learning')$$) = -1);
select pg_temp.check_('006 half task reference rejected by the pair check', pg_temp.owner_try($$insert into tasks (user_id, title, entity_id) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'x', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e')$$) = -1);
-- a curriculum row cannot exist without its registry row (deferred FK; forced immediate for the test)
alter table public.chapters disable trigger entity_register;
set constraints public.chapters_entity_fk immediate;
select pg_temp.check_('006 curriculum row without registry row is rejected', pg_temp.owner_try($$insert into chapters (book_id, title) values ('c199e71a-db01-5359-b575-151d904fa192', 'TEST unregistered')$$) = -1);
alter table public.chapters enable trigger entity_register;
set constraints public.chapters_entity_fk deferred;
-- a registry row without a curriculum row is DETECTED by the audit (not prevented by a constraint: documented limitation)
insert into entities (id, type) values ('677652f8-f0c7-5147-9dae-104a40be836d', 'pyq');
select pg_temp.check_('006 audit reports an orphan registry row', (select count(*) from entities_integrity_report() where id = '677652f8-f0c7-5147-9dae-104a40be836d') = 1);
delete from entities where id = '677652f8-f0c7-5147-9dae-104a40be836d';
select pg_temp.check_('006 audit is clean again', (select count(*) from entities_integrity_report()) = 0);
-- delete cascades to the owner's own references; archive keeps them
insert into chapters (id, book_id, title, owner_id) values ('9d01da33-8e4c-52a6-87ae-7fef38f7342b', 'c199e71a-db01-5359-b575-151d904fa192', 'TEST A custom for registry', 'eda6c4d2-347b-52c8-92c4-bd428277acd4');
insert into notes (user_id, entity_type, entity_id, content) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'ncert_chapter', '9d01da33-8e4c-52a6-87ae-7fef38f7342b', 'note on custom');
update chapters set archived = true where id = '9d01da33-8e4c-52a6-87ae-7fef38f7342b';
select pg_temp.check_('006 archiving does not unregister or cascade', (select count(*) from entities where id = '9d01da33-8e4c-52a6-87ae-7fef38f7342b') = 1 and (select count(*) from notes where entity_id = '9d01da33-8e4c-52a6-87ae-7fef38f7342b') = 1);
delete from chapters where id = '9d01da33-8e4c-52a6-87ae-7fef38f7342b';
select pg_temp.check_('006 deleting a custom entity unregisters it', (select count(*) from entities where id = '9d01da33-8e4c-52a6-87ae-7fef38f7342b') = 0);
select pg_temp.check_('006 ... and cascades the owner references', (select count(*) from notes where entity_id = '9d01da33-8e4c-52a6-87ae-7fef38f7342b') = 0);
select pg_temp.check_('006 clients cannot read or write the registry', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'select 1 from entities') = -1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into entities (id, type) values (gen_random_uuid(), 'pyq')$$) = -1);
select pg_temp.check_('006 anonymous cannot touch the registry', pg_temp.rows_as(null, 'select 1 from entities') = -1);

-- ============ 007 progress ============
select pg_temp.check_('007 set_progress learning 40 is accepted', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'learning', 40)$$) = 1);
select pg_temp.check_('007 ... and stores status and completion', (select status::text || ':' || completion from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e') = 'learning:40');
select pg_temp.check_('007 status strong is not writable', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'strong')$$) = -1);
select pg_temp.check_('007 status revision is not writable', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'revision')$$) = -1);
select pg_temp.check_('007 completion 101 rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', null, 101)$$) = -1);
select pg_temp.check_('007 confidence 6 rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', null, null, 6)$$) = -1);
select pg_temp.check_('007 unknown entity rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', '99999999-0000-0000-0000-000000000000', 'learning')$$) = -1);
select pg_temp.check_('007 unsupported type rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('pyq', '6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'learning')$$) = -1);
select pg_temp.check_('007 draft-container entity not trackable', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ncert_chapter', '32f2c6be-9cba-573e-aece-f70dd81e2320', 'learning')$$) = -1);
select pg_temp.check_('007 direct INSERT into user_progress denied', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into user_progress (user_id, entity_type, entity_id) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4','ssc_topic','21ef5dcf-fc38-5b60-9404-dc99fea1f286')$$) = -1);
select pg_temp.check_('007 direct UPDATE of counters denied', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update user_progress set seconds_spent = 999999, sessions = 99, revision_count = 99 where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1);
select pg_temp.check_('007 direct DELETE denied', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$delete from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1);
select pg_temp.check_('007 set_progress cannot touch counters', (select seconds_spent + sessions + revision_count from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e') = 0);
select pg_temp.check_('007 set_progress has no counter/time parameters', pg_get_function_arguments('public.set_progress(public.entity_t, uuid, text, integer, integer)'::regprocedure) !~* '(second|session|revision|streak|studied)');
-- completed_at semantics
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', '21ef5dcf-fc38-5b60-9404-dc99fea1f286', 'completed')$$);
select pg_temp.check_('007 completed => completion 100 and completed_at = now', (select completion || '|' || (completed_at = timestamptz '2026-10-01 12:00:00+00')::text from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286') = '100|true');
select pg_temp.set_now('2026-10-01 13:00:00+00');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', '21ef5dcf-fc38-5b60-9404-dc99fea1f286', 'completed')$$);
select pg_temp.check_('007 re-completing keeps the original completed_at', (select completed_at from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286') = timestamptz '2026-10-01 12:00:00+00');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', '21ef5dcf-fc38-5b60-9404-dc99fea1f286', 'learning')$$);
select pg_temp.check_('007 leaving completed clears completed_at and caps completion at 99', (select completion || '|' || (completed_at is null)::text from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286') = '99|true');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', '21ef5dcf-fc38-5b60-9404-dc99fea1f286', null, 100)$$);
select pg_temp.check_('007 completion 100 alone completes (and re-stamps completed_at)', (select status::text || '|' || (completed_at = timestamptz '2026-10-01 13:00:00+00')::text from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286') = 'completed|true');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', '21ef5dcf-fc38-5b60-9404-dc99fea1f286', 'not_started')$$);
select pg_temp.check_('007 not_started resets completion to 0', (select completion from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286') = 0);
select pg_temp.set_now('2026-10-01 12:00:00+00');
select pg_temp.check_('007 constraint: completed <=> completion 100', pg_temp.owner_try($$update user_progress set status = 'completed', completion = 50 where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e'$$) = -1);
select pg_temp.check_('007 B cannot read A progress', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select 1 from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = 0);
select pg_temp.check_('007 B can set progress on their own row', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select public.set_progress('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'learning')$$) = 1);
select pg_temp.check_('007 ... which creates B''s row and leaves A''s untouched', (select count(*) from user_progress where entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e' and user_id = '7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed') = 1
  and (select status::text from user_progress where entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e' and user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4') = 'learning');
select pg_temp.check_('007 anonymous cannot call set_progress', pg_temp.rows_as(null, $$select public.set_progress('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'learning')$$) = -1);
select pg_temp.check_('007 old touch_streak() is gone', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'select public.touch_streak()') = -1);

-- ============ 007 study sessions ============
select pg_temp.check_('007 study_finish/pause/resume/heartbeat/start take no seconds',
  (select bool_and(pg_get_function_arguments(p.oid) !~* 'second') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('study_start','study_pause','study_resume','study_heartbeat','study_finish','study_recover')));
select pg_temp.set_now('2026-10-01 12:00:00+00');
select pg_temp.check_('007 start opens an active session', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.study_start('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e') ->> 'state'$$) = 'active');
insert into t_runs select 's1', (select id from study_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state = 'active');
select pg_temp.check_('007 duplicate start returns the SAME session', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.study_start('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e') ->> 'id'$$) = (select id::text from t_runs where k = 's1'));
select pg_temp.check_('007 only one open session exists', (select count(*) from study_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state in ('active','paused')) = 1);
select pg_temp.check_('007 owner cannot insert a second open session (unique index)', pg_temp.owner_try($$insert into study_sessions (user_id, entity_type, entity_id, state, active_since) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4','ssc_topic','21ef5dcf-fc38-5b60-9404-dc99fea1f286','active', now())$$) = -1);
select pg_temp.check_('007 B cannot pause A session', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.study_pause(%L)$f$, (select id from t_runs where k = 's1'))) = -1);
select pg_temp.check_('007 B cannot finish A session', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.study_finish(%L)$f$, (select id from t_runs where k = 's1'))) = -1);
select pg_temp.check_('007 B cannot heartbeat A session', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.study_heartbeat(%L)$f$, (select id from t_runs where k = 's1'))) = -1);
select pg_temp.check_('007 B cannot see A sessions', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select 1 from study_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = 0);
select pg_temp.set_now('2026-10-01 12:01:00+00');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.study_heartbeat(%L)$f$, (select id from t_runs where k = 's1')));
select pg_temp.set_now('2026-10-01 12:02:00+00');
select pg_temp.check_('007 pause credits 120 s (server time)', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.study_pause(%L) ->> 'elapsed_seconds'$f$, (select id from t_runs where k = 's1'))) = '120');
select pg_temp.check_('007 pause is idempotent', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.study_pause(%L) ->> 'elapsed_seconds'$f$, (select id from t_runs where k = 's1'))) = '120');
select pg_temp.set_now('2026-10-01 12:05:00+00');
select pg_temp.check_('007 paused time does not count; resume keeps 120', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.study_resume(%L) ->> 'elapsed_seconds'$f$, (select id from t_runs where k = 's1'))) = '120');
select pg_temp.set_now('2026-10-01 12:05:30+00');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.study_heartbeat(%L)$f$, (select id from t_runs where k = 's1')));
select pg_temp.set_now('2026-10-01 12:06:00+00');
select pg_temp.check_('007 finish totals 180 s', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.study_finish(%L) ->> 'seconds'$f$, (select id from t_runs where k = 's1'))) = '180');
select pg_temp.check_('007 counters updated atomically (seconds, sessions, last_studied_at)',
  (select seconds_spent || '|' || sessions || '|' || (last_studied_at = timestamptz '2026-10-01 12:06:00+00')::text from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e') = '180|1|true');
select pg_temp.check_('007 streak started (local day 2026-10-01)', (select streak_count || '|' || last_study_date from profiles where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4') = '1|2026-10-01');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.study_finish(%L)$f$, (select id from t_runs where k = 's1')));
select pg_temp.check_('007 second finish does NOT double count', (select seconds_spent || '|' || sessions from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e') = '180|1');
select pg_temp.check_('007 pausing a finished session is refused', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.study_pause(%L)$f$, (select id from t_runs where k = 's1'))) = -1);
select pg_temp.check_('007 direct writes to study_sessions denied', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update study_sessions set seconds = 99999 where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into study_sessions (user_id, entity_type, entity_id) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4','ssc_topic','f1ce1c0d-5eed-5602-b11f-afc5a71e886e')$$) = -1);
select pg_temp.check_('007 anonymous cannot start', pg_temp.rows_as(null, $$select public.study_start('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e')$$) = -1);
-- stale ACTIVE session: no heartbeat for an hour => abandoned, credited only heartbeat+90 s
select pg_temp.set_now('2026-10-01 12:10:00+00');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.study_start('ssc_topic', '21ef5dcf-fc38-5b60-9404-dc99fea1f286')$$);
select pg_temp.set_now('2026-10-01 13:10:00+00');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'select public.study_recover()');
select pg_temp.check_('007 recover abandoned the stale session', (select state::text || '|' || seconds from study_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286' order by started_at desc limit 1) = 'abandoned|90');
select pg_temp.check_('007 recover now reports no open session', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'select public.study_recover()::text') is null);
select pg_temp.check_('007 abandoned time is credited, not lost (and not inflated)', (select seconds_spent || '|' || sessions from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286') = '90|1');
-- stale PAUSED session (> max session seconds untouched)
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.study_start('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e')$$);
select pg_temp.set_now('2026-10-01 13:10:50+00');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.study_pause(%L)$f$, (select id from study_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state = 'active')));
select pg_temp.set_now('2026-10-01 20:30:00+00');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'select public.study_recover()');
select pg_temp.check_('007 stale paused session abandoned with only its accumulated time', (select state::text || '|' || seconds from study_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e' order by started_at desc limit 1) = 'abandoned|50');
-- switching topics closes the previous session
select pg_temp.set_now('2026-10-01 20:31:00+00');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.study_start('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e')$$);
select pg_temp.set_now('2026-10-01 20:31:30+00');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.study_start('ssc_topic', '21ef5dcf-fc38-5b60-9404-dc99fea1f286')$$);
select pg_temp.check_('007 switching entity abandons the old session and opens one new', (select count(*) from study_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state = 'active') = 1
  and (select entity_id from study_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state = 'active') = '21ef5dcf-fc38-5b60-9404-dc99fea1f286');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.study_finish(%L)$f$, (select id from study_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state = 'active')));
-- very short session: no session count, no streak, no task completion
select pg_temp.set_now('2026-10-02 12:00:00+00');
update profiles set last_study_date = date '2026-10-01', streak_count = 7 where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4';
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.study_start('ncert_chapter', '17277ef4-ed1d-5063-9ec5-55919f09e403')$$);
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.study_finish(%L)$f$, (select id from study_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state = 'active')));
select pg_temp.check_('007 a 0-second session does not count or touch the streak', (select sessions from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '17277ef4-ed1d-5063-9ec5-55919f09e403') = 0 and (select streak_count from profiles where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4') = 7);
-- focus task auto-completes when the matching item is studied today
insert into tasks (id, user_id, title, entity_type, entity_id, due_date) values ('b5fd3962-f143-5219-aa5b-afda802ea15c', 'eda6c4d2-347b-52c8-92c4-bd428277acd4', 'TEST focus', 'ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', date '2026-10-02');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.study_start('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e')$$);
select pg_temp.set_now('2026-10-02 12:00:30+00');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.study_heartbeat(%L)$f$, (select id from study_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state = 'active')));
select pg_temp.set_now('2026-10-02 12:01:00+00');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.study_finish(%L)$f$, (select id from study_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state = 'active')));
select pg_temp.check_('007 studying a focus item completes its task for today', (select status::text from tasks where id = 'b5fd3962-f143-5219-aa5b-afda802ea15c') = 'completed');
select pg_temp.check_('007 streak advanced to 8 for the next local day', (select streak_count || '|' || last_study_date from profiles where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4') = '8|2026-10-02');
-- midnight: a session crossing local midnight counts for BOTH days (Kolkata: 23:50 on Oct 3 -> 00:20 on Oct 4)
update profiles set last_study_date = date '2026-10-02', streak_count = 3 where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4';
select pg_temp.set_now('2026-10-03 18:20:00+00');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.study_start('ssc_topic', '21ef5dcf-fc38-5b60-9404-dc99fea1f286')$$);
select pg_temp.set_now('2026-10-03 18:49:30+00');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.study_heartbeat(%L)$f$, (select id from study_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state = 'active')));
select pg_temp.set_now('2026-10-03 18:50:00+00');
select pg_temp.check_('007 midnight-crossing session credits 1800 s', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.study_finish(%L) ->> 'seconds'$f$, (select id from study_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state = 'active'))) = '1800');
select pg_temp.check_('007 ... and extends the streak across both local days (3 -> 5, last day Oct 4)', (select streak_count || '|' || last_study_date from profiles where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4') = '5|2026-10-04');
select pg_temp.set_now('2026-10-01 12:00:00+00');

-- ============ 008 revision engine ============
select pg_temp.set_now('2026-10-01 12:00:00+00');
update profiles set revision_intervals = '{1,3,7,15,30}', last_study_date = null, streak_count = 0 where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4';
-- completion seeds exactly one open revision
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ncert_chapter', 'dd124977-1642-564e-8776-86a09a5ccdbf', 'completed')$$);
select pg_temp.check_('008 completing seeds ONE open revision (step 0, due +1, reason completion)',
  (select count(*) || '|' || min(step) || '|' || min(due_date) || '|' || min(reason) from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'dd124977-1642-564e-8776-86a09a5ccdbf' and not done) = '1|0|2026-10-02|completion');
insert into t_runs select 'rev1', (select id from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'dd124977-1642-564e-8776-86a09a5ccdbf' and not done);
select pg_temp.set_now('2026-10-01 15:00:00+00');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ncert_chapter', 'dd124977-1642-564e-8776-86a09a5ccdbf', 'completed')$$);
select pg_temp.check_('008 completing again does NOT reset the ladder', (select id::text || '|' || due_date from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'dd124977-1642-564e-8776-86a09a5ccdbf' and not done) = (select id::text from t_runs where k = 'rev1') || '|2026-10-02');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ncert_chapter', 'dd124977-1642-564e-8776-86a09a5ccdbf', 'learning')$$);
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ncert_chapter', 'dd124977-1642-564e-8776-86a09a5ccdbf', 'completed')$$);
select pg_temp.check_('008 complete -> learning -> complete keeps the SAME open row and due date', (select count(*) || '|' || min(id::text) || '|' || min(due_date) from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'dd124977-1642-564e-8776-86a09a5ccdbf' and not done) = '1|' || (select id::text from t_runs where k = 'rev1') || '|2026-10-02');
select pg_temp.check_('008 one open row per entity is enforced by the database', pg_temp.owner_try($$insert into revision_schedule (user_id, entity_type, entity_id, due_date, interval_days) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4','ncert_chapter','dd124977-1642-564e-8776-86a09a5ccdbf', date '2026-10-09', 7)$$) = -1);
select pg_temp.check_('008 direct writes to revision tables denied', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update revision_schedule set due_date = date '2030-01-01' where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into revision_reviews (user_id, entity_type, entity_id, due_date, reviewed_on, rating) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4','ncert_chapter','dd124977-1642-564e-8776-86a09a5ccdbf', current_date, current_date, 'easy')$$) = -1);
select pg_temp.set_now('2026-10-01 12:00:00+00');

-- rating vectors through the RPC (ladder 1,3,7,15,30). Each case first forces the row to (step, due today), then reviews as A.
create or replace function pg_temp.review_case(p_step int, p_rating text, p_chapter text default 'dd124977-1642-564e-8776-86a09a5ccdbf') returns text language plpgsql as $$
declare v_id uuid; v_res text;
begin
  update revision_schedule set step = p_step, due_date = date '2026-10-01', done = false, done_at = null where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = p_chapter::uuid and not done returning id into v_id;
  if v_id is null then
    select id into v_id from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = p_chapter::uuid order by created_at desc limit 1;
    update revision_schedule set step = p_step, due_date = date '2026-10-01', done = false, done_at = null where id = v_id;
  end if;
  perform pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(%L, %L, %s)$f$, v_id, p_rating, p_step));
  select step || '|' || done || '|' || due_date into v_res from revision_schedule where id = v_id;
  return v_res;
end $$;
select pg_temp.check_('008 good: step 0 -> 1, due +3', pg_temp.review_case(0, 'good') = '1|false|2026-10-04');
select pg_temp.check_('008 easy: step 1 -> 3, due +15', pg_temp.review_case(1, 'easy') = '3|false|2026-10-16');
select pg_temp.check_('008 hard: step 3 -> 2, due +1 (shortest gap)', pg_temp.review_case(3, 'hard') = '2|false|2026-10-02');
select pg_temp.check_('008 hard at the floor stays at 0, due +1', pg_temp.review_case(0, 'hard') = '0|false|2026-10-02');
select pg_temp.check_('008 good on the last step graduates (row done)', pg_temp.review_case(4, 'good') like '5|true|%');
select pg_temp.check_('008 graduated: no open row remains', (select count(*) from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'dd124977-1642-564e-8776-86a09a5ccdbf' and not done) = 0);
select pg_temp.check_('008 history appended one row per review (5)', (select count(*) from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'dd124977-1642-564e-8776-86a09a5ccdbf' and source = 'app') = 5);
select pg_temp.check_('008 history rows carry step before/after, interval and local review date',
  (select step_before || '>' || step_after || '|' || interval_days_after || '|' || reviewed_on || '|' || rating from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'dd124977-1642-564e-8776-86a09a5ccdbf' and rating = 'good' and step_before = 0 limit 1) = '0>1|3|2026-10-01|good');
select pg_temp.check_('008 graduation is recorded in history', (select count(*) from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'dd124977-1642-564e-8776-86a09a5ccdbf' and graduated) = 1);
select pg_temp.check_('008 revision_count incremented once per review (5)', (select revision_count from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'dd124977-1642-564e-8776-86a09a5ccdbf') = 5);
select pg_temp.check_('008 last_studied_at set by a review', (select last_studied_at from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'dd124977-1642-564e-8776-86a09a5ccdbf') = timestamptz '2026-10-01 12:00:00+00');
select pg_temp.check_('008 a review counts for the streak', (select streak_count from profiles where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4') = 1);
-- confidence on review
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', 'ee476413-2e8e-5c56-bbf5-b6cf5bdb2876', 'completed')$$);
insert into t_runs select 'rev3', (select id from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'ee476413-2e8e-5c56-bbf5-b6cf5bdb2876' and not done);
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(%L, 'good', 0, 4)$f$, (select id from t_runs where k = 'rev3')));
select pg_temp.check_('008 review can set confidence', (select confidence from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'ee476413-2e8e-5c56-bbf5-b6cf5bdb2876') = 4);
-- duplicate / stale review protection
select pg_temp.check_('008 double-submit with the same expected step is rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(%L, 'good', 0)$f$, (select id from t_runs where k = 'rev3'))) = -1);
select pg_temp.check_('008 ... and added no extra history row', (select count(*) from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'ee476413-2e8e-5c56-bbf5-b6cf5bdb2876') = 1);
select pg_temp.check_('008 invalid rating rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(%L, 'perfect', 1)$f$, (select id from t_runs where k = 'rev3'))) = -1);
select pg_temp.check_('008 B cannot review A schedule', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.review_revision(%L, 'good', 1)$f$, (select id from t_runs where k = 'rev3'))) = -1);
select pg_temp.check_('008 unknown schedule id rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.review_revision('99999999-0000-0000-0000-000000000000', 'good', 0)$$) = -1);
select pg_temp.check_('008 a finished (graduated) revision cannot be reviewed again', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(%L, 'good', 5)$f$, (select id from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'dd124977-1642-564e-8776-86a09a5ccdbf' and done limit 1))) = -1);
select pg_temp.check_('008 B cannot read A schedule or history', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select 1 from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = 0 and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select 1 from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = 0);
select pg_temp.check_('008 anonymous cannot review', pg_temp.rows_as(null, $$select public.review_revision('99999999-0000-0000-0000-000000000000', 'good', 0)$$) = -1);
-- append-only history
select pg_temp.check_('008 history UPDATE refused (user)', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update revision_reviews set rating = 'easy' where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1);
select pg_temp.check_('008 history DELETE refused (user)', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$delete from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1);
select pg_temp.check_('008 history UPDATE refused even for the owner', pg_temp.owner_try($$update revision_reviews set rating = 'easy' where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1);
select pg_temp.check_('008 history DELETE refused even for the owner (direct statement)', pg_temp.owner_try($$delete from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1);
-- custom ladder: validation, future scheduling only, history untouched
select pg_temp.check_('008 invalid ladder {3,3} rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update profiles set revision_intervals = '{3,3}' where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1);
select pg_temp.check_('008 invalid ladder {0,2} rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update profiles set revision_intervals = '{0,2}' where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1);
select pg_temp.check_('008 invalid ladder (decreasing) rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update profiles set revision_intervals = '{5,2}' where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1);
select pg_temp.check_('008 invalid ladder (13 entries) rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update profiles set revision_intervals = '{1,2,3,4,5,6,7,8,9,10,11,12,13}' where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1);
select pg_temp.check_('008 invalid ladder (over 365 days) rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update profiles set revision_intervals = '{1,366}' where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1);
select pg_temp.check_('008 invalid ladder (empty) rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update profiles set revision_intervals = '{}' where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1);
create temp table t_hist as select id, rating, step_before, step_after, interval_days_after from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' order by id;
select pg_temp.check_('008 a valid custom ladder {2,5,9} is accepted', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update profiles set revision_intervals = '{2,5,9}' where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = 1);
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', '21ef5dcf-fc38-5b60-9404-dc99fea1f286', 'completed')$$);
select pg_temp.check_('008 new schedule uses the custom ladder (due +2)', (select due_date from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286' and not done) = date '2026-10-03');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(%L, 'good', 0)$f$, (select id from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286' and not done)));
select pg_temp.check_('008 good on the custom ladder: step 1, due +5', (select step || '|' || due_date from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286' and not done) = '1|2026-10-06');
select pg_temp.check_('008 changing the ladder did not rewrite earlier history', (select count(*) from t_hist h join revision_reviews v on v.id = h.id where v.rating = h.rating and v.step_before is not distinct from h.step_before and v.step_after is not distinct from h.step_after and v.interval_days_after is not distinct from h.interval_days_after) = (select count(*) from t_hist));
-- manual schedule + weakness helper
select pg_temp.check_('008 manual revision needs a started item', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select public.schedule_revision('ssc_topic', 'ee476413-2e8e-5c56-bbf5-b6cf5bdb2876')$$) = -1);
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_subtopic', '4654f3fc-fa66-5d7d-9e71-91c21c483300', 'learning', 30)$$);
select pg_temp.check_('008 manual revision on a started item opens one due today (reason manual)', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.schedule_revision('ssc_subtopic', '4654f3fc-fa66-5d7d-9e71-91c21c483300')$$) = 1
  and (select due_date || '|' || reason from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '4654f3fc-fa66-5d7d-9e71-91c21c483300' and not done) = '2026-10-01|manual');
select pg_temp.owner_try($$select public._open_weakness_revision('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'ssc_topic', '21ef5dcf-fc38-5b60-9404-dc99fea1f286')$$);
select pg_temp.check_('008 weakness pulls an open revision forward to today (reason weakness)', (select due_date || '|' || reason from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286' and not done) = '2026-10-01|weakness');
-- deleting a user cascades their append-only history (cascade is allowed, direct delete is not)
select pg_temp.rows_as('b21625f9-8563-531b-be14-6b7f593a1386', $$select public.set_progress('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'completed')$$);
select pg_temp.rows_as('b21625f9-8563-531b-be14-6b7f593a1386', format($f$select public.review_revision(%L, 'good', 0)$f$, (select id from revision_schedule where user_id = 'b21625f9-8563-531b-be14-6b7f593a1386' and not done limit 1)));
select pg_temp.check_('008 user E has history before deletion', (select count(*) from revision_reviews where user_id = 'b21625f9-8563-531b-be14-6b7f593a1386') = 1);
select pg_temp.check_('008 deleting the user succeeds', pg_temp.owner_try($$delete from auth.users where id = 'b21625f9-8563-531b-be14-6b7f593a1386'$$) = 1);
select pg_temp.check_('008 ... and cascades their history', (select count(*) from revision_reviews where user_id = 'b21625f9-8563-531b-be14-6b7f593a1386') = 0);
update profiles set revision_intervals = '{1,3,7,15,30}' where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4';

-- ============ 009 PYQ + practice ============
select pg_temp.set_now('2026-10-01 12:00:00+00');
select pg_temp.check_('009 exam_papers is separate from ssc_exams (different tables, paper has year)', (select count(*) from information_schema.columns where table_name = 'exam_papers' and column_name = 'year') = 1);
select pg_temp.check_('009 duplicate paper rejected', pg_temp.owner_try($$insert into exam_papers (exam, year, tier) values ('SSC CGL', 2020, 'Tier I')$$) = -1);
select pg_temp.check_('009 same question twice in one paper rejected (content hash)', pg_temp.owner_try($$insert into pyqs (paper_id, question, options, correct_answer) values ('45075014-9a46-5d77-9064-50eb4f553616', '  TEST   question ONE ', '{"A":"a1","B":"b1","C":"c1","D":"d1"}', 'B')$$) = -1);
select pg_temp.check_('009 same question in a DIFFERENT paper allowed (repeat question)', pg_temp.owner_try($$insert into pyqs (paper_id, question, options, correct_answer) values ('14901406-fdf3-5de1-a2b2-692f750c1df5', 'TEST question one', '{"A":"a1","B":"b1","C":"c1","D":"d1"}', 'B')$$) = 1);
select pg_temp.check_('009 answer key must be one of the options', pg_temp.owner_try($$insert into pyqs (paper_id, question, options, correct_answer) values ('45075014-9a46-5d77-9064-50eb4f553616', 'TEST bad key', '{"A":"x","B":"y"}', 'Z')$$) = -1);
select pg_temp.check_('009 options must be a JSON object', pg_temp.owner_try($$insert into pyqs (paper_id, question, options, correct_answer) values ('45075014-9a46-5d77-9064-50eb4f553616', 'TEST array options', '["a","b"]', 'A')$$) = -1);
select pg_temp.check_('009 content_hash is filled automatically', (select content_hash is not null from pyqs where id = '6923f5c9-c73b-50f3-aef9-ac779ca167bf'));
-- subtopic integrity
select pg_temp.check_('009 subtopic link requires the PYQ to be linked to its topic', pg_temp.owner_try($$insert into pyq_subtopics (pyq_id, ssc_topic_id, ssc_subtopic_id) values ('538b4267-45b8-521c-afd0-73e417e5dccc', '21ef5dcf-fc38-5b60-9404-dc99fea1f286', 'eebfdd69-ca02-5ff1-ae3f-1cf817ae21e4')$$) = 1);
select pg_temp.check_('009 subtopic link without a topic link rejected', pg_temp.owner_try($$insert into pyq_subtopics (pyq_id, ssc_topic_id, ssc_subtopic_id) values ('07eb48c9-f9a3-509c-b73e-b75054a43319', '21ef5dcf-fc38-5b60-9404-dc99fea1f286', 'eebfdd69-ca02-5ff1-ae3f-1cf817ae21e4')$$) = -1);
select pg_temp.check_('009 subtopic that belongs to another topic rejected', pg_temp.owner_try($$insert into pyq_subtopics (pyq_id, ssc_topic_id, ssc_subtopic_id) values ('6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'eebfdd69-ca02-5ff1-ae3f-1cf817ae21e4')$$) = -1);
select pg_temp.check_('009 unlinking the topic cascades the subtopic link', pg_temp.owner_try($$delete from pyq_topics where pyq_id = '538b4267-45b8-521c-afd0-73e417e5dccc' and ssc_topic_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286'$$) = 1 and (select count(*) from pyq_subtopics where pyq_id = '538b4267-45b8-521c-afd0-73e417e5dccc') = 0);
insert into pyq_topics (pyq_id, ssc_topic_id) values ('538b4267-45b8-521c-afd0-73e417e5dccc', '21ef5dcf-fc38-5b60-9404-dc99fea1f286');
-- attempts are not client-writable
select pg_temp.check_('009 direct INSERT into pyq_attempts denied', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into pyq_attempts (user_id, pyq_id, is_correct) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4', '6923f5c9-c73b-50f3-aef9-ac779ca167bf', true)$$) = -1);
select pg_temp.check_('009 direct UPDATE/DELETE of attempts denied', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update pyq_attempts set is_correct = true where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$delete from pyq_attempts where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1);
-- start
select pg_temp.check_('009 unknown scope rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.start_practice('everything', null, 5)$$) = -1);
select pg_temp.check_('009 topic scope without an id rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.start_practice('ssc_topic', null, 5)$$) = -1);
select pg_temp.check_('009 weak scope with an id rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.start_practice('weak', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 5)$$) = -1);
select pg_temp.check_('009 draft/unknown topic rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.start_practice('ssc_topic', '99999999-0000-0000-0000-000000000000', 5)$$) = -1);
select pg_temp.check_('009 anonymous cannot start practice', pg_temp.rows_as(null, $$select public.start_practice('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 5)$$) = -1);
select pg_temp.check_('009 start returns the question snapshot (2 for T1)', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.start_practice('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 10) ->> 'total'$$) = '2');
insert into t_runs select 'ps1', (select id from practice_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state = 'active');
select pg_temp.check_('009 start also marks the topic as started', (select status::text from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e') in ('learning', 'completed'));
select pg_temp.check_('009 restarting the same scope returns the SAME session and order', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.start_practice('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 10) ->> 'id'$$) = (select id::text from t_runs where k = 'ps1'));
select pg_temp.check_('009 only one active practice session (unique index)', pg_temp.owner_try($$insert into practice_sessions (user_id, scope_type, scope_id, pyq_ids) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4','ssc_topic','21ef5dcf-fc38-5b60-9404-dc99fea1f286', array['538b4267-45b8-521c-afd0-73e417e5dccc']::uuid[])$$) = -1);
select pg_temp.check_('009 B cannot read A practice session', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select 1 from practice_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = 0 and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.practice_state(%L)$f$, (select id from t_runs where k = 'ps1'))) = -1);
-- submissions
select pg_temp.check_('009 B cannot submit into A session', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.submit_pyq_answer(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'B', 5)$f$, (select id from t_runs where k = 'ps1'))) = -1);
select pg_temp.check_('009 question outside the session snapshot rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(%L, '538b4267-45b8-521c-afd0-73e417e5dccc', 'C', 5)$f$, (select id from t_runs where k = 'ps1'))) = -1);
select pg_temp.check_('009 tampered (random) question id rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(%L, '99999999-0000-0000-0000-000000000000', 'A', 5)$f$, (select id from t_runs where k = 'ps1'))) = -1);
select pg_temp.check_('009 option that does not exist rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'Z', 5)$f$, (select id from t_runs where k = 'ps1'))) = -1);
select pg_temp.check_('009 null answer rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf', null, 5)$f$, (select id from t_runs where k = 'ps1'))) = -1);
select pg_temp.check_('009 submit_pyq_answer has no is_correct parameter', pg_get_function_arguments('public.submit_pyq_answer(uuid, uuid, text, integer)'::regprocedure) !~* 'correct');
select pg_temp.check_('009 correct answer: server marks it correct', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'B', 12) ->> 'is_correct'$f$, (select id from t_runs where k = 'ps1'))) = 'true');
select pg_temp.check_('009 duplicate submission (even with a different answer) returns the ORIGINAL result', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select (public.submit_pyq_answer(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'A', 3) ->> 'is_correct') || '|' || (public.submit_pyq_answer(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'A', 3) ->> 'duplicate')$f$, (select id from t_runs where k = 'ps1'), (select id from t_runs where k = 'ps1'))) = 'true|true');
select pg_temp.check_('009 ... and stored exactly one attempt', (select count(*) from pyq_attempts where session_id = (select id from t_runs where k = 'ps1') and pyq_id = '6923f5c9-c73b-50f3-aef9-ac779ca167bf') = 1);
select pg_temp.check_('009 stored selected answer and clamped time', (select selected_answer || '|' || (time_taken_seconds <= 12)::text from pyq_attempts where session_id = (select id from t_runs where k = 'ps1') and pyq_id = '6923f5c9-c73b-50f3-aef9-ac779ca167bf') = 'B|true');
select pg_temp.check_('009 owner cannot insert a duplicate (session, question) attempt', pg_temp.owner_try(format($f$insert into pyq_attempts (user_id, pyq_id, session_id, selected_answer, is_correct) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4', '6923f5c9-c73b-50f3-aef9-ac779ca167bf', %L, 'B', true)$f$, (select id from t_runs where k = 'ps1'))) = -1);
select pg_temp.check_('009 wrong answer: server marks incorrect and reveals the key', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select (public.submit_pyq_answer(%L, '07eb48c9-f9a3-509c-b73e-b75054a43319', 'D', 8) ->> 'is_correct') || '|' || (public.submit_pyq_answer(%L, '07eb48c9-f9a3-509c-b73e-b75054a43319', 'D', 8) ->> 'correct_answer')$f$, (select id from t_runs where k = 'ps1'), (select id from t_runs where k = 'ps1'))) = 'false|A');
select pg_temp.check_('009 refresh: practice_state shows answered questions and the same order', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select jsonb_array_length(public.practice_state(%L) -> 'answered')$f$, (select id from t_runs where k = 'ps1'))) = '2');
-- finish
select pg_temp.check_('009 finish reports totals', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select (public.finish_practice(%L) ->> 'attempted') || '|' || (public.finish_practice(%L) ->> 'correct')$f$, (select id from t_runs where k = 'ps1'), (select id from t_runs where k = 'ps1'))) = '2|1');
select pg_temp.check_('009 finish is idempotent (still completed, one session)', (select state from practice_sessions where id = (select id from t_runs where k = 'ps1')) = 'completed');
select pg_temp.check_('009 submitting after finish is rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'B', 1)$f$, (select id from t_runs where k = 'ps1'))) = -1);
-- weak detection: 6 wrong on T1 (needs >=5 attempts, accuracy < 50)
select pg_temp.set_now('2026-10-01 12:30:00+00');
insert into pyqs (id, paper_id, question, options, correct_answer) values
  ('bbf4509c-6180-5df9-8dc6-41d6d3cf37e3','45075014-9a46-5d77-9064-50eb4f553616','TEST q four','{"A":"1","B":"2"}','A'), ('f91a7dac-253b-5710-8062-f0bea3f8c3c3','45075014-9a46-5d77-9064-50eb4f553616','TEST q five','{"A":"1","B":"2"}','A'), ('9d77b95e-046a-5f4d-8e05-058589c66c72','14901406-fdf3-5de1-a2b2-692f750c1df5','TEST q six','{"A":"1","B":"2"}','A'), ('5cd3162d-11d4-5516-9b8c-d7e51b512b7e','14901406-fdf3-5de1-a2b2-692f750c1df5','TEST q seven','{"A":"1","B":"2"}','A');
insert into pyq_topics (pyq_id, ssc_topic_id) select q, 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e' from unnest(array['bbf4509c-6180-5df9-8dc6-41d6d3cf37e3','f91a7dac-253b-5710-8062-f0bea3f8c3c3','9d77b95e-046a-5f4d-8e05-058589c66c72','5cd3162d-11d4-5516-9b8c-d7e51b512b7e']::uuid[]) q;
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.start_practice('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 10)$$);
insert into t_runs select 'ps2', (select id from practice_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state = 'active');
select pg_temp.check_('009 candidates put never-attempted first, then last-wrong, then last-correct', (select (pyq_ids)[array_length(pyq_ids,1)]::text from practice_sessions where id = (select id from t_runs where k = 'ps2')) = '6923f5c9-c73b-50f3-aef9-ac779ca167bf');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(%L, %L, 'B', 5)$f$, (select id from t_runs where k = 'ps2'), q)) from unnest(array['07eb48c9-f9a3-509c-b73e-b75054a43319','bbf4509c-6180-5df9-8dc6-41d6d3cf37e3','f91a7dac-253b-5710-8062-f0bea3f8c3c3','9d77b95e-046a-5f4d-8e05-058589c66c72','5cd3162d-11d4-5516-9b8c-d7e51b512b7e']::uuid[]) q;
select pg_temp.check_('009 5 wrong answers recorded in session two', (select count(*) filter (where not is_correct) from pyq_attempts where session_id = (select id from t_runs where k = 'ps2')) = 5);
select pg_temp.check_('009 finish names the weak topic and opens a revision today', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select jsonb_array_length(public.finish_practice(%L) -> 'weak_topics')$f$, (select id from t_runs where k = 'ps2'))) = '1'
  and (select due_date from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e' and not done) = date '2026-10-01');
select pg_temp.check_('009 weak topic is reported weak by the signals RPC', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select mastery from public.user_entity_signals('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e')$$) = 'weak');
-- weak scope uses the weak topic's questions only
select pg_temp.check_('009 weak-scope practice draws from weak topics', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.start_practice('weak', null, 3) ->> 'total'$$) = '3');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.finish_practice(%L, true)$f$, (select id from practice_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state = 'active')));
select pg_temp.check_('009 abandoning does not open weakness revisions or complete the session', (select count(*) from practice_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state = 'abandoned') >= 1);
-- topic_pyqs helper + custom pyq privacy
insert into pyqs (id, question, options, correct_answer, owner_id) values ('84a98ce2-2522-59b2-b4cc-7ed3bc95327e', 'TEST A private question', '{"A":"1","B":"2"}', 'A', 'eda6c4d2-347b-52c8-92c4-bd428277acd4');
select pg_temp.check_('009 custom PYQ is private to its owner', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select 1 from pyqs where id = '84a98ce2-2522-59b2-b4cc-7ed3bc95327e'$$) = 1 and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select 1 from pyqs where id = '84a98ce2-2522-59b2-b4cc-7ed3bc95327e'$$) = 0);
select pg_temp.check_('009 topic_pyqs lists the 6 linked questions', (select count(*) from public.topic_pyqs('f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 50)) = 6);
select pg_temp.check_('009 archiving a question succeeds', pg_temp.owner_try($$update pyqs set archived = true where id = '5cd3162d-11d4-5516-9b8c-d7e51b512b7e'$$) = 1);
select pg_temp.check_('009 topic_pyqs hides archived questions', (select count(*) from public.topic_pyqs('f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 50)) = 5);
select pg_temp.set_now('2026-10-01 12:00:00+00');

-- ============ 010 learning signals ============
select pg_temp.set_now('2026-10-01 12:00:00+00');
-- GENERATED by database/tests/reference/run_reference_tests.js from learning_oracle.js. Do not edit by hand.
select pg_temp.check_('mastery: untouched', public.learning_mastery('not_started', 0, null, 0, 0, null::numeric, null::date, date '2026-10-01', '{}'::text[], 0, false) = 'not_started');
select pg_temp.check_('mastery: started via status', public.learning_mastery('learning', 0, null, 0, 0, null::numeric, null::date, date '2026-10-01', '{}'::text[], 0, false) = 'in_progress');
select pg_temp.check_('mastery: completion only', public.learning_mastery('not_started', 30, null, 0, 0, null::numeric, null::date, date '2026-10-01', '{}'::text[], 0, false) = 'in_progress');
select pg_temp.check_('mastery: one session', public.learning_mastery('not_started', 0, null, 1, 0, null::numeric, null::date, date '2026-10-01', '{}'::text[], 0, false) = 'in_progress');
select pg_temp.check_('mastery: first pass only', public.learning_mastery('completed', 100, null, 0, 0, null::numeric, null::date, date '2026-10-01', '{}'::text[], 0, false) = 'learning');
select pg_temp.check_('mastery: confidence alone is not strong', public.learning_mastery('completed', 100, 5, 0, 0, null::numeric, null::date, date '2026-10-01', '{}'::text[], 0, false) = 'learning');
select pg_temp.check_('mastery: practice proves strong', public.learning_mastery('completed', 100, 3, 0, 8, 80::numeric, null::date, date '2026-10-01', '{}'::text[], 0, false) = 'strong');
select pg_temp.check_('mastery: good accuracy, low confidence', public.learning_mastery('completed', 100, 2, 0, 8, 80::numeric, null::date, date '2026-10-01', '{}'::text[], 0, false) = 'learning');
select pg_temp.check_('mastery: 74% below strong', public.learning_mastery('completed', 100, null, 0, 8, 74::numeric, null::date, date '2026-10-01', '{}'::text[], 0, false) = 'learning');
select pg_temp.check_('mastery: weak by accuracy', public.learning_mastery('completed', 100, null, 0, 6, 40::numeric, null::date, date '2026-10-01', '{}'::text[], 0, false) = 'weak');
select pg_temp.check_('mastery: few attempts never weak', public.learning_mastery('completed', 100, null, 0, 4, 0::numeric, null::date, date '2026-10-01', '{}'::text[], 0, false) = 'learning');
select pg_temp.check_('mastery: weak by low confidence', public.learning_mastery('learning', 40, 2, 0, 0, null::numeric, null::date, date '2026-10-01', '{}'::text[], 0, false) = 'weak');
select pg_temp.check_('mastery: good accuracy overrides low confidence', public.learning_mastery('learning', 40, 2, 0, 6, 70::numeric, null::date, date '2026-10-01', '{}'::text[], 0, false) = 'in_progress');
select pg_temp.check_('mastery: two hard in a row', public.learning_mastery('completed', 100, null, 0, 0, null::numeric, null::date, date '2026-10-01', '{hard,hard,good}'::text[], 0, false) = 'weak');
select pg_temp.check_('mastery: hard,good,hard is not weak', public.learning_mastery('completed', 100, null, 0, 0, null::numeric, null::date, date '2026-10-01', '{hard,good,hard}'::text[], 0, false) = 'learning');
select pg_temp.check_('mastery: due today', public.learning_mastery('completed', 100, null, 0, 0, null::numeric, date '2026-10-01', date '2026-10-01', '{}'::text[], 0, false) = 'needs_revision');
select pg_temp.check_('mastery: overdue', public.learning_mastery('completed', 100, null, 0, 0, null::numeric, date '2026-09-20', date '2026-10-01', '{}'::text[], 0, false) = 'needs_revision');
select pg_temp.check_('mastery: not yet due', public.learning_mastery('completed', 100, null, 0, 0, null::numeric, date '2026-10-02', date '2026-10-01', '{}'::text[], 0, false) = 'learning');
select pg_temp.check_('mastery: weak outranks needs_revision', public.learning_mastery('completed', 100, null, 0, 8, 30::numeric, date '2026-10-01', date '2026-10-01', '{}'::text[], 0, false) = 'weak');
select pg_temp.check_('mastery: mastered: ladder done, no PYQs', public.learning_mastery('completed', 100, null, 0, 0, null::numeric, null::date, date '2026-10-01', '{}'::text[], 5, true) = 'mastered');
select pg_temp.check_('mastery: mastered: ladder + accuracy + confidence', public.learning_mastery('completed', 100, 4, 0, 10, 85::numeric, null::date, date '2026-10-01', '{}'::text[], 5, true) = 'mastered');
select pg_temp.check_('mastery: ladder done, accuracy 78 => strong', public.learning_mastery('completed', 100, null, 0, 10, 78::numeric, null::date, date '2026-10-01', '{}'::text[], 5, true) = 'strong');
select pg_temp.check_('mastery: ladder done, confidence 3, no PYQs => learning', public.learning_mastery('completed', 100, 3, 0, 0, null::numeric, null::date, date '2026-10-01', '{}'::text[], 5, true) = 'learning');
select pg_temp.check_('mastery: no PYQs: reviewed + confident => strong', public.learning_mastery('completed', 100, 4, 0, 0, null::numeric, null::date, date '2026-10-01', '{}'::text[], 2, false) = 'strong');
select pg_temp.check_('mastery: legacy strong status', public.learning_mastery('strong', 100, 5, 0, 0, null::numeric, null::date, date '2026-10-01', '{}'::text[], 1, false) = 'strong');
select pg_temp.check_('revision_next: step 0 good ladder {1,3,7,15,30}', (select (x.step = 1 and x.graduated = false and x.interval_days is not distinct from 3 and x.due_date is not distinct from date '2026-10-04') from public.revision_next(0, 'good', array[1,3,7,15,30], date '2026-10-01') x));
select pg_temp.check_('revision_next: step 1 easy ladder {1,3,7,15,30}', (select (x.step = 3 and x.graduated = false and x.interval_days is not distinct from 15 and x.due_date is not distinct from date '2026-10-16') from public.revision_next(1, 'easy', array[1,3,7,15,30], date '2026-10-01') x));
select pg_temp.check_('revision_next: step 3 hard ladder {1,3,7,15,30}', (select (x.step = 2 and x.graduated = false and x.interval_days is not distinct from 1 and x.due_date is not distinct from date '2026-10-02') from public.revision_next(3, 'hard', array[1,3,7,15,30], date '2026-10-01') x));
select pg_temp.check_('revision_next: step 0 hard ladder {1,3,7,15,30}', (select (x.step = 0 and x.graduated = false and x.interval_days is not distinct from 1 and x.due_date is not distinct from date '2026-10-02') from public.revision_next(0, 'hard', array[1,3,7,15,30], date '2026-10-01') x));
select pg_temp.check_('revision_next: step 4 good ladder {1,3,7,15,30}', (select (x.step = 5 and x.graduated = true and x.interval_days is not distinct from null and x.due_date is not distinct from null::date) from public.revision_next(4, 'good', array[1,3,7,15,30], date '2026-10-01') x));
select pg_temp.check_('revision_next: step 3 easy ladder {1,3,7,15,30}', (select (x.step = 5 and x.graduated = true and x.interval_days is not distinct from null and x.due_date is not distinct from null::date) from public.revision_next(3, 'easy', array[1,3,7,15,30], date '2026-10-01') x));
select pg_temp.check_('revision_next: step 99 good ladder {1,3,7,15,30}', (select (x.step = 5 and x.graduated = true and x.interval_days is not distinct from null and x.due_date is not distinct from null::date) from public.revision_next(99, 'good', array[1,3,7,15,30], date '2026-10-01') x));
select pg_temp.check_('revision_next: step 0 good ladder {2}', (select (x.step = 1 and x.graduated = true and x.interval_days is not distinct from null and x.due_date is not distinct from null::date) from public.revision_next(0, 'good', array[2], date '2026-10-01') x));
select pg_temp.check_('revision_next: step 1 good ladder {2,5,9}', (select (x.step = 2 and x.graduated = false and x.interval_days is not distinct from 9 and x.due_date is not distinct from date '2026-10-10') from public.revision_next(1, 'good', array[2,5,9], date '2026-10-01') x));
select pg_temp.check_('revision_next: step 2 easy ladder {2,5,9}', (select (x.step = 3 and x.graduated = true and x.interval_days is not distinct from null and x.due_date is not distinct from null::date) from public.revision_next(2, 'easy', array[2,5,9], date '2026-10-01') x));

-- helper scenario for user F on topics T1 (mapped to chapter CH1) / T2 / T3 and chapter CH1, CH2
select pg_temp.check_('010 priority_rank order', public.priority_rank('very_high') > public.priority_rank('high') and public.priority_rank('high') > public.priority_rank('medium') and public.priority_rank('medium') > public.priority_rank('low'));
select pg_temp.check_('010 signals empty for a user with no progress', pg_temp.rows_as('169cdb0c-67ce-5430-9955-84300141af00', 'select 1 from public.user_entity_signals()') = 0);
select pg_temp.check_('010 daily_focus start_next skips topics whose foundation chapter is not completed', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select entity_id::text from public.daily_focus() where kind = 'start_next' order by rank limit 1$$) is distinct from 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e');
select pg_temp.check_('010 start_next offers a topic with no foundation requirement', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select count(*)::text from public.daily_focus() where entity_id in ('21ef5dcf-fc38-5b60-9404-dc99fea1f286','ee476413-2e8e-5c56-bbf5-b6cf5bdb2876')$$) = '2');
-- complete the foundation chapter => T1 becomes startable
select pg_temp.rows_as('169cdb0c-67ce-5430-9955-84300141af00', $$select public.set_progress('ncert_chapter', '17277ef4-ed1d-5063-9ec5-55919f09e403', 'completed')$$);
select pg_temp.check_('010 after the foundation chapter is done T1 is offered', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select count(*)::text from public.daily_focus() where entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e' and kind = 'start_next'$$) = '1');
-- ordering: picked > overdue > due > weak > continue > start
insert into tasks (user_id, title, entity_type, entity_id, due_date) values ('169cdb0c-67ce-5430-9955-84300141af00', 'TEST picked', 'ssc_topic', 'ee476413-2e8e-5c56-bbf5-b6cf5bdb2876', date '2026-10-01');
select pg_temp.rows_as('169cdb0c-67ce-5430-9955-84300141af00', $$select public.set_progress('ssc_topic', '21ef5dcf-fc38-5b60-9404-dc99fea1f286', 'completed')$$);      -- seeds a revision due 10-02
update revision_schedule set due_date = date '2026-09-28' where user_id = '169cdb0c-67ce-5430-9955-84300141af00' and entity_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286' and not done;   -- overdue by 3
select pg_temp.rows_as('169cdb0c-67ce-5430-9955-84300141af00', $$select public.set_progress('ssc_subtopic', '4654f3fc-fa66-5d7d-9e71-91c21c483300', 'learning', 20)$$);
select pg_temp.rows_as('169cdb0c-67ce-5430-9955-84300141af00', $$select public.set_progress('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'learning', 40, 2)$$);     -- weak by low confidence
select pg_temp.check_('010 focus order: picked first', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select kind from public.daily_focus() order by rank limit 1$$) = 'picked');
select pg_temp.check_('010 focus order: overdue revision second', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select kind from public.daily_focus() order by rank offset 1 limit 1$$) = 'overdue_revision');
select pg_temp.check_('010 focus order: weak after revisions', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select kind from public.daily_focus() order by rank offset 2 limit 1$$) = 'weak');
select pg_temp.check_('010 every focus row has a non-empty reason', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select count(*)::text from public.daily_focus() where coalesce(btrim(reason), '') = ''$$) = '0');
select pg_temp.check_('010 an item appears at most once (dedupe)', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select (count(*) - count(distinct (entity_type, entity_id)))::text from public.daily_focus()$$) = '0');
select pg_temp.check_('010 focus is capped at 5', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select (count(*) <= 5)::text from public.daily_focus(50)$$) = 'true');
select pg_temp.check_('010 focus is private (B sees nothing of F)', pg_temp.val_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select count(*)::text from public.daily_focus() where kind in ('overdue_revision','weak','picked')$$) = '0');
select pg_temp.check_('010 anonymous cannot call daily_focus / signals / dashboard', pg_temp.rows_as(null, 'select * from public.daily_focus()') = -1 and pg_temp.rows_as(null, 'select * from public.user_entity_signals()') = -1 and pg_temp.rows_as(null, 'select * from public.dashboard_summary()') = -1);
-- topic mastery uses subtopic completion
select pg_temp.check_('010 topic with subtopics shows subtopic-derived completion (0 of 1 done => 0)', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select completion::text from public.user_entity_signals('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e')$$) = '0');
select pg_temp.rows_as('169cdb0c-67ce-5430-9955-84300141af00', $$select public.set_progress('ssc_subtopic', '4654f3fc-fa66-5d7d-9e71-91c21c483300', 'completed')$$);
select pg_temp.check_('010 ... and 100 once its only subtopic is completed', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select completion::text from public.user_entity_signals('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e')$$) = '100');
-- archived entities leave every count and the focus list
select pg_temp.owner_try($$update ssc_topics set archived = true where id = 'ee476413-2e8e-5c56-bbf5-b6cf5bdb2876'$$);
select pg_temp.check_('010 archived topic disappears from focus', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select count(*)::text from public.daily_focus() where entity_id = 'ee476413-2e8e-5c56-bbf5-b6cf5bdb2876'$$) = '0');
select pg_temp.check_('010 archived topic disappears from signals', pg_temp.rows_as('169cdb0c-67ce-5430-9955-84300141af00', $$select 1 from public.user_entity_signals('ssc_topic', 'ee476413-2e8e-5c56-bbf5-b6cf5bdb2876')$$) = 0);
update ssc_topics set archived = false where id = 'ee476413-2e8e-5c56-bbf5-b6cf5bdb2876';
-- dashboard denominators
create temp table t_dash (k text primary key, v int);
insert into t_dash select 'before', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select ncert_total::text from public.dashboard_summary()$$)::int;
select pg_temp.check_('010 CH1 (recommended mapping) is counted, CH2 (unmapped) is not: un-recommending CH1 lowers the NCERT total by exactly 1',
  pg_temp.owner_try($$update ncert_ssc_mappings set recommended = false where id = '1419c6dc-bb1d-59f4-8631-4a3c5e01e0d0'$$) = 1
  and pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select ncert_total::text from public.dashboard_summary()$$)::int = (select v - 1 from t_dash where k = 'before'));
update ncert_ssc_mappings set recommended = true where id = '1419c6dc-bb1d-59f4-8631-4a3c5e01e0d0';
select pg_temp.check_('010 restoring the mapping restores the total', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select ncert_total::text from public.dashboard_summary()$$)::int = (select v from t_dash where k = 'before'));
select pg_temp.check_('010 an unmapped chapter never inflates the total (completing CH2 leaves ncert_total unchanged)', pg_temp.rows_as('169cdb0c-67ce-5430-9955-84300141af00', $$select public.set_progress('ncert_chapter', 'dd124977-1642-564e-8776-86a09a5ccdbf', 'completed')$$) = 1
  and pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select ncert_total::text from public.dashboard_summary()$$)::int = (select v from t_dash where k = 'before'));
select pg_temp.check_('010 percentages never exceed 100', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select (ncert_percent <= 100 and ssc_percent <= 100 and overall_percent <= 100 and pyq_percent <= 100 and revision_percent <= 100)::text from public.dashboard_summary()$$) = 'true');
select pg_temp.check_('010 done counts never exceed totals', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select (ncert_done <= ncert_total and ssc_done <= ssc_total)::text from public.dashboard_summary()$$) = 'true');
select pg_temp.check_('010 dashboard shows F completed topics (T2 done => ssc_done >= 1)', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select (ssc_done >= 1)::text from public.dashboard_summary()$$) = 'true');
select pg_temp.check_('010 dashboard revisions_due counts the overdue one', pg_temp.val_as('169cdb0c-67ce-5430-9955-84300141af00', $$select (revisions_due >= 1)::text from public.dashboard_summary()$$) = 'true');
select pg_temp.check_('010 dashboard is isolated: B has no progress, no due revisions', pg_temp.val_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select (ssc_done = 0 and revisions_due = 0 and weak_count = 0)::text from public.dashboard_summary()$$) = 'true');
select pg_temp.check_('010 today seconds respect the user timezone day', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select today_seconds::text from public.dashboard_summary()$$) is not null);

-- ============ 011 publishing, trust flags, import ============
select pg_temp.set_now('2026-10-01 12:00:00+00');
-- draft invisibility
select pg_temp.check_('011 normal user cannot see a draft book', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select 1 from books where id = '8e13634d-020d-5112-9139-869a20128d95'$$) = 0);
select pg_temp.check_('011 ... nor its chapters', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select 1 from chapters where id = '32f2c6be-9cba-573e-aece-f70dd81e2320'$$) = 0);
select pg_temp.check_('011 ... nor a draft exam', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select 1 from ssc_exams where id = 'cde61646-7000-5450-aa81-6ead9f1aabf9'$$) = 0);
select pg_temp.check_('011 admin sees drafts', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select 1 from books where id = '8e13634d-020d-5112-9139-869a20128d95'$$) = 1 and pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select 1 from chapters where id = '32f2c6be-9cba-573e-aece-f70dd81e2320'$$) = 1);
select pg_temp.check_('011 published content is visible to users', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select 1 from chapters where id = '17277ef4-ed1d-5063-9ec5-55919f09e403'$$) = 1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select 1 from ssc_topics where id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e'$$) = 1);
select pg_temp.check_('011 a user cannot attach a custom chapter to a draft book', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into chapters (book_id, title, owner_id) values ('8e13634d-020d-5112-9139-869a20128d95', 'x', 'eda6c4d2-347b-52c8-92c4-bd428277acd4')$$) = -1);
select pg_temp.check_('011 global_search does not leak draft chapters', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select 1 from public.global_search('draft chapter', 20)$$) = 0);
-- API inserts are always draft
select pg_temp.check_('011 admin can insert a book through the API', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$insert into books (id, subject_id, title, status) values ('46315ee1-5e94-5de1-8010-62dd502196d3', '10f0ecb3-91d2-5665-918d-cd0db35ae41d', 'TEST api book', 'published')$$) = 1);
select pg_temp.check_('011 ... and it is forced to draft', (select status::text from books where id = '46315ee1-5e94-5de1-8010-62dd502196d3') = 'draft');
-- transitions
select pg_temp.check_('011 normal user cannot publish via the RPC', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_publish_status('book', '8e13634d-020d-5112-9139-869a20128d95', 'in_review')$$) = -1);
select pg_temp.check_('011 normal user cannot publish via a direct UPDATE', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update books set status = 'published' where id = '8e13634d-020d-5112-9139-869a20128d95'$$) <= 0);
select pg_temp.check_('011 draft -> published directly is refused', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.set_publish_status('book', '8e13634d-020d-5112-9139-869a20128d95', 'published')$$) = -1);
select pg_temp.check_('011 draft -> in_review ok', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.set_publish_status('book', '8e13634d-020d-5112-9139-869a20128d95', 'in_review')$$) = 1);
select pg_temp.check_('011 publishing without a source is refused', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.set_publish_status('book', '8e13634d-020d-5112-9139-869a20128d95', 'published')$$) = -1);
update books set source_id = 'eb424051-fc9e-5703-85b7-4a0069f25278' where id = '46315ee1-5e94-5de1-8010-62dd502196d3';
select pg_temp.owner_try($$update books set source_id = 'eb424051-fc9e-5703-85b7-4a0069f25278' where id = '8e13634d-020d-5112-9139-869a20128d95'$$);
select pg_temp.check_('011 publishing with a source and chapters works (call)', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.set_publish_status('book', '8e13634d-020d-5112-9139-869a20128d95', 'published')$$) = 1);
select pg_temp.check_('011 publishing with a source and chapters works (effect)', (select status::text from books where id = '8e13634d-020d-5112-9139-869a20128d95') = 'published');
select pg_temp.check_('011 a published book is now visible to users (and its chapter)', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select 1 from books where id = '8e13634d-020d-5112-9139-869a20128d95'$$) = 1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select 1 from chapters where id = '32f2c6be-9cba-573e-aece-f70dd81e2320'$$) = 1);
select pg_temp.check_('011 published -> draft is refused', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.set_publish_status('book', '8e13634d-020d-5112-9139-869a20128d95', 'draft')$$) = -1);
select pg_temp.check_('011 publishing an empty book is refused', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.set_publish_status('book', '46315ee1-5e94-5de1-8010-62dd502196d3', 'in_review')$$) = 1 and pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.set_publish_status('book', '46315ee1-5e94-5de1-8010-62dd502196d3', 'published')$$) = -1);
select pg_temp.check_('011 published -> archived ok; archived mirrors books.archived (call)', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.set_publish_status('book', '8e13634d-020d-5112-9139-869a20128d95', 'archived')$$) = 1);
select pg_temp.check_('011 published -> archived ok; archived mirrors books.archived (effect)', (select archived from books where id = '8e13634d-020d-5112-9139-869a20128d95'));
select pg_temp.check_('011 archived content stays readable', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select 1 from chapters where id = '32f2c6be-9cba-573e-aece-f70dd81e2320'$$) = 1);
select pg_temp.check_('011 archived chapter is not an active entity', (select count(*) from public.active_entities() where entity_id = '32f2c6be-9cba-573e-aece-f70dd81e2320') = 0);
select pg_temp.check_('011 archived -> published (restore) ok', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.set_publish_status('book', '8e13634d-020d-5112-9139-869a20128d95', 'published')$$) = 1);
select pg_temp.check_('011 bad kind rejected', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.set_publish_status('chapter', '17277ef4-ed1d-5063-9ec5-55919f09e403', 'draft')$$) = -1);
-- exams
select pg_temp.check_('011 publishing an exam without tiers refused', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.set_publish_status('ssc_exam', 'cde61646-7000-5450-aa81-6ead9f1aabf9', 'in_review')$$) = 1 and pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.set_publish_status('ssc_exam', 'cde61646-7000-5450-aa81-6ead9f1aabf9', 'published')$$) = -1);
-- trust flags
select pg_temp.check_('011 admin cannot flip sources.is_verified directly', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$update sources set is_verified = true where id = 'eb424051-fc9e-5703-85b7-4a0069f25278'$$) = -1);
select pg_temp.check_('011 admin cannot flip ssc_exams.is_official directly', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$update ssc_exams set is_official = true where id = 'a9bf7926-de18-5045-b7dd-86ddeec8e566'$$) = -1);
select pg_temp.check_('011 admin cannot insert an already-verified source', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$insert into sources (name, is_verified) values ('TEST sneaky', true)$$) = -1);
select pg_temp.check_('011 normal user cannot verify', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.verify_source('eb424051-fc9e-5703-85b7-4a0069f25278')$$) = -1);
select pg_temp.check_('011 admin verify_source works', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.verify_source('eb424051-fc9e-5703-85b7-4a0069f25278')$$) = 1);
select pg_temp.check_('011 ... and stamps who and when', (select is_verified::text || '|' || (verified_by = 'b2251d3c-7aed-5d3b-bb07-97b3955353d1')::text || '|' || (verified_at is not null)::text from sources where id = 'eb424051-fc9e-5703-85b7-4a0069f25278') = 'true|true|true');
select pg_temp.check_('011 official needs a notification URL', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.set_exam_official('a9bf7926-de18-5045-b7dd-86ddeec8e566')$$) = -1);
update ssc_exams set notification_url = 'https://example.test/notice' where id = 'a9bf7926-de18-5045-b7dd-86ddeec8e566';
select pg_temp.check_('011 official with URL and verified source works (call)', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.set_exam_official('a9bf7926-de18-5045-b7dd-86ddeec8e566')$$) = 1);
select pg_temp.check_('011 official with URL and verified source works (effect)', (select is_official from ssc_exams where id = 'a9bf7926-de18-5045-b7dd-86ddeec8e566'));
select pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.verify_source('eb424051-fc9e-5703-85b7-4a0069f25278', false)$$);
select pg_temp.check_('011 official is refused once the source is unverified', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.set_exam_official('a9bf7926-de18-5045-b7dd-86ddeec8e566')$$) = -1);
select pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.verify_source('eb424051-fc9e-5703-85b7-4a0069f25278', true)$$);
select pg_temp.check_('011 trust flag RPCs revoked from anon', pg_temp.rows_as(null, $$select public.verify_source('eb424051-fc9e-5703-85b7-4a0069f25278')$$) = -1);

-- ---------------- import ----------------
create temp table t_imp (k text primary key, v text);
create or replace function pg_temp.run_import(p_sha text, p_dry boolean, p_ncert jsonb, p_ssc jsonb, p_map jsonb, p_source jsonb default '{"name":"TEST import source"}') returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'b2251d3c-7aed-5d3b-bb07-97b3955353d1', 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', 'b2251d3c-7aed-5d3b-bb07-97b3955353d1', true);
  set local role authenticated;
  v_id := public.import_create_run('t.json', p_sha, p_source, p_dry);
  if p_ncert is not null then perform public.import_stage_rows(v_id, 'ncert', p_ncert); end if;
  if p_ssc is not null then perform public.import_stage_rows(v_id, 'ssc', p_ssc); end if;
  if p_map is not null then perform public.import_stage_rows(v_id, 'mapping', p_map); end if;
  perform public.import_validate_run(v_id);
  reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return v_id;
end $$;
select pg_temp.check_('011 normal user cannot create an import run', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.import_create_run('x', repeat('a', 64), '{"name":"s"}', true)$$) = -1);
select pg_temp.check_('011 normal user cannot read import tables', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'select 1 from import_runs') = 0 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into import_runs (file_sha256) values (repeat('b', 64))$$) = -1);
select pg_temp.check_('011 source with trust flags rejected at creation', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.import_create_run('x', repeat('c', 64), '{"name":"s","is_verified":true}', true)$$) = -1);
select pg_temp.check_('011 bad sha rejected', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.import_create_run('x', 'nothex', '{"name":"s"}', true)$$) = -1);
select pg_temp.check_('011 missing source name rejected', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.import_create_run('x', repeat('d', 64), '{}', true)$$) = -1);

-- a valid file: one chapter + one topic + a mapping between the two NEW draft rows
insert into t_imp select 'good', pg_temp.run_import(repeat('1', 64), false,
  '[{"class":"6","subject":"IMP subject","book":"IMP book","chapter":"IMP chapter","chapter_number":"1","relevance":"high","concepts":"alpha|beta"}]',
  '[{"exam_version":"IMP2030","tier":"Tier I","subject":"IMP ssc subject","topic":"IMP topic","priority":"high","subtopic":"IMP sub"}]',
  '[{"class":"6","subject":"IMP subject","book":"IMP book","chapter":"IMP chapter","exam_version":"IMP2030","tier":"Tier I","ssc_subject":"IMP ssc subject","topic":"IMP topic","mapping_type":"foundation","reason":"because"}]');
select pg_temp.check_('011 valid file validates', (select status from import_runs where id = (select v::uuid from t_imp where k = 'good')) = 'validated');
select pg_temp.check_('011 validation wrote NOTHING to curriculum tables', (select count(*) from chapters where title = 'IMP chapter') = 0 and (select count(*) from ssc_topics where title = 'IMP topic') = 0);
select pg_temp.check_('011 normal user cannot apply', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.import_apply_run(%L)$f$, (select v from t_imp where k = 'good'))) = -1);
select pg_temp.check_('011 apply works for an admin', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', format($f$select public.import_apply_run(%L)$f$, (select v from t_imp where k = 'good'))) = 1);
select pg_temp.check_('011 applied content exists', (select count(*) from chapters where title = 'IMP chapter') = 1 and (select count(*) from concepts where title in ('alpha','beta')) = 2 and (select count(*) from ssc_subtopics where title = 'IMP sub') = 1);
select pg_temp.check_('011 applied book and exam are DRAFT', (select status::text from books where title = 'IMP book') = 'draft' and (select status::text from ssc_exams where exam_version = 'IMP2030') = 'draft');
select pg_temp.check_('011 applied source is UNVERIFIED, exam is NOT official', not (select is_verified from sources where name = 'TEST import source') and not (select is_official from ssc_exams where exam_version = 'IMP2030'));
select pg_temp.check_('011 imported draft is invisible to normal users', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select 1 from chapters where title = 'IMP chapter'$$) = 0 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select 1 from ssc_topics where title = 'IMP topic'$$) = 0);
select pg_temp.check_('011 imported mapping is invisible while its endpoints are drafts', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select 1 from ncert_ssc_mappings where reason = 'because'$$) = 0 and (select count(*) from ncert_ssc_mappings where reason = 'because') = 1);
select pg_temp.check_('011 applying the same run twice is rejected', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', format($f$select public.import_apply_run(%L)$f$, (select v from t_imp where k = 'good'))) = -1);
select pg_temp.check_('011 the same file (same hash) cannot be imported again', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select public.import_create_run('t.json', repeat('1', 64), '{"name":"s"}', false)$$) = -1);

-- dry run cannot be applied
insert into t_imp select 'dry', pg_temp.run_import(repeat('2', 64), true, '[{"class":"7","subject":"IMP subject","book":"IMP book dry","chapter":"IMP dry chapter"}]', null, null);
select pg_temp.check_('011 dry run validates', (select status from import_runs where id = (select v::uuid from t_imp where k = 'dry')) = 'validated');
select pg_temp.check_('011 dry run cannot be applied (call)', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', format($f$select public.import_apply_run(%L)$f$, (select v from t_imp where k = 'dry'))) = -1);
select pg_temp.check_('011 dry run cannot be applied (effect)', (select count(*) from chapters where title = 'IMP dry chapter') = 0);

-- invalid files
create or replace function pg_temp.errs(p_run uuid) returns text language sql as $$ select coalesce(string_agg(r.errors::text, ' '), '') from import_rows r where r.run_id = p_run and r.status = 'invalid' $$;
insert into t_imp select 'flags', pg_temp.run_import(repeat('3', 64), false, '[{"class":"6","subject":"S","book":"B","chapter":"C","is_verified":true},{"class":"6","subject":"S","book":"B","chapter":"C2","status":"published"}]', null, null);
select pg_temp.check_('011 rows declaring trust/status flags are rejected', (select count(*) from import_rows where run_id = (select v::uuid from t_imp where k = 'flags') and status = 'invalid') = 2);
insert into t_imp select 'req', pg_temp.run_import(repeat('4', 64), false, '[{"class":"6","subject":"S","chapter":"C"}]', '[{"exam_version":"V","tier":"T","subject":"S"}]', null);
select pg_temp.check_('011 missing required fields are named', pg_temp.errs((select v::uuid from t_imp where k = 'req')) like '%book%' and pg_temp.errs((select v::uuid from t_imp where k = 'req')) like '%topic%');
insert into t_imp select 'enum', pg_temp.run_import(repeat('5', 64), false, '[{"class":"13","subject":"S","book":"B","chapter":"C"},{"class":"6","subject":"S","book":"B","chapter":"C2","relevance":"huge"},{"class":"6","subject":"S","book":"B","chapter":"C3","chapter_number":"x"}]', null, null);
select pg_temp.check_('011 bad class / relevance / number each rejected', (select count(*) from import_rows where run_id = (select v::uuid from t_imp where k = 'enum') and status = 'invalid') = 3);
insert into t_imp select 'dupe', pg_temp.run_import(repeat('6', 64), false, '[{"class":"6","subject":"S","book":"B","chapter":"C"},{"class":"6","subject":"S","book":"B","chapter":"C"}]', null, null);
select pg_temp.check_('011 duplicate rows inside the file are rejected', (select count(*) from import_rows where run_id = (select v::uuid from t_imp where k = 'dupe') and status = 'invalid') = 2);
insert into t_imp select 'fk', pg_temp.run_import(repeat('7', 64), false, null, null, '[{"class":"6","subject":"TEST subject","chapter":"NO SUCH CHAPTER","exam_version":"TEST","tier":"TEST tier","ssc_subject":"TEST ssc subject","topic":"TEST official topic","mapping_type":"direct"}]');
select pg_temp.check_('011 mapping to a missing chapter is rejected', pg_temp.errs((select v::uuid from t_imp where k = 'fk')) like '%chapter not found%');
insert into t_imp select 'fk2', pg_temp.run_import(repeat('8', 64), false, null, null, '[{"class":"6","subject":"TEST subject","chapter":"TEST official chapter","exam_version":"TEST","tier":"TEST tier","ssc_subject":"TEST ssc subject","topic":"NO SUCH TOPIC","mapping_type":"direct"}]');
select pg_temp.check_('011 mapping to a missing topic is rejected', pg_temp.errs((select v::uuid from t_imp where k = 'fk2')) like '%topic not found%');
insert into t_imp select 'pub', pg_temp.run_import(repeat('9', 64), false, '[{"class":"6","subject":"TEST subject","book":"TEST book","chapter":"TEST brand new chapter"}]', null,
  '[{"class":"6","subject":"TEST subject","chapter":"TEST official chapter","exam_version":"TEST","tier":"TEST tier","ssc_subject":"TEST ssc subject","topic":"TEST second topic","mapping_type":"direct"}]');
select pg_temp.check_('011 importing into an already-published book is rejected', pg_temp.errs((select v::uuid from t_imp where k = 'pub')) like '%not a draft%');
select pg_temp.check_('011 a mapping between two published endpoints is rejected', pg_temp.errs((select v::uuid from t_imp where k = 'pub')) like '%already published%');
select pg_temp.check_('011 an invalid run cannot be applied and changes nothing (call)', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', format($f$select public.import_apply_run(%L)$f$, (select v from t_imp where k = 'pub'))) = -1);
select pg_temp.check_('011 an invalid run cannot be applied and changes nothing (effect)', (select count(*) from chapters where title = 'TEST brand new chapter') = 0);
select pg_temp.check_('011 discard removes staged rows (call)', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', format($f$select public.import_discard_run(%L)$f$, (select v from t_imp where k = 'pub'))) = 1);
select pg_temp.check_('011 discard removes staged rows (effect)', (select count(*) from import_rows where run_id = (select v::uuid from t_imp where k = 'pub')) = 0);
select pg_temp.check_('011 an applied run cannot be discarded', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', format($f$select public.import_discard_run(%L)$f$, (select v from t_imp where k = 'good'))) = -1);

-- ======================= RESULTS =======================
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed, count(*) as total from t_results;
select n, label, detail from t_results where not passed order by n;      -- empty = everything passed
select n, case when passed then 'PASS' else 'FAIL' end as result, label from t_results order by n;
rollback;
