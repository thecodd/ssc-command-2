-- CGL COMMAND — RLS / security test script.  NOT YET EXECUTED (no Postgres was available when written).
-- Run in the Supabase SQL editor AFTER migrations 001-011 (updated for Phase 4: publishing statuses, RPC-only writes, _touch_streak).
-- Phase 4 behaviour (sessions, revision, practice, signals, publishing, import) is covered by database/tests/phase4/ (build_all.sh). Everything runs in one transaction and ends with ROLLBACK,
-- so no fixtures persist. Read the final result table: every row must say PASS.
-- Fixtures use obvious "TEST ..." placeholder names; they are rolled back and are not curriculum data.
begin;

create temp table t_results (n serial, label text, passed boolean, detail text);

-- ---------- helpers (all run as the session owner; each switches role internally and resets it) ----------
-- Rows visible/affected, or -1 if the statement raised an error (permission denied, RLS violation, ...).
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
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;
-- First column of the first row as text (NULL if none / error). Use to assert on actual values.
create or replace function pg_temp.val_as(uid uuid, stmt text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', case when uid is null then '' else json_build_object('sub', uid, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute case when uid is null then 'set local role anon' else 'set local role authenticated' end;
  begin execute 'select x::text from (' || stmt || ') q(x) limit 1' into v; exception when others then v := null; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;
create or replace function pg_temp.check_(label text, cond boolean, detail text default null) returns void language plpgsql as $$
begin insert into t_results (label, passed, detail) values (label, coalesce(cond, false), detail); end $$;

-- ---------- fixtures (as owner: bypasses RLS) ----------
-- Users: A and B are normal users, C is an admin. The signup trigger creates their profiles.
insert into auth.users (id, aud, role, email) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'a@test.local'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'b@test.local'),
  ('cccccccc-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', 'c@test.local');
update profiles set is_admin = true where id = 'cccccccc-0000-0000-0000-00000000000c';   -- owner/SQL editor has no JWT, so the guard allows this

