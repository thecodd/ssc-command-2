-- PHASE 4 DATABASE TEST SUITE — SQL NOT EXECUTED when this was written (no Postgres available). Run after migrations 001-011.
-- One transaction, ends in ROLLBACK. The clock is pinned with app_now()'s test GUCs so every duration is deterministic.
-- Read the final result table: every row must say PASS. Fixtures use "TEST ..." names and are rolled back.
begin;
create temp table t_results (n serial, label text, passed boolean, detail text);
create temp table t_runs (k text primary key, id uuid);
create temp table t_ret (k text primary key, n bigint);                      -- results of actions run in their OWN statement (see the visibility note below)
create temp table t_errors (n serial, uid uuid, sqlstate text, message text, stmt text);   -- every error the helpers swallowed (kept for diagnostics; the kit prints it as CGL_ERR lines)

-- HARNESS RULES (learned from the first real runs):
--  1. A SELECT cannot see rows written by a VOLATILE function called in the SAME statement. Never write `rows_as(<write>) >= 0 and (select <read of what it wrote>)`:
--     run the action in its own statement (`insert into t_ret select k, rows_as(...)`) and check the resulting state in the NEXT statement.
--  2. `select count(*) from (select stable_fn(...)) q` never EVALUATES a STABLE/IMMUTABLE function nobody reads (no error, no privilege check). rows_as therefore
--     consumes every output column (count of the row text), so errors and EXECUTE-privilege failures of STABLE functions are really observed.

