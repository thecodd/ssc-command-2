-- ============ 011 publishing, trust flags, import ============
select pg_temp.set_now('2026-10-01 12:00:00+00');
-- draft invisibility
select pg_temp.check_('011 normal user cannot see a draft book', pg_temp.rows_as('@A@', $$select 1 from books where id = '@BKD@'$$) = 0);
select pg_temp.check_('011 ... nor its chapters', pg_temp.rows_as('@A@', $$select 1 from chapters where id = '@CHD@'$$) = 0);
select pg_temp.check_('011 ... nor a draft exam', pg_temp.rows_as('@A@', $$select 1 from ssc_exams where id = '@EXD@'$$) = 0);
select pg_temp.check_('011 admin sees drafts', pg_temp.rows_as('@C@', $$select 1 from books where id = '@BKD@'$$) = 1 and pg_temp.rows_as('@C@', $$select 1 from chapters where id = '@CHD@'$$) = 1);
select pg_temp.check_('011 published content is visible to users', pg_temp.rows_as('@A@', $$select 1 from chapters where id = '@CH1@'$$) = 1 and pg_temp.rows_as('@A@', $$select 1 from ssc_topics where id = '@T1@'$$) = 1);
select pg_temp.check_('011 a user cannot attach a custom chapter to a draft book', pg_temp.rows_as('@A@', $$insert into chapters (book_id, title, owner_id) values ('@BKD@', 'x', '@A@')$$) = -1);
select pg_temp.check_('011 global_search does not leak draft chapters', pg_temp.rows_as('@A@', $$select 1 from public.global_search('draft chapter', 20)$$) = 0);
-- API inserts are always draft
select pg_temp.check_('011 admin can insert a book through the API', pg_temp.rows_as('@C@', $$insert into books (id, subject_id, title, status) values ('@BKN@', '@SUBJ@', 'TEST api book', 'published')$$) = 1);
select pg_temp.check_('011 ... and it is forced to draft', (select status::text from books where id = '@BKN@') = 'draft');
-- transitions
select pg_temp.check_('011 normal user cannot publish via the RPC', pg_temp.rows_as('@A@', $$select public.set_publish_status('book', '@BKD@', 'in_review')$$) = -1);
select pg_temp.check_('011 normal user cannot publish via a direct UPDATE', pg_temp.rows_as('@A@', $$update books set status = 'published' where id = '@BKD@'$$) <= 0);
select pg_temp.check_('011 draft -> published directly is refused', pg_temp.rows_as('@C@', $$select public.set_publish_status('book', '@BKD@', 'published')$$) = -1);
select pg_temp.check_('011 draft -> in_review ok', pg_temp.rows_as('@C@', $$select public.set_publish_status('book', '@BKD@', 'in_review')$$) = 1);
select pg_temp.check_('011 publishing without a source is refused', pg_temp.rows_as('@C@', $$select public.set_publish_status('book', '@BKD@', 'published')$$) = -1);
update books set source_id = '@SRC1@' where id = '@BKN@';
select pg_temp.owner_try($$update books set source_id = '@SRC1@' where id = '@BKD@'$$);
select pg_temp.check_('011 publishing with a source and chapters works (call)', pg_temp.rows_as('@C@', $$select public.set_publish_status('book', '@BKD@', 'published')$$) = 1);
select pg_temp.check_('011 publishing with a source and chapters works (effect)', (select status::text from books where id = '@BKD@') = 'published');
select pg_temp.check_('011 a published book is now visible to users (and its chapter)', pg_temp.rows_as('@A@', $$select 1 from books where id = '@BKD@'$$) = 1 and pg_temp.rows_as('@A@', $$select 1 from chapters where id = '@CHD@'$$) = 1);
select pg_temp.check_('011 published -> draft is refused', pg_temp.rows_as('@C@', $$select public.set_publish_status('book', '@BKD@', 'draft')$$) = -1);
select pg_temp.check_('011 publishing an empty book is refused', pg_temp.rows_as('@C@', $$select public.set_publish_status('book', '@BKN@', 'in_review')$$) = 1 and pg_temp.rows_as('@C@', $$select public.set_publish_status('book', '@BKN@', 'published')$$) = -1);
select pg_temp.check_('011 published -> archived ok; archived mirrors books.archived (call)', pg_temp.rows_as('@C@', $$select public.set_publish_status('book', '@BKD@', 'archived')$$) = 1);
select pg_temp.check_('011 published -> archived ok; archived mirrors books.archived (effect)', (select archived from books where id = '@BKD@'));
select pg_temp.check_('011 archived content stays readable', pg_temp.rows_as('@A@', $$select 1 from chapters where id = '@CHD@'$$) = 1);
select pg_temp.check_('011 archived chapter is not an active entity', (select count(*) from public.active_entities() where entity_id = '@CHD@') = 0);
select pg_temp.check_('011 archived -> published (restore) ok', pg_temp.rows_as('@C@', $$select public.set_publish_status('book', '@BKD@', 'published')$$) = 1);
select pg_temp.check_('011 bad kind rejected', pg_temp.rows_as('@C@', $$select public.set_publish_status('chapter', '@CH1@', 'draft')$$) = -1);
-- exams
select pg_temp.check_('011 publishing an exam without tiers refused', pg_temp.rows_as('@C@', $$select public.set_publish_status('ssc_exam', '@EXD@', 'in_review')$$) = 1 and pg_temp.rows_as('@C@', $$select public.set_publish_status('ssc_exam', '@EXD@', 'published')$$) = -1);
-- trust flags
select pg_temp.check_('011 admin cannot flip sources.is_verified directly', pg_temp.rows_as('@C@', $$update sources set is_verified = true where id = '@SRC1@'$$) = -1);
select pg_temp.check_('011 admin cannot flip ssc_exams.is_official directly', pg_temp.rows_as('@C@', $$update ssc_exams set is_official = true where id = '@EX1@'$$) = -1);
select pg_temp.check_('011 admin cannot insert an already-verified source', pg_temp.rows_as('@C@', $$insert into sources (name, is_verified) values ('TEST sneaky', true)$$) = -1);
select pg_temp.check_('011 normal user cannot verify', pg_temp.rows_as('@A@', $$select public.verify_source('@SRC1@')$$) = -1);
select pg_temp.check_('011 admin verify_source works', pg_temp.rows_as('@C@', $$select public.verify_source('@SRC1@')$$) = 1);
select pg_temp.check_('011 ... and stamps who and when', (select is_verified::text || '|' || (verified_by = '@C@')::text || '|' || (verified_at is not null)::text from sources where id = '@SRC1@') = 'true|true|true');
select pg_temp.check_('011 official needs a notification URL', pg_temp.rows_as('@C@', $$select public.set_exam_official('@EX1@')$$) = -1);
update ssc_exams set notification_url = 'https://example.test/notice' where id = '@EX1@';
select pg_temp.check_('011 official with URL and verified source works (call)', pg_temp.rows_as('@C@', $$select public.set_exam_official('@EX1@')$$) = 1);
select pg_temp.check_('011 official with URL and verified source works (effect)', (select is_official from ssc_exams where id = '@EX1@'));
select pg_temp.rows_as('@C@', $$select public.verify_source('@SRC1@', false)$$);
select pg_temp.check_('011 official is refused once the source is unverified', pg_temp.rows_as('@C@', $$select public.set_exam_official('@EX1@')$$) = -1);
select pg_temp.rows_as('@C@', $$select public.verify_source('@SRC1@', true)$$);
select pg_temp.check_('011 trust flag RPCs revoked from anon', pg_temp.rows_as(null, $$select public.verify_source('@SRC1@')$$) = -1);