insert into classes (id, grade) values ('10000000-0000-0000-0000-000000000006', 6);
insert into subjects (id, class_id, name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', 'TEST subject');
insert into books (id, subject_id, title, status) values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'TEST book', 'published');   -- published: drafts are invisible to normal users (011)
insert into chapters (id, book_id, title) values ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'TEST official chapter');
insert into ssc_exams (id, exam_version, status) values ('50000000-0000-0000-0000-000000000001', 'TEST', 'published');
insert into ssc_tiers (id, exam_id, name) values ('51000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'TEST tier');
insert into ssc_subjects (id, tier_id, name) values ('52000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'TEST ssc subject');
insert into ssc_topics (id, subject_id, title) values ('53000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000001', 'TEST official topic');
insert into pyqs (id, question, exam, year) values ('60000000-0000-0000-0000-000000000001', 'TEST official question about percentage', 'TEST', 2020);
insert into pyq_topics (pyq_id, ssc_topic_id) values ('60000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000001');
insert into resources (id, user_id, title, entity_type, entity_id) values
  ('70000000-0000-0000-0000-000000000001', null, 'TEST official resource', 'ssc_topic', '53000000-0000-0000-0000-000000000001');
insert into ncert_ssc_mappings (id, ncert_chapter_id, ssc_topic_id, mapping_type) values
  ('80000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000001', 'foundation');

-- A's private data
insert into notes (id, user_id, entity_type, entity_id, title, content) values
  ('90000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 'ssc_topic', '53000000-0000-0000-0000-000000000001', 'TEST secret note', 'TEST private content');
insert into tasks (id, user_id, title) values ('91000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 'TEST secret task');
insert into user_progress (user_id, entity_type, entity_id, status) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'ssc_topic', '53000000-0000-0000-0000-000000000001', 'learning');
insert into study_sessions (id, user_id, entity_type, entity_id) values ('92000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 'ssc_topic', '53000000-0000-0000-0000-000000000001');
insert into revision_schedule (id, user_id, entity_type, entity_id, due_date, interval_days) values ('93000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 'ssc_topic', '53000000-0000-0000-0000-000000000001', current_date, 1);
insert into pyq_attempts (id, user_id, pyq_id, is_correct) values ('94000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000001', true);
insert into resources (id, user_id, title) values ('95000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 'TEST private resource');
insert into chapters (id, book_id, title, owner_id) values ('96000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', 'TEST A custom chapter', 'aaaaaaaa-0000-0000-0000-00000000000a');

-- ============ 1. USER ISOLATION (B must not see or touch A's rows) ============
select pg_temp.check_('B cannot read A notes',            pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$select 1 from notes where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$) = 0);
select pg_temp.check_('B cannot read A tasks',            pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$select 1 from tasks where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$) = 0);
select pg_temp.check_('B cannot read A progress',         pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$select 1 from user_progress where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$) = 0);
select pg_temp.check_('B cannot read A study sessions',   pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$select 1 from study_sessions where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$) = 0);
select pg_temp.check_('B cannot read A revisions',        pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$select 1 from revision_schedule where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$) = 0);
select pg_temp.check_('B cannot read A PYQ attempts',     pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$select 1 from pyq_attempts where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$) = 0);
select pg_temp.check_('B cannot read A private resource', pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$select 1 from resources where id = '95000000-0000-0000-0000-00000000000a'$$) = 0);
select pg_temp.check_('B cannot read A custom chapter',   pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$select 1 from chapters where id = '96000000-0000-0000-0000-00000000000a'$$) = 0);
select pg_temp.check_('A can read own note',              pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$select 1 from notes where id = '90000000-0000-0000-0000-00000000000a'$$) = 1);
select pg_temp.check_('B cannot update A note',           pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$update notes set title = 'hacked' where id = '90000000-0000-0000-0000-00000000000a'$$) = 0);
select pg_temp.check_('B cannot delete A note',           pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$delete from notes where id = '90000000-0000-0000-0000-00000000000a'$$) = 0);
select pg_temp.check_('B cannot update A task',           pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$update tasks set title = 'hacked' where id = '91000000-0000-0000-0000-00000000000a'$$) = 0);
select pg_temp.check_('B cannot update A progress (clients have no UPDATE privilege since 007: denied or 0 rows)', pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$update user_progress set status = 'learning' where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$) <= 0);
select pg_temp.check_('B cannot insert note as A',        pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$insert into notes (user_id, entity_type, entity_id, content) values ('aaaaaaaa-0000-0000-0000-00000000000a','ssc_topic','53000000-0000-0000-0000-000000000001','x')$$) = -1);
select pg_temp.check_('B cannot insert task as A',        pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$insert into tasks (user_id, title) values ('aaaaaaaa-0000-0000-0000-00000000000a','x')$$) = -1);
select pg_temp.check_('B cannot insert PYQ attempt as A', pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$insert into pyq_attempts (user_id, pyq_id, is_correct) values ('aaaaaaaa-0000-0000-0000-00000000000a','60000000-0000-0000-0000-000000000001',true)$$) = -1);
select pg_temp.check_('A cannot insert a PYQ attempt directly (only submit_pyq_answer writes, since 009)', pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$insert into pyq_attempts (user_id, pyq_id, is_correct) values ('aaaaaaaa-0000-0000-0000-00000000000a','60000000-0000-0000-0000-000000000001',false)$$) = -1);
select pg_temp.check_('A can insert/update own task',     pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$update tasks set title = 'TEST renamed' where id = '91000000-0000-0000-0000-00000000000a'$$) = 1);
select pg_temp.check_('Admin C cannot read A notes',      pg_temp.rows_as('cccccccc-0000-0000-0000-00000000000c', $$select 1 from notes where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$) = 0);
select pg_temp.check_('Admin C cannot read A tasks',      pg_temp.rows_as('cccccccc-0000-0000-0000-00000000000c', $$select 1 from tasks where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$) = 0);
select pg_temp.check_('Admin C cannot read A progress',   pg_temp.rows_as('cccccccc-0000-0000-0000-00000000000c', $$select 1 from user_progress where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$) = 0);
select pg_temp.check_('Admin C cannot read A custom chapter', pg_temp.rows_as('cccccccc-0000-0000-0000-00000000000c', $$select 1 from chapters where id = '96000000-0000-0000-0000-00000000000a'$$) = 0);
select pg_temp.check_('Admin C cannot edit A custom chapter', pg_temp.rows_as('cccccccc-0000-0000-0000-00000000000c', $$update chapters set title = 'x' where id = '96000000-0000-0000-0000-00000000000a'$$) = 0);

