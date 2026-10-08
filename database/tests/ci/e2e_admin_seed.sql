-- CI-ONLY admin fixtures for the Phase 10 browser flow. Applied by scripts/ci/seed_e2e.mjs to the SCRATCH database; never part of migrations.
-- Everything starts as DRAFT (the break-glass psql path skips the publish gates on purpose). Titles start with "CI Fixture Draft". ids: c2000000-...
\set ON_ERROR_STOP on
begin;
insert into sources (id, name, source_url, is_verified) values ('c2000000-0000-4000-8000-000000000001', 'CI Fixture Draft source', 'https://example.test/ci-draft', false);
select id as cls6 from classes where grade = 6 limit 1 \gset
insert into subjects (id, class_id, name) values ('c2000000-0000-4000-8000-000000000003', :'cls6', 'CI Fixture Draft Science');
insert into books (id, subject_id, source_id, title, status) values
  ('c2000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000001', 'CI Fixture Draft Book', 'draft'),
  ('c2000000-0000-4000-8000-000000000005', 'c2000000-0000-4000-8000-000000000003', null, 'CI Fixture Draft Book without source', 'draft');
insert into chapters (id, book_id, number, title, relevance, priority, estimated_minutes) values
  ('c2000000-0000-4000-8000-000000000011', 'c2000000-0000-4000-8000-000000000004', 1, 'CI Fixture Draft Chapter zqdraft', 'high', 'high', 30),
  ('c2000000-0000-4000-8000-000000000012', 'c2000000-0000-4000-8000-000000000005', 1, 'CI Fixture Draft Chapter without source', 'medium', 'medium', 30);
insert into ssc_exams (id, name, exam_version, source_id, notification_url, status) values
  ('c2000000-0000-4000-8000-000000000031', 'CI Fixture Draft Exam', 'CI-DRAFT', 'c2000000-0000-4000-8000-000000000001', 'https://example.test/ci-draft-notice', 'draft');
insert into ssc_tiers (id, exam_id, name, position) values ('c2000000-0000-4000-8000-000000000032', 'c2000000-0000-4000-8000-000000000031', 'Tier I', 1);
commit;