-- ---------------- import ----------------
create temp table t_imp (k text primary key, v text);
create or replace function pg_temp.run_import(p_sha text, p_dry boolean, p_ncert jsonb, p_ssc jsonb, p_map jsonb, p_source jsonb default '{"name":"TEST import source"}') returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '@C@', 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', '@C@', true);
  set local role authenticated;
  v_id := public.import_create_run('t.json', p_sha, p_source, p_dry);
  if p_ncert is not null then perform public.import_stage_rows(v_id, 'ncert', p_ncert); end if;
  if p_ssc is not null then perform public.import_stage_rows(v_id, 'ssc', p_ssc); end if;
  if p_map is not null then perform public.import_stage_rows(v_id, 'mapping', p_map); end if;
  perform public.import_validate_run(v_id);
  reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return v_id;
end $$;
select pg_temp.check_('011 normal user cannot create an import run', pg_temp.rows_as('@A@', $$select public.import_create_run('x', repeat('a', 64), '{"name":"s"}', true)$$) = -1);
select pg_temp.check_('011 normal user cannot read import tables', pg_temp.rows_as('@A@', 'select 1 from import_runs') = 0 and pg_temp.rows_as('@A@', $$insert into import_runs (file_sha256) values (repeat('b', 64))$$) = -1);
select pg_temp.check_('011 source with trust flags rejected at creation', pg_temp.rows_as('@C@', $$select public.import_create_run('x', repeat('c', 64), '{"name":"s","is_verified":true}', true)$$) = -1);
select pg_temp.check_('011 bad sha rejected', pg_temp.rows_as('@C@', $$select public.import_create_run('x', 'nothex', '{"name":"s"}', true)$$) = -1);
select pg_temp.check_('011 missing source name rejected', pg_temp.rows_as('@C@', $$select public.import_create_run('x', repeat('d', 64), '{}', true)$$) = -1);