-- ============ 2. PROFILE SECURITY ============
select pg_temp.check_('A sees exactly one profile (own)', pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', 'select 1 from profiles') = 1);
select pg_temp.check_('A can update own display_name',    pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$update profiles set display_name = 'Alice' where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$) = 1);
select pg_temp.check_('A CANNOT set is_admin = true',     pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$update profiles set is_admin = true where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$) = -1);
select pg_temp.check_('A is_admin still false (verified as owner)', (select is_admin from profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a') = false);
select pg_temp.check_('A CANNOT edit streak_count',       pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$update profiles set streak_count = 99 where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$) = -1);
select pg_temp.check_('A cannot update B profile',        pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$update profiles set display_name = 'hacked' where id = 'bbbbbbbb-0000-0000-0000-00000000000b'$$) = 0);
select pg_temp.check_('A cannot delete own profile',      pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$delete from profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$) = -1);
select pg_temp.check_('A cannot insert profile for B',    pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$insert into profiles (id) values ('bbbbbbbb-0000-0000-0000-00000000000b')$$) = -1);
select pg_temp.check_('A can set valid timezone',         pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$update profiles set timezone = 'America/New_York' where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$) = 1);
select pg_temp.check_('A cannot set invalid timezone',    pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$update profiles set timezone = 'Mars/Base' where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$) = -1);
select pg_temp.check_('Admin C cannot read A profile',    pg_temp.rows_as('cccccccc-0000-0000-0000-00000000000c', $$select 1 from profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$) = 0);
select pg_temp.check_('is_admin(): A=false',              pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', 'select 1 where public.is_admin()') = 0);
select pg_temp.check_('is_admin(): C=true',               pg_temp.rows_as('cccccccc-0000-0000-0000-00000000000c', 'select 1 where public.is_admin()') = 1);
select pg_temp.check_('is_admin(): anon cannot call it',  pg_temp.rows_as(null, 'select 1 where public.is_admin()') <= 0);
select pg_temp.check_('Default timezone is Asia/Kolkata', (select timezone from profiles where id = 'bbbbbbbb-0000-0000-0000-00000000000b') = 'Asia/Kolkata');
select pg_temp.check_('Admin flag is set for C by owner', (select is_admin from profiles where id = 'cccccccc-0000-0000-0000-00000000000c') = true);
-- No recursion: these would raise "infinite recursion detected in policy" (-1) if the policy still queried profiles.
select pg_temp.check_('profiles query by normal user does not recurse', pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', 'select 1 from profiles') = 1);

-- ============ 3. OFFICIAL CURRICULUM ============
select pg_temp.check_('A can read official chapter',      pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$select 1 from chapters where id = '40000000-0000-0000-0000-000000000001'$$) = 1);
select pg_temp.check_('A can read official ssc topic',    pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$select 1 from ssc_topics where id = '53000000-0000-0000-0000-000000000001'$$) = 1);
select pg_temp.check_('A can read mappings',              pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', 'select 1 from ncert_ssc_mappings') = 1);
select pg_temp.check_('A cannot update official chapter', pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$update chapters set title = 'hacked' where id = '40000000-0000-0000-0000-000000000001'$$) = 0);
select pg_temp.check_('A cannot delete official chapter', pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$delete from chapters where id = '40000000-0000-0000-0000-000000000001'$$) = 0);
select pg_temp.check_('A cannot insert official chapter (owner_id null)', pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$insert into chapters (book_id, title) values ('30000000-0000-0000-0000-000000000001','x')$$) = -1);
select pg_temp.check_('A can insert own custom chapter',  pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$insert into chapters (book_id, title, owner_id) values ('30000000-0000-0000-0000-000000000001','TEST mine','aaaaaaaa-0000-0000-0000-00000000000a')$$) = 1);
select pg_temp.check_('A cannot promote own chapter to official', pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$update chapters set owner_id = null where id = '96000000-0000-0000-0000-00000000000a'$$) = -1);
select pg_temp.check_('A cannot insert mapping',          pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$insert into ncert_ssc_mappings (ncert_chapter_id, ssc_topic_id, mapping_type) values ('96000000-0000-0000-0000-00000000000a','53000000-0000-0000-0000-000000000001','direct')$$) = -1);
select pg_temp.check_('A cannot delete mapping',          pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$delete from ncert_ssc_mappings$$) = 0);
select pg_temp.check_('A cannot insert ssc exam',         pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$insert into ssc_exams (exam_version) values ('HACK')$$) = -1);
select pg_temp.check_('Admin C can update official chapter', pg_temp.rows_as('cccccccc-0000-0000-0000-00000000000c', $$update chapters set title = 'TEST official chapter' where id = '40000000-0000-0000-0000-000000000001'$$) = 1);
select pg_temp.check_('Admin C can insert official ssc topic', pg_temp.rows_as('cccccccc-0000-0000-0000-00000000000c', $$insert into ssc_topics (subject_id, title) values ('52000000-0000-0000-0000-000000000001','TEST admin topic')$$) = 1);
select pg_temp.check_('Admin C can insert mapping',       pg_temp.rows_as('cccccccc-0000-0000-0000-00000000000c', $$insert into ncert_ssc_mappings (ncert_chapter_id, ssc_topic_id, mapping_type) select '40000000-0000-0000-0000-000000000001', id, 'direct' from ssc_topics where title = 'TEST admin topic'$$) = 1);
select pg_temp.check_('Admin C can delete mapping',       pg_temp.rows_as('cccccccc-0000-0000-0000-00000000000c', $$delete from ncert_ssc_mappings where mapping_type = 'direct'$$) = 1);
select pg_temp.check_('Admin C can insert ssc exam',      pg_temp.rows_as('cccccccc-0000-0000-0000-00000000000c', $$insert into ssc_exams (exam_version) values ('TEST2')$$) = 1);

