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

-- ============ 013 revision queue + Phase 7 revision behaviour ============
-- SQL NOT EXECUTED when written (no Postgres available). Runs inside the phase4 harness transaction (users A, B normal; C admin; fixtures CH2, T1-T3, ST1).
-- Ladder for A = 1,3,7,15,30 (indexes 0..4). B gets a custom ladder 2,5,20.
select pg_temp.set_now('2026-10-01 12:00:00+00');
update profiles set revision_intervals = '{1,3,7,15,30}' where id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4';
update profiles set revision_intervals = '{2,5,20}' where id = '7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed';

-- A: four items with progress; revisions scheduled through the CLIENT rpc, due dates then placed by the owner
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ncert_chapter', 'dd124977-1642-564e-8776-86a09a5ccdbf', 'learning', 50, 4)$$);
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'learning', 60, 4)$$);
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_topic', '21ef5dcf-fc38-5b60-9404-dc99fea1f286', 'completed', 100, 1)$$);     -- confidence 1 -> weak; completion seeds its own revision
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_progress('ssc_subtopic', '4654f3fc-fa66-5d7d-9e71-91c21c483300', 'learning', 20, 3)$$);
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.schedule_revision('ncert_chapter', 'dd124977-1642-564e-8776-86a09a5ccdbf')$$);
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.schedule_revision('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e')$$);
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.schedule_revision('ssc_subtopic', '4654f3fc-fa66-5d7d-9e71-91c21c483300')$$);
update revision_schedule set due_date = '2026-09-28', step = 1 where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'dd124977-1642-564e-8776-86a09a5ccdbf' and not done;   -- overdue by 3
update revision_schedule set due_date = '2026-10-01', step = 2 where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e' and not done;     -- due today
update revision_schedule set due_date = '2026-10-01', step = 0 where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286' and not done;     -- due today (weak)
update revision_schedule set due_date = '2026-10-05', step = 3 where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '4654f3fc-fa66-5d7d-9e71-91c21c483300' and not done;    -- upcoming

-- ---------------- one open row ----------------
select pg_temp.check_('013 exactly one open revision per item (A, 4 items)', (select count(*) = 4 and count(distinct entity_id) = 4 from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and not done));
select pg_temp.check_('013 a second open row for the same item is rejected by the database', pg_temp.owner_try($$insert into revision_schedule (user_id, entity_type, entity_id, due_date, interval_days, step) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', date '2026-10-09', 1, 0)$$) = -1);
select pg_temp.check_('013 schedule_revision twice does not create a second open row', (select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.schedule_revision('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e')$$)) >= 0 and (select count(*) = 1 from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e' and not done));
select pg_temp.check_('013 cannot schedule an item you never started', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select public.schedule_revision('ssc_topic', '21ef5dcf-fc38-5b60-9404-dc99fea1f286')$$) = -1);

-- ---------------- revision_queue: buckets, order, signals ----------------
select pg_temp.check_('013 queue has A''s four open revisions', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select * from public.revision_queue()$$) = 4);
select pg_temp.check_('013 buckets are overdue, today, today, upcoming in rank order', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select string_agg(bucket, ',' order by rank) from public.revision_queue()$$) = 'overdue,today,today,upcoming');
select pg_temp.check_('013 rank 1 is the overdue item (CH2, 3 days)', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select entity_id || '|' || days_overdue from public.revision_queue() where rank = 1$$) = 'dd124977-1642-564e-8776-86a09a5ccdbf|3');
select pg_temp.check_('013 among same-day items the WEAK one comes first (T2 before T1)', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select entity_id from public.revision_queue() where rank = 2$$) = '21ef5dcf-fc38-5b60-9404-dc99fea1f286');
select pg_temp.check_('013 ranks are 1..n without gaps or duplicates', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select (count(distinct rank) = count(*) and min(rank) = 1 and max(rank) = count(*))::text from public.revision_queue()$$) = 'true');
select pg_temp.check_('013 days_until for the upcoming item is 4', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select days_until::text from public.revision_queue() where bucket = 'upcoming'$$) = '4');
select pg_temp.check_('013 each row carries mastery, confidence and the user''s ladder', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select mastery || '|' || confidence || '|' || ladder::text from public.revision_queue() where entity_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286'$$) = 'weak|1|{1,3,7,15,30}');
-- oldest due beats weak: make T1 older than T2 -> T1 first
update revision_schedule set due_date = '2026-09-29' where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e' and not done;
update revision_schedule set due_date = '2026-09-30' where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286' and not done;
select pg_temp.check_('013 oldest due beats weak (among overdue: CH2, then T1, then T2)', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select string_agg(entity_id::text, ',' order by rank) from public.revision_queue() where bucket = 'overdue'$$) = 'dd124977-1642-564e-8776-86a09a5ccdbf,f1ce1c0d-5eed-5602-b11f-afc5a71e886e,21ef5dcf-fc38-5b60-9404-dc99fea1f286');
update revision_schedule set due_date = '2026-10-01' where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id in ('f1ce1c0d-5eed-5602-b11f-afc5a71e886e', '21ef5dcf-fc38-5b60-9404-dc99fea1f286') and not done;
-- single source of truth: the first due item equals the first revision item of daily_focus()
select pg_temp.check_('013 first due queue row = first revision row of daily_focus()', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select entity_id from public.daily_focus(10) where kind in ('overdue_revision', 'due_revision') order by rank limit 1$$)
  = pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select entity_id from public.revision_queue() where bucket in ('overdue', 'today') order by rank limit 1$$));
