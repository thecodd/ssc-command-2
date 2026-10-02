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

-- ============ 012/014: practice security, answer key, search, function privileges ============
-- SQL NOT EXECUTED when written (no Postgres available). Runs inside the phase4 harness transaction (users A, B normal; C admin; fixtures Q1-Q3 on T1/T2).
-- Fixture answers: Q1 = B ("because b"), Q2 = A ("because a"), Q3 = C (topic T2). T1 has Q1+Q2 and subtopic ST1 (Q1).
select pg_temp.set_now('2026-10-01 12:00:00+00');

-- extra fixtures (owner path): an ARCHIVED question and a question WITHOUT a key, both linked to T1; an archived book + archived chapter for search
insert into pyqs (id, paper_id, question, options, correct_answer, explanation, difficulty_level, archived) values
  ('bbf4509c-6180-5df9-8dc6-41d6d3cf37e3', '14901406-fdf3-5de1-a2b2-692f750c1df5', 'TEST archived question', '{"A":"a4","B":"b4"}', 'A', 'because archived', 'easy', true);
insert into pyqs (id, paper_id, question, options, correct_answer, difficulty_level) values
  ('f91a7dac-253b-5710-8062-f0bea3f8c3c3', '14901406-fdf3-5de1-a2b2-692f750c1df5', 'TEST keyless question', null, null, 'easy');
insert into pyq_topics (pyq_id, ssc_topic_id) values ('bbf4509c-6180-5df9-8dc6-41d6d3cf37e3', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e'), ('f91a7dac-253b-5710-8062-f0bea3f8c3c3', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e');
insert into books (id, subject_id, title, status) values ('527e5dc8-668f-5b64-baef-4b2d0149ab72', '10f0ecb3-91d2-5665-918d-cd0db35ae41d', 'TEST archived book', 'archived');
insert into chapters (id, book_id, title) values ('09ff70e0-ffae-5dcf-a9e0-680904dc45c9', '527e5dc8-668f-5b64-baef-4b2d0149ab72', 'TEST zebra archived-book chapter');
insert into chapters (id, book_id, title, archived) values ('52012d9b-0df7-57aa-9d71-c721ab08d48b', 'c199e71a-db01-5359-b575-151d904fa192', 'TEST zebra archived chapter', true);
insert into chapters (id, book_id, title) values ('8c0c7ae9-bc15-580a-9a4d-3ad8b5702a15', 'c199e71a-db01-5359-b575-151d904fa192', 'TEST zebra visible chapter');

-- ---------------- answer key is unreadable by clients ----------------
select pg_temp.check_('012 A cannot read correct_answer', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select correct_answer from pyqs$$) = -1);
select pg_temp.check_('012 A cannot read explanation', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select explanation from pyqs$$) = -1);
select pg_temp.check_('012 A cannot read content_hash', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select content_hash from pyqs$$) = -1);
select pg_temp.check_('012 A cannot select * from pyqs (it includes the key)', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select * from pyqs$$) = -1);
select pg_temp.check_('012 A can read question + options', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select id, question, options from pyqs where id = '6923f5c9-c73b-50f3-aef9-ac779ca167bf'$$) = 1);
select pg_temp.check_('012 filtering BY the key is also blocked (no boolean oracle)', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select id from pyqs where correct_answer = 'B'$$) = -1);
select pg_temp.check_('012 anonymous cannot read pyqs at all', pg_temp.rows_as(null, $$select id from pyqs$$) = -1);
select pg_temp.check_('012 embedding pyqs(correct_answer) through pyq_topics is blocked too', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select y.correct_answer from pyq_topics pt join pyqs y on y.id = pt.pyq_id$$) = -1);
select pg_temp.check_('012 has_valid_key is readable and says only whether a key exists', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select has_valid_key from pyqs where id = '6923f5c9-c73b-50f3-aef9-ac779ca167bf'$$) = 'true');
select pg_temp.check_('012 keyless question has has_valid_key = false', (select not has_valid_key from pyqs where id = 'f91a7dac-253b-5710-8062-f0bea3f8c3c3'));

select pg_temp.owner_try($$update pyqs set has_valid_key = true where id = 'f91a7dac-253b-5710-8062-f0bea3f8c3c3'$$);
select pg_temp.check_('012 has_valid_key cannot be forced: it is recomputed on every update (keyless question stays false)', (select not has_valid_key from pyqs where id = 'f91a7dac-253b-5710-8062-f0bea3f8c3c3'));

