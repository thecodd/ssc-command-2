-- 012_practice_security_search.sql — Phase 6A. Safe to re-run. Requires 001-011. SQL NOT EXECUTED when written (no Postgres available).
--
-- 1. ANSWER KEY: authenticated clients can no longer SELECT pyqs.correct_answer / explanation / content_hash. The key is only ever returned by
--    submit_pyq_answer() / practice_question() AFTER the caller has an attempt for that question in their own session. Grading stays in SQL.
-- 2. practice_question(): the ONLY way a client reads a practice question (question + options; answer fields stay null until answered).
-- 3. practice_options(): what a scope can offer (count, difficulties, papers) so the UI can show only real filters.
-- 4. start_practice() gains two OPTIONAL filters (difficulty, paper). Session identity = scope + filters. finish_practice() also reports totals.
-- 5. global_search(): archived / non-published content is not searchable by normal users (admins still see it).
-- Function EXECUTE grants for everything are set in 014 (it must run last). Run migrations IN ORDER: re-running 009 after 012 would restore the old 3-argument start_practice.

------------------------------------------------------------------
-- 0. has_valid_key: lets counts ignore questions that cannot be practised WITHOUT exposing the key
------------------------------------------------------------------
-- Clients can no longer read correct_answer, so an INVOKER count function cannot test the key itself. 009's CHECK constraint is NOT VALID (legacy rows
-- may have no key), so "linked" and "practisable" can differ. This maintained flag says only WHETHER a valid key exists, never what it is.
alter table public.pyqs add column if not exists has_valid_key boolean not null default false;
create or replace function public.pyqs_set_hash() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.content_hash := md5(lower(regexp_replace(btrim(new.question), '\s+', ' ', 'g')) || '|' || coalesce(new.options::text, ''));
  new.has_valid_key := coalesce(public.pyq_answer_valid(new.options, new.correct_answer), false);
  return new;
end $$;
drop trigger if exists pyqs_set_hash on public.pyqs;
-- fires on EVERY update (not only on the key columns) so has_valid_key can never be forced by a client that owns a custom question
create trigger pyqs_set_hash before insert or update on public.pyqs for each row execute function public.pyqs_set_hash();
update public.pyqs set question = question;       -- backfill: fires the trigger for existing rows

------------------------------------------------------------------
-- 1. Answer key column privileges
------------------------------------------------------------------
-- Table-level SELECT is replaced by a column list. INSERT/UPDATE/DELETE grants are untouched (custom-PYQ owners can still WRITE a key;
-- they just cannot read it back through the API). RLS (read_official_or_own) still applies on top.
revoke select on public.pyqs from authenticated;
grant select (id, exam, year, tier, subject, question, options, difficulty, source, owner_id, created_at,
              paper_id, source_ref, difficulty_level, archived, has_valid_key) on public.pyqs to authenticated;
revoke all on public.pyqs from anon;


-- Counts shown in Study Mode / topic pages must match what Practice can actually serve: not archived and with a valid key (flag from section 0).
create or replace function public.topic_pyq_stats(p_topic uuid)
returns table(pyq_count int, attempts int, correct int)
language sql stable security invoker set search_path = public
as $$
  select (select count(*) from pyq_topics pt join pyqs y on y.id = pt.pyq_id where pt.ssc_topic_id = p_topic and not y.archived and y.has_valid_key)::int,
         (select count(*) from pyq_attempts a join pyq_topics pt on pt.pyq_id = a.pyq_id join pyqs y on y.id = a.pyq_id
           where pt.ssc_topic_id = p_topic and a.user_id = auth.uid() and not y.archived and y.has_valid_key)::int,
         (select count(*) from pyq_attempts a join pyq_topics pt on pt.pyq_id = a.pyq_id join pyqs y on y.id = a.pyq_id
           where pt.ssc_topic_id = p_topic and a.user_id = auth.uid() and a.is_correct and not y.archived and y.has_valid_key)::int
$$;
create or replace function public.subject_pyq_counts(p_subject uuid)
returns table(ssc_topic_id uuid, n int)
language sql stable security invoker set search_path = public
as $$
  select pt.ssc_topic_id, count(*)::int from pyq_topics pt join ssc_topics t on t.id = pt.ssc_topic_id join pyqs y on y.id = pt.pyq_id
   where t.subject_id = p_subject and not y.archived and y.has_valid_key group by pt.ssc_topic_id