-- ============ 4. RESOURCES ============
select pg_temp.check_('A reads official resource',        pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$select 1 from resources where id = '70000000-0000-0000-0000-000000000001'$$) = 1);
select pg_temp.check_('A cannot update official resource',pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$update resources set title = 'hacked' where id = '70000000-0000-0000-0000-000000000001'$$) = 0);
select pg_temp.check_('A cannot delete official resource',pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$delete from resources where id = '70000000-0000-0000-0000-000000000001'$$) = 0);
select pg_temp.check_('A cannot create official resource (user_id null)', pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$insert into resources (user_id, title) values (null, 'x')$$) = -1);
select pg_temp.check_('A can create own resource',        pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$insert into resources (user_id, title) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'TEST mine')$$) = 1);
select pg_temp.check_('A can update own resource',        pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$update resources set title = 'TEST renamed' where id = '95000000-0000-0000-0000-00000000000a'$$) = 1);
select pg_temp.check_('A CANNOT make own resource official (user_id -> null)', pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$update resources set user_id = null where id = '95000000-0000-0000-0000-00000000000a'$$) = -1);
select pg_temp.check_('A cannot reassign own resource to B', pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$update resources set user_id = 'bbbbbbbb-0000-0000-0000-00000000000b' where id = '95000000-0000-0000-0000-00000000000a'$$) = -1);
select pg_temp.check_('Admin C can update official resource', pg_temp.rows_as('cccccccc-0000-0000-0000-00000000000c', $$update resources set title = 'TEST official resource' where id = '70000000-0000-0000-0000-000000000001'$$) = 1);
select pg_temp.check_('Admin C can create official resource', pg_temp.rows_as('cccccccc-0000-0000-0000-00000000000c', $$insert into resources (user_id, title) values (null, 'TEST official 2')$$) = 1);
select pg_temp.check_('Admin C can delete official resource', pg_temp.rows_as('cccccccc-0000-0000-0000-00000000000c', $$delete from resources where title = 'TEST official 2'$$) = 1);
select pg_temp.check_('Admin C cannot update A private resource', pg_temp.rows_as('cccccccc-0000-0000-0000-00000000000c', $$update resources set title = 'x' where id = '95000000-0000-0000-0000-00000000000a'$$) = 0);
select pg_temp.check_('Admin C cannot read A private resource',   pg_temp.rows_as('cccccccc-0000-0000-0000-00000000000c', $$select 1 from resources where id = '95000000-0000-0000-0000-00000000000a'$$) = 0);