select pg_temp.check_('013 overdue revision surfaces in daily_focus as overdue_revision', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select kind from public.daily_focus(10) where entity_id = 'dd124977-1642-564e-8776-86a09a5ccdbf'$$) = 'overdue_revision');
-- ownership
select pg_temp.check_('013 B sees none of A''s queue', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select * from public.revision_queue()$$) = 0);
select pg_temp.check_('013 anonymous cannot call revision_queue', pg_temp.rows_as(null, $$select * from public.revision_queue()$$) = -1);
select pg_temp.check_('013 revision_queue is executable by authenticated, not anon', has_function_privilege('authenticated', 'public.revision_queue()'::regprocedure, 'execute') and not has_function_privilege('anon', 'public.revision_queue()'::regprocedure, 'execute'));
select pg_temp.owner_try($$update ssc_topics set archived = true where id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286'$$);
select pg_temp.check_('013 an archived item disappears from the queue', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select count(*)::text from public.revision_queue() where entity_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286'$$) = '0');
select pg_temp.owner_try($$update ssc_topics set archived = false where id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286'$$);
select pg_temp.check_('013 and returns when it is un-archived', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select count(*)::text from public.revision_queue() where entity_id = '21ef5dcf-fc38-5b60-9404-dc99fea1f286'$$) = '1');
-- custom ladder shows up in the queue and in scheduling
select pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select public.set_progress('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 'learning', 10, 3)$$);
select pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select public.schedule_revision('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e')$$);
select pg_temp.check_('013 custom ladder: B''s first revision is due +2 days (ladder 2,5,20)', pg_temp.val_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select (due_date - today)::text || '|' || ladder::text from public.revision_queue()$$) = '2|{2,5,20}');

-- ---------------- revision_next as the interval preview (pure, client-callable, any ladder) ----------------
select pg_temp.check_('013 preview Good from step 1 on 2,5,20 -> step 2, 20 days', pg_temp.val_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select step || '|' || interval_days from public.revision_next(1, 'good', '{2,5,20}', date '2026-10-01')$$) = '2|20');
select pg_temp.check_('013 preview Hard from step 2 -> step 1 and the SHORTEST interval (2)', pg_temp.val_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select step || '|' || interval_days from public.revision_next(2, 'hard', '{2,5,20}', date '2026-10-01')$$) = '1|2');
select pg_temp.check_('013 preview Easy from step 1 on 3 steps graduates (no interval, no date)', pg_temp.val_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select graduated::text || '|' || coalesce(interval_days::text, 'null') from public.revision_next(1, 'easy', '{2,5,20}', date '2026-10-01')$$) = 'true|null');
select pg_temp.check_('013 preview uses the ladder it is given (default ladder: Good from step 0 -> 3 days)', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select interval_days::text from public.revision_next(0, 'good', '{1,3,7,15,30}', date '2026-10-01')$$) = '3');