$$;
create or replace function public.topic_pyqs(p_topic uuid, lim int default 5)
returns table(id uuid, exam text, year int, question text, difficulty public.difficulty_t)
language sql stable security invoker set search_path = public
as $$
  select y.id, coalesce(pp.exam, y.exam), coalesce(pp.year, y.year), y.question, y.difficulty_level
    from pyq_topics pt join pyqs y on y.id = pt.pyq_id left join exam_papers pp on pp.id = y.paper_id
   where pt.ssc_topic_id = p_topic and not y.archived and y.has_valid_key
   order by coalesce(pp.year, y.year) desc nulls last, y.id limit lim
$$;

------------------------------------------------------------------
-- 2. practice session filters (optional)
------------------------------------------------------------------
alter table public.practice_sessions
  add column if not exists difficulty public.difficulty_t,
  add column if not exists paper_id uuid references public.exam_papers (id) on delete set null;

drop function if exists public._practice_candidates(uuid, text, uuid, int);
create or replace function public._practice_candidates(p_uid uuid, p_scope text, p_scope_id uuid, p_limit int,
                                                       p_difficulty public.difficulty_t default null, p_paper uuid default null)
returns table(pyq_id uuid, pos int)
language plpgsql stable security definer set search_path = ''
as $$
begin
  return query
  with scope_pyqs as (
    select pt.pyq_id as id from public.pyq_topics pt where p_scope = 'ssc_topic' and pt.ssc_topic_id = p_scope_id
    union select ps.pyq_id from public.pyq_subtopics ps where p_scope = 'ssc_subtopic' and ps.ssc_subtopic_id = p_scope_id
    union select pt.pyq_id from public.pyq_topics pt join public.ssc_topics t on t.id = pt.ssc_topic_id where p_scope = 'ssc_subject' and t.subject_id = p_scope_id
    union select pt.pyq_id from public.pyq_topics pt where p_scope = 'weak'
            and pt.ssc_topic_id in (select s.entity_id from public.user_entity_signals('ssc_topic', null) s where s.mastery = 'weak')
    union select y.id from public.pyqs y where p_scope = 'mixed'
  ),
  ranked as (
    select y.id,
           case when la.last_at is null then 0 when la.last_correct = false then 1 else 2 end as rk, la.last_at, coalesce(pp.year, y.year) as yr
      from scope_pyqs s
      join public.pyqs y on y.id = s.id
      left join public.exam_papers pp on pp.id = y.paper_id
      left join lateral (select a.created_at as last_at, a.is_correct as last_correct from public.pyq_attempts a
                          where a.user_id = p_uid and a.pyq_id = y.id order by a.created_at desc limit 1) la on true
     where not y.archived and (y.owner_id is null or y.owner_id = p_uid) and public.pyq_answer_valid(y.options, y.correct_answer)
       and (p_difficulty is null or y.difficulty_level = p_difficulty)
       and (p_paper is null or y.paper_id = p_paper))
  select r.id, (row_number() over (order by r.rk, r.last_at asc nulls first, r.yr desc nulls last, r.id))::int from ranked r
   order by 2 limit p_limit;
end $$;

-- Scope check shared by start_practice and practice_options (internal; takes a uid, so it is NOT executable by clients).
create or replace function public._practice_check_scope(p_uid uuid, p_scope text, p_scope_id uuid) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_scope not in ('ssc_topic','ssc_subtopic','ssc_subject','weak','mixed') then raise exception 'Unknown practice scope' using errcode = '22023'; end if;
  if (p_scope in ('weak','mixed')) <> (p_scope_id is null) then raise exception 'scope_id is required for topic/subtopic/subject scopes and must be empty for weak/mixed' using errcode = '22023'; end if;
  if p_scope in ('ssc_topic','ssc_subtopic') and not public.entity_accessible(p_scope::public.entity_t, p_scope_id, p_uid) then raise exception 'Item not found' using errcode = 'P0002'; end if;
  if p_scope = 'ssc_subject' and not exists (select 1 from public.ssc_subjects x where x.id = p_scope_id and not coalesce(x.archived, false) and public.is_ssc_subject_visible(x.id)) then raise exception 'Item not found' using errcode = 'P0002'; end if;
end $$;