-- rows visible / affected for a statement run AS a user (null = anon), or -1 if it raised (the error is recorded in t_errors).
create or replace function pg_temp.rows_as(uid uuid, stmt text) returns bigint language plpgsql as $$
declare n bigint; v_state text; v_msg text;
begin
  perform set_config('request.jwt.claims', case when uid is null then '' else json_build_object('sub', uid, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute case when uid is null then 'set local role anon' else 'set local role authenticated' end;
  begin
    if lower(ltrim(stmt)) like 'select%' then execute 'select count(t) from (select q::text as t from (' || stmt || ') q) z' into n;
    else execute stmt; get diagnostics n = row_count; end if;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; n := -1;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  if n = -1 then insert into t_errors (uid, sqlstate, message, stmt) values (uid, v_state, v_msg, left(regexp_replace(stmt, '\s+', ' ', 'g'), 240)); end if;
  return n;
end $$;
-- first column of first row as text (NULL on error / no rows)
create or replace function pg_temp.val_as(uid uuid, stmt text) returns text language plpgsql as $$
declare v text; v_state text; v_msg text; v_err boolean := false;
begin
  perform set_config('request.jwt.claims', case when uid is null then '' else json_build_object('sub', uid, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute case when uid is null then 'set local role anon' else 'set local role authenticated' end;
  begin execute 'select x::text from (' || stmt || ') q(x) limit 1' into v;
  exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; v := null; v_err := true; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  if v_err then insert into t_errors (uid, sqlstate, message, stmt) values (uid, v_state, v_msg, left(regexp_replace(stmt, '\s+', ' ', 'g'), 240)); end if;
  return v;
end $$;
-- run as the session owner (bypasses RLS, no JWT): rows affected or -1 on error
create or replace function pg_temp.owner_try(stmt text) returns bigint language plpgsql as $$
declare n bigint; v_state text; v_msg text;
begin
  begin execute stmt; get diagnostics n = row_count;
  exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; n := -1; end;
  if n = -1 then insert into t_errors (uid, sqlstate, message, stmt) values (null, v_state, v_msg, left(regexp_replace(stmt, '\s+', ' ', 'g'), 240)); end if;
  return n;
end $$;
create or replace function pg_temp.check_(label text, cond boolean, detail text default null) returns void language plpgsql as $$
begin insert into t_results (label, passed, detail) values (label, coalesce(cond, false), detail); end $$;
create or replace function pg_temp.set_now(ts text) returns void language plpgsql as $$
begin perform set_config('app.allow_test_clock', 'on', true); perform set_config('app.test_now', ts, true); end $$;

select pg_temp.set_now('2026-10-01 12:00:00+00');      -- 17:30 in Asia/Kolkata: local date 2026-10-01

-- ---------------- users: A, B normal; C admin; D custom-content deletion; E revision-history deletion; F signals scenario ----------------
insert into auth.users (id, aud, role, email) values
  ('@A@','authenticated','authenticated','a@test.local'), ('@B@','authenticated','authenticated','b@test.local'), ('@C@','authenticated','authenticated','c@test.local'),
  ('@D@','authenticated','authenticated','d@test.local'), ('@E@','authenticated','authenticated','e@test.local'), ('@F@','authenticated','authenticated','f@test.local');
update profiles set is_admin = true where id = '@C@';       -- owner path: no JWT, so the guard allows it

-- ---------------- curriculum fixtures (inserted as owner; status set explicitly, owner bypasses the draft-on-insert rule) ----------------
insert into sources (id, name, source_url) values ('@SRC1@', 'TEST source', 'https://example.test/source'), ('@SRC2@', 'TEST source 2', null);
insert into classes (id, grade) values ('@CLS6@', 6);
insert into subjects (id, class_id, name) values ('@SUBJ@', '@CLS6@', 'TEST subject');
insert into books (id, subject_id, source_id, title, status) values ('@BK1@', '@SUBJ@', '@SRC1@', 'TEST book', 'published');
insert into chapters (id, book_id, number, title) values ('@CH1@', '@BK1@', 1, 'TEST official chapter'), ('@CH2@', '@BK1@', 2, 'TEST unmapped chapter');
insert into ssc_exams (id, exam_version, source_id, status) values ('@EX1@', 'TEST', '@SRC1@', 'published');
insert into ssc_tiers (id, exam_id, name) values ('@TR1@', '@EX1@', 'TEST tier');
insert into ssc_subjects (id, tier_id, name) values ('@SS1@', '@TR1@', 'TEST ssc subject');
insert into ssc_topics (id, subject_id, title, priority, position) values
  ('@T1@', '@SS1@', 'TEST official topic', 'high', 1), ('@T2@', '@SS1@', 'TEST second topic', 'medium', 2), ('@T3@', '@SS1@', 'TEST third topic', 'high', 3);
insert into ssc_subtopics (id, topic_id, title) values ('@ST1@', '@T1@', 'TEST subtopic one'), ('@ST2@', '@T2@', 'TEST subtopic two');
insert into ncert_ssc_mappings (id, ncert_chapter_id, ssc_topic_id, mapping_type, relevance, recommended) values ('@MAP1@', '@CH1@', '@T1@', 'foundation', 'high', true);
insert into exam_papers (id, exam, year, tier) values ('@P1@', 'SSC CGL', 2020, 'Tier I'), ('@P2@', 'SSC CGL', 2021, 'Tier I');
insert into pyqs (id, paper_id, question, options, correct_answer, explanation, difficulty_level) values
  ('@Q1@', '@P1@', 'TEST question one', '{"A":"a1","B":"b1","C":"c1","D":"d1"}', 'B', 'because b', 'medium'),
  ('@Q2@', '@P2@', 'TEST question two', '{"A":"a2","B":"b2","C":"c2","D":"d2"}', 'A', 'because a', 'easy'),
  ('@Q3@', '@P1@', 'TEST question three', '{"A":"a3","B":"b3","C":"c3","D":"d3"}', 'C', 'because c', 'hard');
insert into pyq_topics (pyq_id, ssc_topic_id) values ('@Q1@','@T1@'), ('@Q2@','@T1@'), ('@Q3@','@T2@');
insert into pyq_subtopics (pyq_id, ssc_topic_id, ssc_subtopic_id) values ('@Q1@','@T1@','@ST1@');
-- a DRAFT book / exam (invisible to normal users)
insert into books (id, subject_id, title, status) values ('@BKD@', '@SUBJ@', 'TEST draft book', 'draft');
insert into chapters (id, book_id, title) values ('@CHD@', '@BKD@', 'TEST draft chapter');
insert into ssc_exams (id, exam_version, status) values ('@EXD@', 'TESTDRAFT', 'draft');