-- ---------------- review: Good ----------------
insert into t_runs (k, id) select 'p7ch2', id from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'dd124977-1642-564e-8776-86a09a5ccdbf' and not done;
select pg_temp.check_('013 Good at step 1 -> step 2, due +7 days, history row appended', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(%L, 'good', 1)$f$, (select id from t_runs where k = 'p7ch2'))) >= 0
  and (select step || '|' || due_date from revision_schedule where id = (select id from t_runs where k = 'p7ch2')) = '2|2026-10-08'
  and (select count(*) = 1 and bool_and(rating = 'good' and step_before = 1 and step_after = 2 and interval_days_after = 7 and not graduated) from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'dd124977-1642-564e-8776-86a09a5ccdbf'));
select pg_temp.check_('013 reviewed item leaves the overdue bucket (becomes upcoming)', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select bucket from public.revision_queue() where entity_id = 'dd124977-1642-564e-8776-86a09a5ccdbf'$$) = 'upcoming');
-- ---------------- duplicate / stale ----------------
select pg_temp.check_('013 duplicate review with the old expected_step is rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(%L, 'good', 1)$f$, (select id from t_runs where k = 'p7ch2'))) = -1);
select pg_temp.check_('013 the duplicate changed nothing (still one history row, still step 2)', (select count(*) = 1 from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'dd124977-1642-564e-8776-86a09a5ccdbf') and (select step = 2 from revision_schedule where id = (select id from t_runs where k = 'p7ch2')));
insert into t_runs (k, id) select 'p7t1', id from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e' and not done;
select pg_temp.check_('013 wrong expected_step (3, actual 2) is rejected and writes nothing', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(%L, 'easy', 3)$f$, (select id from t_runs where k = 'p7t1'))) = -1
  and (select count(*) = 0 from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e') and (select step = 2 from revision_schedule where id = (select id from t_runs where k = 'p7t1')));
select pg_temp.check_('013 unknown rating rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(%L, 'perfect', 2)$f$, (select id from t_runs where k = 'p7t1'))) = -1);
select pg_temp.check_('013 confidence outside 1..5 rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(%L, 'good', 2, 9)$f$, (select id from t_runs where k = 'p7t1'))) = -1);
-- ---------------- Hard ----------------
select pg_temp.check_('013 Hard at step 2 -> step 1, interval = shortest (1 day), history appended not reset', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(%L, 'hard', 2, 2)$f$, (select id from t_runs where k = 'p7t1'))) >= 0
  and (select step || '|' || due_date from revision_schedule where id = (select id from t_runs where k = 'p7t1')) = '1|2026-10-02'
  and (select count(*) = 1 and bool_and(rating = 'hard' and step_before = 2 and step_after = 1 and interval_days_after = 1 and confidence = 2) from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e'));
select pg_temp.check_('013 a second Hard keeps adding history (2 rows), the first one is untouched', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(%L, 'hard', 1)$f$, (select id from t_runs where k = 'p7t1'))) >= 0
  and (select count(*) = 2 from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e') and (select step = 0 from revision_schedule where id = (select id from t_runs where k = 'p7t1')));
select pg_temp.check_('013 Hard at step 0 stays at step 0 (floor)', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(%L, 'hard', 0)$f$, (select id from t_runs where k = 'p7t1'))) >= 0 and (select step = 0 from revision_schedule where id = (select id from t_runs where k = 'p7t1')));
select pg_temp.check_('013 repeated Hard reviews leave the learning engine reporting the item as weak (reason is server-derived)', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select mastery || '|' || (weak_reason is not null)::text from public.user_entity_signals('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e')$$) = 'weak|true');
-- ---------------- Easy + graduation ----------------
insert into t_runs (k, id) select 'p7st1', id from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '4654f3fc-fa66-5d7d-9e71-91c21c483300' and not done;
select pg_temp.check_('013 Easy at the second-to-last step graduates: row closed, no open row, history says graduated', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(%L, 'easy', 3)$f$, (select id from t_runs where k = 'p7st1'))) >= 0
  and (select done from revision_schedule where id = (select id from t_runs where k = 'p7st1')) and (select count(*) = 0 from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '4654f3fc-fa66-5d7d-9e71-91c21c483300' and not done)
  and (select count(*) = 1 and bool_and(graduated and interval_days_after is null) from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '4654f3fc-fa66-5d7d-9e71-91c21c483300'));