drop function if exists public.start_practice(text, uuid, int);
create or replace function public.start_practice(p_scope text, p_scope_id uuid default null, p_count int default 10,
                                                 p_difficulty public.difficulty_t default null, p_paper uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := public._require_uid(); v_now timestamptz := public.app_now(); s public.practice_sessions; v_ids uuid[];
begin
  perform public._practice_check_scope(v_uid, p_scope, p_scope_id);
  if p_paper is not null and not exists (select 1 from public.exam_papers x where x.id = p_paper) then raise exception 'Paper not found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('practice:' || v_uid::text, 0));
  p_count := least(greatest(coalesce(p_count, 10), 1), 50);

  select * into s from public.practice_sessions where user_id = v_uid and state = 'active' for update;
  if found then
    -- refresh / second tab with the same configuration: same session, same order
    if s.scope_type = p_scope and s.scope_id is not distinct from p_scope_id and s.difficulty is not distinct from p_difficulty and s.paper_id is not distinct from p_paper then
      return public._practice_json(s);
    end if;
    update public.practice_sessions set state = 'abandoned', ended_at = v_now where id = s.id;
  end if;

  select array_agg(c.pyq_id order by c.pos) into v_ids from public._practice_candidates(v_uid, p_scope, p_scope_id, p_count, p_difficulty, p_paper) c;
  if v_ids is null then raise exception 'No practice questions are available for this scope' using errcode = 'P0002'; end if;

  insert into public.practice_sessions (user_id, scope_type, scope_id, pyq_ids, started_at, difficulty, paper_id)
  values (v_uid, p_scope, p_scope_id, v_ids, v_now, p_difficulty, p_paper) returning * into s;
  if p_scope = 'ssc_topic' then perform public._ensure_topic_progress(v_uid, p_scope_id, v_now); end if;
  return public._practice_json(s);
end $$;

-- What can this scope offer? Counts only questions that are actually practisable (not archived, valid key, visible to the caller).
create or replace function public.practice_options(p_scope text, p_scope_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := public._require_uid(); v_out jsonb;
begin
  perform public._practice_check_scope(v_uid, p_scope, p_scope_id);
  with c as materialized (select cc.pyq_id from public._practice_candidates(v_uid, p_scope, p_scope_id, 1000) cc)
  select jsonb_build_object(
    'total', (select count(*)::int from c),
    'by_difficulty', (select coalesce(jsonb_object_agg(d, n), '{}'::jsonb)
                        from (select y.difficulty_level::text d, count(*)::int n from c join public.pyqs y on y.id = c.pyq_id where y.difficulty_level is not null group by 1) x),
    'papers', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'exam', p.exam, 'year', p.year, 'tier', p.tier, 'shift', p.shift, 'n', x.n) order by p.year desc, p.exam, p.id), '[]'::jsonb)
                 from (select y.paper_id pid, count(*)::int n from c join public.pyqs y on y.id = c.pyq_id where y.paper_id is not null group by 1) x
                 join public.exam_papers p on p.id = x.pid))
    into v_out;
  return v_out;
end $$;

------------------------------------------------------------------
-- 3. The ONLY way a client reads a practice question
------------------------------------------------------------------
create or replace function public.practice_question(p_session uuid, p_pyq uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := public._require_uid(); s public.practice_sessions; y public.pyqs; a public.pyq_attempts; pp public.exam_papers; v_pos int; v_topics jsonb; v_found jsonb;
begin
  select * into s from public.practice_sessions where id = p_session and user_id = v_uid;               -- another user's session looks like "not found"
  if not found then raise exception 'Practice session not found' using errcode = 'P0002'; end if;
  v_pos := array_position(s.pyq_ids, p_pyq);
  if v_pos is null then raise exception 'That question is not part of this session' using errcode = '22023'; end if;
  select * into y from public.pyqs where id = p_pyq and (owner_id is null or owner_id = v_uid);
  if not found then raise exception 'Question not found' using errcode = 'P0002'; end if;
  select * into a from public.pyq_attempts where session_id = s.id and pyq_id = p_pyq;
  select * into pp from public.exam_papers where id = y.paper_id;

  -- Everything that could hint at the answer (mapped topic, concept, key, explanation) is only returned once the caller has answered.
  if a.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title) order by t.title), '[]'::jsonb) into v_topics
      from public.pyq_topics pt join public.ssc_topics t on t.id = pt.ssc_topic_id where pt.pyq_id = y.id and public.is_topic_visible(t.id) and not coalesce(t.archived, false);
    select jsonb_build_object('id', c.id, 'title', c.title, 'topic_id', m.ssc_topic_id) into v_found
      from public.pyq_topics pt join public.ncert_ssc_mappings m on m.ssc_topic_id = pt.ssc_topic_id join public.chapters c on c.id = m.ncert_chapter_id
     where pt.pyq_id = y.id and not coalesce(c.archived, false) and public.is_chapter_visible(c.id)
     order by m.recommended desc, case m.mapping_type::text when 'foundation' then 0 when 'direct' then 1 else 2 end, c.title limit 1;
  end if;

  return jsonb_build_object(
    'pyq_id', y.id, 'position', v_pos, 'total', cardinality(s.pyq_ids), 'session_state', s.state,
    'question', y.question, 'options', y.options, 'source_ref', y.source_ref, 'difficulty', y.difficulty_level,
    'exam', coalesce(pp.exam, y.exam), 'year', coalesce(pp.year, y.year), 'tier', coalesce(pp.tier, y.tier), 'shift', pp.shift,
    'answer', case when a.id is null then null else jsonb_build_object('selected', a.selected_answer, 'is_correct', a.is_correct,
              'correct_answer', y.correct_answer, 'explanation', y.explanation, 'time_taken_seconds', a.time_taken_seconds) end,
    'topics', v_topics, 'foundation', v_found);