-- a valid file: one chapter + one topic + a mapping between the two NEW draft rows
insert into t_imp select 'good', pg_temp.run_import(repeat('1', 64), false,
  '[{"class":"6","subject":"IMP subject","book":"IMP book","chapter":"IMP chapter","chapter_number":"1","relevance":"high","concepts":"alpha|beta"}]',
  '[{"exam_version":"IMP2030","tier":"Tier I","subject":"IMP ssc subject","topic":"IMP topic","priority":"high","subtopic":"IMP sub"}]',
  '[{"class":"6","subject":"IMP subject","book":"IMP book","chapter":"IMP chapter","exam_version":"IMP2030","tier":"Tier I","ssc_subject":"IMP ssc subject","topic":"IMP topic","mapping_type":"foundation","reason":"because"}]');
select pg_temp.check_('011 valid file validates', (select status from import_runs where id = (select v::uuid from t_imp where k = 'good')) = 'validated');
select pg_temp.check_('011 validation wrote NOTHING to curriculum tables', (select count(*) from chapters where title = 'IMP chapter') = 0 and (select count(*) from ssc_topics where title = 'IMP topic') = 0);
select pg_temp.check_('011 normal user cannot apply', pg_temp.rows_as('@A@', format($f$select public.import_apply_run(%L)$f$, (select v from t_imp where k = 'good'))) = -1);
select pg_temp.check_('011 apply works for an admin', pg_temp.rows_as('@C@', format($f$select public.import_apply_run(%L)$f$, (select v from t_imp where k = 'good'))) = 1);
select pg_temp.check_('011 applied content exists', (select count(*) from chapters where title = 'IMP chapter') = 1 and (select count(*) from concepts where title in ('alpha','beta')) = 2 and (select count(*) from ssc_subtopics where title = 'IMP sub') = 1);
select pg_temp.check_('011 applied book and exam are DRAFT', (select status::text from books where title = 'IMP book') = 'draft' and (select status::text from ssc_exams where exam_version = 'IMP2030') = 'draft');
select pg_temp.check_('011 applied source is UNVERIFIED, exam is NOT official', not (select is_verified from sources where name = 'TEST import source') and not (select is_official from ssc_exams where exam_version = 'IMP2030'));
select pg_temp.check_('011 imported draft is invisible to normal users', pg_temp.rows_as('@A@', $$select 1 from chapters where title = 'IMP chapter'$$) = 0 and pg_temp.rows_as('@A@', $$select 1 from ssc_topics where title = 'IMP topic'$$) = 0);
select pg_temp.check_('011 imported mapping is invisible while its endpoints are drafts', pg_temp.rows_as('@A@', $$select 1 from ncert_ssc_mappings where reason = 'because'$$) = 0 and (select count(*) from ncert_ssc_mappings where reason = 'because') = 1);
select pg_temp.check_('011 applying the same run twice is rejected', pg_temp.rows_as('@C@', format($f$select public.import_apply_run(%L)$f$, (select v from t_imp where k = 'good'))) = -1);
select pg_temp.check_('011 the same file (same hash) cannot be imported again', pg_temp.rows_as('@C@', $$select public.import_create_run('t.json', repeat('1', 64), '{"name":"s"}', false)$$) = -1);

-- dry run cannot be applied
insert into t_imp select 'dry', pg_temp.run_import(repeat('2', 64), true, '[{"class":"7","subject":"IMP subject","book":"IMP book dry","chapter":"IMP dry chapter"}]', null, null);
select pg_temp.check_('011 dry run validates', (select status from import_runs where id = (select v::uuid from t_imp where k = 'dry')) = 'validated');
select pg_temp.check_('011 dry run cannot be applied (call)', pg_temp.rows_as('@C@', format($f$select public.import_apply_run(%L)$f$, (select v from t_imp where k = 'dry'))) = -1);
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
select pg_temp.check_('011 an invalid run cannot be applied and changes nothing (call)', pg_temp.rows_as('@C@', format($f$select public.import_apply_run(%L)$f$, (select v from t_imp where k = 'pub'))) = -1);
select pg_temp.check_('011 an invalid run cannot be applied and changes nothing (effect)', (select count(*) from chapters where title = 'TEST brand new chapter') = 0);
select pg_temp.check_('011 discard removes staged rows (call)', pg_temp.rows_as('@C@', format($f$select public.import_discard_run(%L)$f$, (select v from t_imp where k = 'pub'))) = 1);
select pg_temp.check_('011 discard removes staged rows (effect)', (select count(*) from import_rows where run_id = (select v::uuid from t_imp where k = 'pub')) = 0);
select pg_temp.check_('011 an applied run cannot be discarded', pg_temp.rows_as('@C@', format($f$select public.import_discard_run(%L)$f$, (select v from t_imp where k = 'good'))) = -1);