select pg_temp.check_('013 graduated item leaves the queue', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select * from public.revision_queue() where entity_id = '4654f3fc-fa66-5d7d-9e71-91c21c483300'$$) = 0);
select pg_temp.check_('013 graduation does not delete progress (the item is still in the learner''s study list)', (select count(*) = 1 from user_progress where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '4654f3fc-fa66-5d7d-9e71-91c21c483300'));
select pg_temp.check_('013 reviewing a CLOSED schedule is rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.review_revision(%L, 'good', 4)$f$, (select id from t_runs where k = 'p7st1'))) = -1);
select pg_temp.check_('013 a graduated item can be scheduled again explicitly (one new open row)', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.schedule_revision('ssc_subtopic', '4654f3fc-fa66-5d7d-9e71-91c21c483300')$$) >= 0 and (select count(*) = 1 from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and entity_id = '4654f3fc-fa66-5d7d-9e71-91c21c483300' and not done));
-- ---------------- custom ladder, full path for B ----------------
insert into t_runs (k, id) select 'p7b', id from revision_schedule where user_id = '7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e' and not done;
select pg_temp.set_now('2026-10-03 12:00:00+00');
select pg_temp.check_('013 B Good at step 0 on ladder 2,5,20 -> step 1, due +5 from the review date', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.review_revision(%L, 'good', 0)$f$, (select id from t_runs where k = 'p7b'))) >= 0
  and (select step || '|' || due_date from revision_schedule where id = (select id from t_runs where k = 'p7b')) = '1|2026-10-08');
select pg_temp.check_('013 changing the ladder later does not rewrite history', pg_temp.owner_try($$update profiles set revision_intervals = '{1,2}' where id = '7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed'$$) >= 0 and (select interval_days_after = 5 from revision_reviews where user_id = '7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed' and entity_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e'));
select pg_temp.set_now('2026-10-01 12:00:00+00');
-- ---------------- append-only + cross-user ----------------
select pg_temp.check_('013 history cannot be UPDATEd by the owner role (append-only trigger)', pg_temp.owner_try($$update revision_reviews set rating = 'easy' where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1);
select pg_temp.check_('013 history cannot be DELETEd directly', pg_temp.owner_try($$delete from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = -1);
select pg_temp.check_('013 clients cannot write history or schedule rows', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update revision_reviews set rating = 'easy'$$) = -1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$delete from revision_reviews$$) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into revision_reviews (user_id, entity_type, entity_id, due_date, reviewed_on, rating) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4', 'ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', current_date, current_date, 'easy')$$) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update revision_schedule set due_date = date '2030-01-01'$$) = -1);
select pg_temp.check_('013 B cannot read A''s reviews or schedule rows', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select * from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = 0 and pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select * from revision_schedule where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4'$$) = 0);
select pg_temp.check_('013 B cannot review A''s schedule (looks like not found)', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.review_revision(%L, 'easy', 2)$f$, (select id from t_runs where k = 'p7t1'))) = -1);
select pg_temp.check_('013 anonymous cannot review', pg_temp.rows_as(null, format($f$select public.review_revision(%L, 'easy', 2)$f$, (select id from t_runs where k = 'p7t1'))) = -1);
select pg_temp.check_('013 A''s history is intact after all attempts (CH2:1, T1:3, ST1:1 reviews)', (select count(*) from revision_reviews where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4') = 5);

-- ======================= RESULTS =======================
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed, count(*) as total from t_results;
select n, label, detail from t_results where not passed order by n;      -- empty = everything passed
select n, case when passed then 'PASS' else 'FAIL' end as result, label from t_results order by n;
rollback;