end $$;

------------------------------------------------------------------
-- 4. finish_practice: same contract as before + totals the UI must not compute itself
------------------------------------------------------------------
create or replace function public.finish_practice(p_session uuid, p_abandon boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid(); v_now timestamptz := public.app_now(); s public.practice_sessions;
  v_att int; v_ok int; v_avg numeric; v_sum numeric; v_weak jsonb := '[]'::jsonb; r record; g record;
begin
  select * into s from public.practice_sessions where id = p_session and user_id = v_uid for update;
  if not found then raise exception 'Practice session not found' using errcode = 'P0002'; end if;
  if s.state = 'active' then
    update public.practice_sessions set state = case when p_abandon then 'abandoned' else 'completed' end, ended_at = v_now where id = s.id returning * into s;
  end if;
  select count(*), count(*) filter (where is_correct), avg(time_taken_seconds), sum(time_taken_seconds) into v_att, v_ok, v_avg, v_sum from public.pyq_attempts where session_id = s.id;

  if s.state = 'completed' then
    for r in select distinct pt.ssc_topic_id as topic_id from public.pyq_attempts a join public.pyq_topics pt on pt.pyq_id = a.pyq_id where a.session_id = s.id loop
      select * into g from public.user_entity_signals('ssc_topic', r.topic_id);
      if found and g.mastery = 'weak' then
        perform public._open_weakness_revision(v_uid, 'ssc_topic', r.topic_id);
        v_weak := v_weak || jsonb_build_array(jsonb_build_object('topic_id', r.topic_id, 'title', g.title, 'weak_reason', g.weak_reason, 'recent_accuracy', g.pyq_recent_accuracy));
      end if;
    end loop;
  end if;
  return jsonb_build_object('session_id', s.id, 'state', s.state, 'scope_type', s.scope_type, 'scope_id', s.scope_id,
    'planned', cardinality(s.pyq_ids), 'attempted', v_att, 'correct', v_ok, 'incorrect', v_att - v_ok, 'skipped', cardinality(s.pyq_ids) - v_att,
    'accuracy', case when v_att > 0 then round(100.0 * v_ok / v_att) end,
    'total_seconds', coalesce(v_sum, 0)::int, 'avg_seconds', case when v_avg is not null then round(v_avg) end, 'weak_topics', v_weak);
end $$;

------------------------------------------------------------------
-- 5. global_search v3: archived / unpublished content is invisible to normal users; admins still see everything
------------------------------------------------------------------
-- Why chapters leaked: only chapters.archived was checked, but archiving a BOOK sets books.status = 'archived' (011) and leaves its chapters
-- unflagged. Same for SSC exams -> subjects/topics/subtopics, and for concepts, subtopics and PYQs which were never filtered.
drop function if exists public.global_search(text, int);
create function public.global_search(q text, lim int default 5)
returns table(kind text, id uuid, title text, subtitle text, href text)
language sql stable security invoker set search_path = public, extensions
as $$
  with e as (select replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') as s),
  p as (select trim(q) as raw, lower(trim(q)) as qq, '%' || s || '%' as pat, s || '%' as pre, '% ' || s || '%' as wpre, public.is_admin() as adm from e)
  (select 'book'::text, b.id, b.title, ('Class ' || cl.grade || ' · ' || s.name)::text, ('/ncert/' || cl.grade)::text
     from books b join subjects s on s.id = b.subject_id join classes cl on cl.id = s.class_id, p
     where (p.adm or (coalesce(b.archived, false) = false and b.status = 'published')) and b.title ilike p.pat
     order by search_rank(b.title, p.qq, p.pre, p.wpre), similarity(b.title, p.raw) desc, b.title limit lim)
  union all
  (select 'chapter'::text, c.id, c.title, ('Class ' || cl.grade || ' · ' || s.name)::text, ('/ncert/chapter/' || c.id)::text
     from chapters c join books b on b.id = c.book_id join subjects s on s.id = b.subject_id join classes cl on cl.id = s.class_id, p
     where (p.adm or (coalesce(c.archived, false) = false and coalesce(b.archived, false) = false and b.status = 'published')) and c.title ilike p.pat
     order by search_rank(c.title, p.qq, p.pre, p.wpre), similarity(c.title, p.raw) desc, c.title limit lim)
  union all
  (select 'concept'::text, k.id, k.title, c.title::text, ('/ncert/chapter/' || c.id || '?tab=concepts')::text
     from concepts k join chapters c on c.id = k.chapter_id join books b on b.id = c.book_id, p
     where (p.adm or (not k.archived and coalesce(c.archived, false) = false and coalesce(b.archived, false) = false and b.status = 'published')) and k.title ilike p.pat
     order by search_rank(k.title, p.qq, p.pre, p.wpre), similarity(k.title, p.raw) desc, k.title limit lim)
  union all
  (select 'ssc_subject'::text, s.id, s.name, tr.name::text, ('/ssc/subject/' || s.id)::text
     from ssc_subjects s join ssc_tiers tr on tr.id = s.tier_id join ssc_exams x on x.id = tr.exam_id, p
     where (p.adm or (coalesce(s.archived, false) = false and x.status = 'published')) and s.name ilike p.pat
     order by search_rank(s.name, p.qq, p.pre, p.wpre), s.name limit lim)
  union all
  (select 'ssc_topic'::text, t.id, t.title, s.name::text, ('/ssc/topic/' || t.id)::text
     from ssc_topics t join ssc_subjects s on s.id = t.subject_id join ssc_tiers tr on tr.id = s.tier_id join ssc_exams x on x.id = tr.exam_id, p
     where (p.adm or (coalesce(t.archived, false) = false and coalesce(s.archived, false) = false and x.status = 'published')) and t.title ilike p.pat
     order by search_rank(t.title, p.qq, p.pre, p.wpre), similarity(t.title, p.raw) desc, t.title limit lim)
  union all
  (select 'ssc_subtopic'::text, st.id, st.title, t.title::text, ('/ssc/topic/' || t.id)::text
     from ssc_subtopics st join ssc_topics t on t.id = st.topic_id join ssc_subjects s on s.id = t.subject_id join ssc_tiers tr on tr.id = s.tier_id join ssc_exams x on x.id = tr.exam_id, p
     where (p.adm or (not st.archived and coalesce(t.archived, false) = false and coalesce(s.archived, false) = false and x.status = 'published')) and st.title ilike p.pat
     order by search_rank(st.title, p.qq, p.pre, p.wpre), similarity(st.title, p.raw) desc, st.title limit lim)
  union all
  (select 'note'::text, n.id, coalesce(nullif(n.title, ''), 'Untitled note')::text, left(coalesce(n.content, ''), 80)::text,
          (case n.entity_type when 'ncert_chapter' then '/ncert/chapter/' || n.entity_id || '?tab=notes' when 'ssc_topic' then '/ssc/topic/' || n.entity_id else '/notes' end)::text
     from notes n, p where n.title ilike p.pat or n.content ilike p.pat
     order by search_rank(n.title, p.qq, p.pre, p.wpre), n.updated_at desc limit lim)
  union all
  (select 'pyq'::text, y.id, left(y.question, 90)::text, (coalesce(pp.exam, y.exam, '') || ' ' || coalesce(coalesce(pp.year, y.year)::text, ''))::text, '/pyqs'::text
     from pyqs y left join exam_papers pp on pp.id = y.paper_id, p
     where (p.adm or not y.archived) and y.question ilike p.pat
     order by search_rank(y.question, p.qq, p.pre, p.wpre), coalesce(pp.year, y.year) desc nulls last limit lim)
  union all
  (select 'resource'::text, r.id, r.title, coalesce(r.type::text, '')::text,
          (case r.entity_type when 'ncert_chapter' then '/ncert/chapter/' || r.entity_id || '?tab=resources' when 'ssc_topic' then '/ssc/topic/' || r.entity_id else '/resources' end)::text
     from resources r, p where r.title ilike p.pat or r.description ilike p.pat
     order by search_rank(r.title, p.qq, p.pre, p.wpre), r.title limit lim)
  union all
  (select 'task'::text, k.id, k.title, coalesce(k.status::text, '')::text, '/tasks'::text
     from tasks k, p where k.title ilike p.pat or k.description ilike p.pat
     order by search_rank(k.title, p.qq, p.pre, p.wpre), k.due_date nulls last limit lim);
$$;
