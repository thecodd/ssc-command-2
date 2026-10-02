-- CI-ONLY end-to-end fixtures. Applied by scripts/ci/seed_e2e.mjs to the SCRATCH database after the SQL suites passed. Never part of migrations or production content.
-- psql variables: uid (the CI user's auth.users id). Titles all start with "CI Fixture". Fixed ids use the c1000000-... prefix.
-- It gives the CI user: published NCERT + SSC curriculum with mappings and subtopics, 12 PYQs, progress through the REAL RPCs (set_progress / review_revision),
-- an OVERDUE revision, a revision DUE TODAY, an UPCOMING revision with a review history, and an in-progress topic, so every route has real data.
\set ON_ERROR_STOP on
begin;
insert into sources (id, name, source_url) values ('c1000000-0000-4000-8000-000000000001', 'CI Fixture source', 'https://example.test/ci-fixture');
insert into classes (id, grade) select 'c1000000-0000-4000-8000-000000000002', 6 where not exists (select 1 from classes where grade = 6);
select id as cls6 from classes where grade = 6 limit 1 \gset
insert into subjects (id, class_id, name) values ('c1000000-0000-4000-8000-000000000003', :'cls6', 'CI Fixture Geography');
insert into books (id, subject_id, source_id, title, status) values ('c1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'CI Fixture book', 'published');
insert into chapters (id, book_id, number, title, relevance, priority, estimated_minutes) values
  ('c1000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000004', 1, 'CI Fixture chapter one', 'high', 'high', 40),
  ('c1000000-0000-4000-8000-000000000012', 'c1000000-0000-4000-8000-000000000004', 2, 'CI Fixture chapter two', 'medium', 'medium', 30);
insert into concepts (id, chapter_id, title, position) values
  ('c1000000-0000-4000-8000-000000000021', 'c1000000-0000-4000-8000-000000000011', 'CI Fixture concept A', 1),
  ('c1000000-0000-4000-8000-000000000022', 'c1000000-0000-4000-8000-000000000011', 'CI Fixture concept B', 2),
  ('c1000000-0000-4000-8000-000000000023', 'c1000000-0000-4000-8000-000000000012', 'CI Fixture concept C', 1);
insert into ssc_exams (id, name, exam_version, source_id, status) values ('c1000000-0000-4000-8000-000000000031', 'CI Fixture Exam', 'CI-FIXTURE', 'c1000000-0000-4000-8000-000000000001', 'published');
insert into ssc_tiers (id, exam_id, name, position) values ('c1000000-0000-4000-8000-000000000032', 'c1000000-0000-4000-8000-000000000031', 'Tier I', 1);
insert into ssc_subjects (id, tier_id, name, position) values ('c1000000-0000-4000-8000-000000000033', 'c1000000-0000-4000-8000-000000000032', 'CI Fixture General Awareness', 1);
insert into ssc_topics (id, subject_id, title, priority, estimated_minutes, position) values
  ('c1000000-0000-4000-8000-000000000041', 'c1000000-0000-4000-8000-000000000033', 'CI Fixture topic one', 'high', 60, 1),
  ('c1000000-0000-4000-8000-000000000042', 'c1000000-0000-4000-8000-000000000033', 'CI Fixture topic two', 'medium', 45, 2),
  ('c1000000-0000-4000-8000-000000000043', 'c1000000-0000-4000-8000-000000000033', 'CI Fixture topic three', 'low', 30, 3);
insert into ssc_subtopics (id, topic_id, title, position) values
  ('c1000000-0000-4000-8000-000000000051', 'c1000000-0000-4000-8000-000000000041', 'CI Fixture subtopic 1', 1),
  ('c1000000-0000-4000-8000-000000000052', 'c1000000-0000-4000-8000-000000000041', 'CI Fixture subtopic 2', 2),
  ('c1000000-0000-4000-8000-000000000053', 'c1000000-0000-4000-8000-000000000042', 'CI Fixture subtopic 3', 1);
insert into ncert_ssc_mappings (id, ncert_chapter_id, ssc_topic_id, mapping_type, relevance, reason, recommended) values
  ('c1000000-0000-4000-8000-000000000061', 'c1000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000041', 'foundation', 'high', 'CI fixture: chapter one underpins topic one', true),
  ('c1000000-0000-4000-8000-000000000062', 'c1000000-0000-4000-8000-000000000012', 'c1000000-0000-4000-8000-000000000042', 'direct', 'medium', 'CI fixture: chapter two feeds topic two', true);
insert into exam_papers (id, exam, year, tier) values ('c1000000-0000-4000-8000-000000000071', 'SSC CGL', 2022, 'Tier I');
insert into pyqs (id, paper_id, question, options, correct_answer, explanation, difficulty_level)
select ('c1000000-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'c1000000-0000-4000-8000-000000000071', 'CI Fixture question ' || n,
       jsonb_build_object('A', 'option a' || n, 'B', 'option b' || n, 'C', 'option c' || n, 'D', 'option d' || n),
       (array['A', 'B', 'C', 'D'])[1 + (n % 4)], 'CI fixture explanation ' || n, (array['easy', 'medium', 'hard'])[1 + (n % 3)]::difficulty_t
  from generate_series(1, 12) n;
insert into pyq_topics (pyq_id, ssc_topic_id) select ('c1000000-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid, case when n <= 8 then 'c1000000-0000-4000-8000-000000000041'::uuid else 'c1000000-0000-4000-8000-000000000042'::uuid end from generate_series(1, 12) n;
commit;

-- ---- the learner's state, through the REAL client RPCs (as the CI user), so the seeded rows are exactly what the app would have produced ----
begin;
select set_config('request.jwt.claim.sub', :'uid', true), set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.set_progress('ncert_chapter', 'c1000000-0000-4000-8000-000000000011', 'completed', 100, 4);     -- seeds a revision (made OVERDUE below)
select public.set_progress('ssc_topic', 'c1000000-0000-4000-8000-000000000041', 'completed', 100, 3);          -- seeds a revision (made DUE TODAY below)
select public.set_progress('ncert_chapter', 'c1000000-0000-4000-8000-000000000012', 'completed', 100, 5);     -- reviewed once below -> history + an UPCOMING revision
select public.set_progress('ssc_topic', 'c1000000-0000-4000-8000-000000000042', 'learning', 40, 2);
reset role;
update revision_schedule set due_date = public.user_today(:'uid'::uuid) - 3 where user_id = :'uid'::uuid and entity_id = 'c1000000-0000-4000-8000-000000000011' and not done;
update revision_schedule set due_date = public.user_today(:'uid'::uuid)     where user_id = :'uid'::uuid and entity_id = 'c1000000-0000-4000-8000-000000000041' and not done;
update revision_schedule set due_date = public.user_today(:'uid'::uuid)     where user_id = :'uid'::uuid and entity_id = 'c1000000-0000-4000-8000-000000000012' and not done;
set local role authenticated;
select public.review_revision((select id from revision_schedule where user_id = :'uid'::uuid and entity_id = 'c1000000-0000-4000-8000-000000000012' and not done), 'good', 0, 4);
reset role;
commit;