-- ---------------- counts only include practisable questions ----------------
select pg_temp.check_('012 topic_pyq_stats ignores archived and keyless questions (T1 = 2)', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select pyq_count from public.topic_pyq_stats('f1ce1c0d-5eed-5602-b11f-afc5a71e886e')$$) = '2');
select pg_temp.check_('012 topic_pyqs lists no archived/keyless question', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select * from public.topic_pyqs('f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 20)$$) = 2);
select pg_temp.check_('012 subject_pyq_counts agrees', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select n from public.subject_pyq_counts('a3acba5a-8f9d-55b0-b7dd-8e359ac3e7d6') where ssc_topic_id = 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e'$$) = '2');
select pg_temp.check_('012 practice_options total equals topic_pyq_stats (2)', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.practice_options('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e') ->> 'total'$$) = '2');

-- ---------------- sessions: start, order, ownership ----------------
select pg_temp.check_('012 A starts topic practice with a stable ordered snapshot (2 questions)', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.start_practice('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 10) ->> 'total'$$) = '2');
insert into t_runs (k, id) select 'p6s', id from practice_sessions where user_id = 'eda6c4d2-347b-52c8-92c4-bd428277acd4' and state = 'active';
select pg_temp.check_('012 snapshot never contains archived or keyless questions', (select not (pyq_ids && array['bbf4509c-6180-5df9-8dc6-41d6d3cf37e3', 'f91a7dac-253b-5710-8062-f0bea3f8c3c3']::uuid[]) from practice_sessions where id = (select id from t_runs where k = 'p6s')));
select pg_temp.check_('012 snapshot only has questions linked to the scope', (select pyq_ids <@ array['6923f5c9-c73b-50f3-aef9-ac779ca167bf', '07eb48c9-f9a3-509c-b73e-b75054a43319']::uuid[] from practice_sessions where id = (select id from t_runs where k = 'p6s')));
create temp table t_order as select pyq_ids as ids from practice_sessions where id = (select id from t_runs where k = 'p6s');
insert into pyqs (id, paper_id, question, options, correct_answer, difficulty_level) values ('9d77b95e-046a-5f4d-8e05-058589c66c72', '45075014-9a46-5d77-9064-50eb4f553616', 'TEST late question', '{"A":"x","B":"y"}', 'A', 'easy');
insert into pyq_topics (pyq_id, ssc_topic_id) values ('9d77b95e-046a-5f4d-8e05-058589c66c72', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e');
select pg_temp.check_('012 questions added after the start do not change the session (order preserved)', (select pyq_ids = (select ids from t_order) from practice_sessions where id = (select id from t_runs where k = 'p6s')));
select pg_temp.check_('012 practice_state returns pyq_ids in the stored order', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select (public.practice_state(%L) -> 'pyq_ids')::text$f$, (select id from t_runs where k = 'p6s'))) = (select to_jsonb(ids)::text from t_order));
select pg_temp.check_('012 same scope + filters returns the SAME session', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.start_practice('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 10) ->> 'id'$$) = (select id::text from t_runs where k = 'p6s'));
select pg_temp.check_('012 B cannot read A session state', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.practice_state(%L)$f$, (select id from t_runs where k = 'p6s'))) = -1);
select pg_temp.check_('012 B cannot read A question', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.practice_question(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf')$f$, (select id from t_runs where k = 'p6s'))) = -1);
select pg_temp.check_('012 B cannot finish A session', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.finish_practice(%L, false)$f$, (select id from t_runs where k = 'p6s'))) = -1);
select pg_temp.check_('012 B cannot submit into A session', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.submit_pyq_answer(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'B', 5)$f$, (select id from t_runs where k = 'p6s'))) = -1);
select pg_temp.check_('012 a question outside the session is rejected (Q3 belongs to T2)', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.practice_question(%L, '538b4267-45b8-521c-afd0-73e417e5dccc')$f$, (select id from t_runs where k = 'p6s'))) = -1);
select pg_temp.check_('012 submitting a question outside the session is rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(%L, '538b4267-45b8-521c-afd0-73e417e5dccc', 'C', 5)$f$, (select id from t_runs where k = 'p6s'))) = -1);
select pg_temp.check_('012 anonymous cannot call practice RPCs', pg_temp.rows_as(null, format($f$select public.practice_question(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf')$f$, (select id from t_runs where k = 'p6s'))) = -1);

-- ---------------- the answer is withheld until the question is answered ----------------
select pg_temp.check_('012 before answering: answer is null', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select (public.practice_question(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf') -> 'answer')::text$f$, (select id from t_runs where k = 'p6s'))) is null
  or pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select (public.practice_question(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf') -> 'answer')::text$f$, (select id from t_runs where k = 'p6s'))) = 'null');
select pg_temp.check_('012 before answering: the payload contains neither the explanation nor the key text', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select (position('because' in public.practice_question(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf')::text) = 0)::text$f$, (select id from t_runs where k = 'p6s'))) = 'true');
select pg_temp.check_('012 before answering: no mapped topic or concept hints', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select (public.practice_question(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf') -> 'topics')::text$f$, (select id from t_runs where k = 'p6s'))) in ('null') or pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select (public.practice_question(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf') -> 'topics')::text$f$, (select id from t_runs where k = 'p6s'))) is null);
select pg_temp.check_('012 options are returned (question is answerable)', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select (public.practice_question(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf') -> 'options' ->> 'B')$f$, (select id from t_runs where k = 'p6s'))) = 'b1');

-- ---------------- server-side grading ----------------
select pg_temp.check_('012 submit_pyq_answer has no correctness parameter', (select pg_get_function_arguments(p.oid) !~* 'correct' from pg_proc p where p.proname = 'submit_pyq_answer'));
select pg_temp.check_('012 an option that does not exist is rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'Z', 5)$f$, (select id from t_runs where k = 'p6s'))) = -1);
select pg_temp.check_('012 correct pick graded correct BY THE SERVER', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'B', 7) ->> 'is_correct'$f$, (select id from t_runs where k = 'p6s'))) = 'true');
select pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(%L, '07eb48c9-f9a3-509c-b73e-b75054a43319', 'D', 7)$f$, (select id from t_runs where k = 'p6s')));
select pg_temp.check_('012 wrong pick graded incorrect BY THE SERVER (stored with is_correct = false)', (select not is_correct and selected_answer = 'D' from pyq_attempts where session_id = (select id from t_runs where k = 'p6s') and pyq_id = '07eb48c9-f9a3-509c-b73e-b75054a43319'));
select pg_temp.check_('012 duplicate submit changes nothing and reports duplicate', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'A', 7) ->> 'duplicate'$f$, (select id from t_runs where k = 'p6s'))) = 'true');
select pg_temp.check_('012 duplicate with a DIFFERENT option still returns the ORIGINAL result', (select is_correct and selected_answer = 'B' from pyq_attempts where session_id = (select id from t_runs where k = 'p6s') and pyq_id = '6923f5c9-c73b-50f3-aef9-ac779ca167bf'));
select pg_temp.check_('012 exactly one attempt per question per session', (select count(*) = 2 from pyq_attempts where session_id = (select id from t_runs where k = 'p6s')));
select pg_temp.check_('012 after answering: key, explanation and topic are returned', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.practice_question(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf') -> 'answer' ->> 'explanation'$f$, (select id from t_runs where k = 'p6s'))) = 'because b'
  and pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select jsonb_array_length(public.practice_question(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf') -> 'topics')::text$f$, (select id from t_runs where k = 'p6s'))) = '1');
select pg_temp.check_('012 informational time is clamped (never above 7200)', (select max(time_taken_seconds) <= 7200 from pyq_attempts where session_id = (select id from t_runs where k = 'p6s')));

-- ---------------- attempts cannot be forged or read across users ----------------
select pg_temp.check_('012 A cannot INSERT an attempt directly', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$insert into pyq_attempts (user_id, pyq_id, is_correct) values ('eda6c4d2-347b-52c8-92c4-bd428277acd4', '6923f5c9-c73b-50f3-aef9-ac779ca167bf', true)$$) = -1);
select pg_temp.check_('012 A cannot UPDATE an attempt (forge correctness)', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update pyq_attempts set is_correct = true$$) = -1);
select pg_temp.check_('012 A cannot DELETE an attempt', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$delete from pyq_attempts$$) = -1);
select pg_temp.check_('012 B sees none of A attempts', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select * from pyq_attempts$$) = 0);
select pg_temp.check_('012 A sees own attempts', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select * from pyq_attempts$$) = 2);
select pg_temp.check_('012 B cannot UPDATE A attempts', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$update pyq_attempts set is_correct = false$$) = -1);
select pg_temp.check_('012 clients cannot write practice_sessions directly', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$update practice_sessions set pyq_ids = array['538b4267-45b8-521c-afd0-73e417e5dccc']::uuid[]$$) = -1);
select pg_temp.check_('012 B sees no practice sessions of A', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select * from practice_sessions$$) = 0);

-- ---------------- finish + ended sessions ----------------
select pg_temp.check_('012 finish returns server totals (2 attempted, 1 correct, accuracy 50)', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select concat_ws('/', j ->> 'attempted', j ->> 'correct', j ->> 'accuracy') from (select public.finish_practice(%L, false) j) q$f$, (select id from t_runs where k = 'p6s'))) = '2/1/50');
select pg_temp.check_('012 finish twice returns the same summary (idempotent)', pg_temp.val_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.finish_practice(%L, false) ->> 'correct'$f$, (select id from t_runs where k = 'p6s'))) = '1');
select pg_temp.check_('012 submitting to an ENDED session is rejected', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.submit_pyq_answer(%L, '6923f5c9-c73b-50f3-aef9-ac779ca167bf', 'B', 1)$f$, (select id from t_runs where k = 'p6s'))) = -1);
select pg_temp.check_('012 an ended session can still be read by its owner (summary / review)', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', format($f$select public.practice_state(%L)$f$, (select id from t_runs where k = 'p6s'))) = 1);

-- ---------------- filters ----------------
select pg_temp.check_('012 unknown difficulty is rejected by the type', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select public.start_practice('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 5, 'impossible', null)$$) = -1);
select pg_temp.check_('012 unknown paper is rejected', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select public.start_practice('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 5, null, '99999999-0000-0000-0000-000000000000')$$) = -1);
select pg_temp.check_('012 difficulty filter narrows the snapshot', pg_temp.val_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select public.start_practice('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 10, 'easy', null) ->> 'total'$$) = '2');
select pg_temp.check_('012 a different filter abandons the old session and starts a new one (one active session)', pg_temp.val_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select public.start_practice('ssc_topic', 'f1ce1c0d-5eed-5602-b11f-afc5a71e886e', 10, 'medium', null) ->> 'total'$$) = '1'
  and (select count(*) = 1 from practice_sessions where user_id = '7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed' and state = 'active'));
select pg_temp.check_('012 count is clamped to 50', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', $$select public.start_practice('mixed', null, 100000)$$) >= 0);

-- ---------------- search: archived / unpublished content is invisible to normal users ----------------
select pg_temp.check_('012 search hides a chapter whose BOOK is archived', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select * from public.global_search('zebra archived-book', 20)$$) = 0);
select pg_temp.check_('012 search hides an archived chapter', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select * from public.global_search('zebra archived chapter', 20) where kind = 'chapter'$$) = 0);
select pg_temp.check_('012 search still finds a visible chapter', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select * from public.global_search('zebra visible', 20) where kind = 'chapter'$$) = 1);
select pg_temp.check_('012 search hides archived pyqs', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select * from public.global_search('archived question', 20) where kind = 'pyq'$$) = 0);
select pg_temp.check_('012 admin still finds the archived-book chapter', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select * from public.global_search('zebra archived-book', 20)$$) >= 1);
select pg_temp.check_('012 admin still finds the archived chapter', pg_temp.rows_as('b2251d3c-7aed-5d3b-bb07-97b3955353d1', $$select * from public.global_search('zebra archived chapter', 20) where kind = 'chapter'$$) >= 1);
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
select pg_temp.check_('014 a normal user cannot run admin RPCs', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.import_create_run('x.json', 'abc', '{}'::jsonb, true)$$) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.verify_source('eb424051-fc9e-5703-85b7-4a0069f25278', true)$$) = -1 and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public.set_publish_status('book', 'c199e71a-db01-5359-b575-151d904fa192', 'archived')$$) = -1);
select pg_temp.check_('014 a normal user cannot call internal helpers with someone else''s id', pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public._close_session('00000000-0000-0000-0000-000000000000', 'abandoned', now())$$) = -1
  and pg_temp.rows_as('eda6c4d2-347b-52c8-92c4-bd428277acd4', $$select public._touch_streak('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', current_date)$$) = -1);
select pg_temp.check_('014 a normal user cannot read ANOTHER user''s study session through the RPCs', pg_temp.rows_as('7b42fa5b-3c62-526e-9a9f-d6c4926ac3ed', format($f$select public.study_pause(%L)$f$, '00000000-0000-0000-0000-000000000000')) = -1);

-- ======================= RESULTS =======================
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed, count(*) as total from t_results;
select n, label, detail from t_results where not passed order by n;      -- empty = everything passed
select n, case when passed then 'PASS' else 'FAIL' end as result, label from t_results order by n;
rollback;