-- ============ 5. PYQ LINKS (custom PYQs stay private) ============
insert into pyqs (id, question, owner_id) values ('61000000-0000-0000-0000-00000000000a', 'TEST A private pyq', 'aaaaaaaa-0000-0000-0000-00000000000a');
select pg_temp.check_('A can link own custom PYQ to a topic', pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$insert into pyq_topics (pyq_id, ssc_topic_id) values ('61000000-0000-0000-0000-00000000000a','53000000-0000-0000-0000-000000000001')$$) = 1);
select pg_temp.check_('B cannot link A custom PYQ',         pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$insert into pyq_topics (pyq_id, ssc_topic_id) values ('61000000-0000-0000-0000-00000000000a','53000000-0000-0000-0000-000000000001')$$) = -1);
select pg_temp.check_('B sees only the official PYQ link (not A custom)', pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$select 1 from pyq_topics where ssc_topic_id = '53000000-0000-0000-0000-000000000001'$$) = 1);
select pg_temp.check_('A sees both links',                  pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$select 1 from pyq_topics where ssc_topic_id = '53000000-0000-0000-0000-000000000001'$$) = 2);
select pg_temp.check_('A cannot link an official PYQ as own', pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$insert into pyq_topics (pyq_id, ssc_topic_id) select '60000000-0000-0000-0000-000000000001', id from ssc_topics where title = 'TEST admin topic'$$) = -1);
select pg_temp.check_('topic_pyq_stats: B counts only visible PYQs (1 official)', pg_temp.val_as('bbbbbbbb-0000-0000-0000-00000000000b', $$select pyq_count from topic_pyq_stats('53000000-0000-0000-0000-000000000001')$$) = '1');
select pg_temp.check_('topic_pyq_stats: A counts official + own custom (2)',         pg_temp.val_as('aaaaaaaa-0000-0000-0000-00000000000a', $$select pyq_count from topic_pyq_stats('53000000-0000-0000-0000-000000000001')$$) = '2');
select pg_temp.check_('topic_pyq_stats: A attempts = 2 (one correct, one wrong)',    pg_temp.val_as('aaaaaaaa-0000-0000-0000-00000000000a', $$select attempts::text || '/' || correct::text from topic_pyq_stats('53000000-0000-0000-0000-000000000001')$$) = '2/1');
select pg_temp.check_('topic_pyq_stats: B has 0 attempts (no cross-user leakage)',   pg_temp.val_as('bbbbbbbb-0000-0000-0000-00000000000b', $$select attempts from topic_pyq_stats('53000000-0000-0000-0000-000000000001')$$) = '0');
select pg_temp.check_('topic_pyq_stats RPC callable by user', pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$select * from topic_pyq_stats('53000000-0000-0000-0000-000000000001')$$) = 1);

-- ============ 6. SEARCH / RPC / STREAK ============
select pg_temp.check_('search finds official chapter for A', pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$select * from global_search('official chapter')$$) >= 1);
select pg_temp.check_('search does NOT leak A note to B',    pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$select * from global_search('secret note') where kind = 'note'$$) = 0);
select pg_temp.check_('search returns A note to A',          pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$select * from global_search('secret note') where kind = 'note'$$) = 1);
select pg_temp.check_('search does NOT leak A custom chapter to B', pg_temp.rows_as('bbbbbbbb-0000-0000-0000-00000000000b', $$select * from global_search('A custom chapter')$$) = 0);
select pg_temp.check_('search: wildcard input is treated literally', pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$select * from global_search('%')$$) = 0);
insert into chapters (book_id, title) values
  ('30000000-0000-0000-0000-000000000001', 'Advanced Percentage'), ('30000000-0000-0000-0000-000000000001', 'Percentage Change'),
  ('30000000-0000-0000-0000-000000000001', 'Percentage'), ('30000000-0000-0000-0000-000000000001', 'Compound percentage thinking');
select pg_temp.check_('search rank 1st: exact match',        pg_temp.val_as('aaaaaaaa-0000-0000-0000-00000000000a', $$select title from global_search('percentage') where kind = 'chapter'$$) = 'Percentage');
select pg_temp.check_('search rank 2nd: prefix match',       pg_temp.val_as('aaaaaaaa-0000-0000-0000-00000000000a', $$select title from global_search('percentage') where kind = 'chapter' offset 1$$) = 'Percentage Change');
select pg_temp.check_('search rank 3rd/4th: word-prefix before substring', pg_temp.val_as('aaaaaaaa-0000-0000-0000-00000000000a', $$select title from global_search('percentage') where kind = 'chapter' offset 2$$) in ('Advanced Percentage', 'Compound percentage thinking'));
-- touch_streak() was removed in 007: streaks are touched only inside the study/review/practice RPCs via the internal _touch_streak(uid, day).
select pg_temp.check_('clients cannot call _touch_streak', pg_temp.rows_as('aaaaaaaa-0000-0000-0000-00000000000a', $$select public._touch_streak('aaaaaaaa-0000-0000-0000-00000000000a', date '2026-10-01')$$) = -1);
update profiles set last_study_date = null, streak_count = 0 where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select public._touch_streak('aaaaaaaa-0000-0000-0000-00000000000a', date '2026-10-01');
select pg_temp.check_('streak set to 1 after first touch', (select streak_count from profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a') = 1);
select public._touch_streak('aaaaaaaa-0000-0000-0000-00000000000a', date '2026-10-01');
select pg_temp.check_('streak idempotent on the same day', (select streak_count from profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a') = 1);
select public._touch_streak('aaaaaaaa-0000-0000-0000-00000000000a', date '2026-10-02');
select pg_temp.check_('streak continues to 2 on the next day', (select streak_count from profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a') = 2);
select public._touch_streak('aaaaaaaa-0000-0000-0000-00000000000a', date '2026-10-06');
select pg_temp.check_('streak resets to 1 after a gap', (select streak_count from profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a') = 1);

-- ============ 7. ANONYMOUS ============
select pg_temp.check_('anon cannot read notes',      pg_temp.rows_as(null, 'select 1 from notes') <= 0);
select pg_temp.check_('anon cannot read tasks',      pg_temp.rows_as(null, 'select 1 from tasks') <= 0);
select pg_temp.check_('anon cannot read progress',   pg_temp.rows_as(null, 'select 1 from user_progress') <= 0);
select pg_temp.check_('anon cannot read profiles',   pg_temp.rows_as(null, 'select 1 from profiles') <= 0);
select pg_temp.check_('anon cannot read chapters',   pg_temp.rows_as(null, 'select 1 from chapters') <= 0);
select pg_temp.check_('anon cannot read official resources', pg_temp.rows_as(null, 'select 1 from resources') <= 0);
select pg_temp.check_('anon cannot insert notes',    pg_temp.rows_as(null, $$insert into notes (user_id, entity_type, entity_id, content) values ('aaaaaaaa-0000-0000-0000-00000000000a','ssc_topic','53000000-0000-0000-0000-000000000001','x')$$) = -1);
select pg_temp.check_('anon cannot call global_search', pg_temp.rows_as(null, $$select * from global_search('test')$$) = -1);
select pg_temp.check_('anon cannot call _touch_streak',  pg_temp.rows_as(null, $$select public._touch_streak('aaaaaaaa-0000-0000-0000-00000000000a', date '2026-10-01')$$) = -1);

-- ============ RESULT ============
select n, case when passed then 'PASS' else 'FAIL' end as result, label, detail from t_results order by passed, n;   -- FAIL rows (if any) sort first
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed, count(*) as total from t_results;
rollback;
