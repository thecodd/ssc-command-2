-- 009_pyq_practice.sql — Phase 4. Safe to re-run. Requires 005-008. (finish_practice also needs 010 at RUN time.)
--
-- DISTINCTION THAT MUST NOT BLUR
--   ssc_exams   = a SYLLABUS VERSION (what is examined: "SSC CGL 2026" -> tiers -> subjects -> topics).
--   exam_papers = a HISTORICAL PAPER   (a question paper that was actually sat: exam + year + tier + shift).
--   A PYQ belongs to an exam paper, and is mapped (many-to-many) to syllabus topics/subtopics.
--
-- LEGACY (kept, nothing dropped): pyqs.exam / year / tier / subject / source / difficulty stay as nullable legacy columns.
--   New code reads paper_id -> exam_papers and difficulty_level. Existing rows with a year are linked to a paper by backfill.
--   Drop the legacy columns only after production data has been verified (a later cleanup migration).
--
-- ATTEMPT INTEGRITY
--   pyq_attempts is written ONLY by submit_pyq_answer(): the client sends selected answer + time; the SERVER derives
--   is_correct from the authoritative key. is_correct is a historical snapshot (later key corrections don't rewrite it).
--   Question order is a snapshot (practice_sessions.pyq_ids): refresh resumes the same order. (session_id, pyq_id) is unique.
--   Known limitation: the answer key column is readable by signed-in clients (a user could peek); this cannot forge accuracy.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'difficulty_t' and typnamespace = 'public'::regnamespace) then
    create type public.difficulty_t as enum ('easy','medium','hard');
  end if;
end $$;

------------------------------------------------------------------
-- 1. exam_papers
------------------------------------------------------------------
create table if not exists public.exam_papers (
  id uuid primary key default gen_random_uuid(),
  exam text not null check (btrim(exam) <> ''),              -- e.g. 'SSC CGL' (the examination, not a syllabus version)
  year int not null check (year between 1990 and 2100),
  tier text,
  shift text,
  exam_date date,
  source_id uuid references public.sources (id),
  source_url text,
  created_at timestamptz not null default now()
);
comment on table public.exam_papers is 'Historical question papers. NOT the same as ssc_exams (syllabus versions).';
create unique index if not exists exam_papers_natural_key on public.exam_papers (exam, year, (coalesce(tier, '')), (coalesce(shift, '')), (coalesce(exam_date, date '1900-01-01')));
create index if not exists exam_papers_source_idx on public.exam_papers (source_id) where source_id is not null;
alter table public.exam_papers enable row level security;
drop policy if exists exam_papers_read on public.exam_papers;
drop policy if exists exam_papers_admin on public.exam_papers;
create policy exam_papers_read  on public.exam_papers for select to authenticated using (true);
create policy exam_papers_admin on public.exam_papers for all    to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.exam_papers from anon;
drop trigger if exists forbid_official_delete on public.exam_papers;
create trigger forbid_official_delete before delete on public.exam_papers for each row execute function public.forbid_official_delete();

------------------------------------------------------------------
-- 2. pyqs
------------------------------------------------------------------
alter table public.pyqs
  add column if not exists paper_id uuid references public.exam_papers (id) on delete restrict,
  add column if not exists source_ref text,                  -- e.g. question number inside the paper
  add column if not exists content_hash text,
  add column if not exists difficulty_level public.difficulty_t,
  add column if not exists archived boolean not null default false;

update public.pyqs set difficulty_level = case difficulty::text
    when 'low' then 'easy'::public.difficulty_t when 'medium' then 'medium'::public.difficulty_t
    when 'high' then 'hard'::public.difficulty_t when 'very_high' then 'hard'::public.difficulty_t end
 where difficulty_level is null and difficulty is not null;

-- Papers for legacy rows (only rows that carry a year; owner-less = official).
insert into public.exam_papers (exam, year, tier)
select distinct coalesce(nullif(btrim(exam), ''), 'Unknown'), year, nullif(btrim(tier), '')
  from public.pyqs where owner_id is null and paper_id is null and year is not null and year between 1990 and 2100
on conflict do nothing;
update public.pyqs y set paper_id = p.id
  from public.exam_papers p
 where y.paper_id is null and y.owner_id is null and y.year = p.year
   and coalesce(nullif(btrim(y.exam), ''), 'Unknown') = p.exam and coalesce(nullif(btrim(y.tier), ''), '') = coalesce(p.tier, '')
   and p.shift is null and p.exam_date is null;

create or replace function public.pyq_answer_valid(p_options jsonb, p_correct text) returns boolean
language sql immutable set search_path = ''
as $$ select p_options is not null and p_correct is not null and jsonb_typeof(p_options) = 'object' and p_options ? p_correct $$;

-- options is {"A": "...", "B": "..."}; correct_answer is one of its keys. NOT VALID: new/changed rows are checked, legacy rows are not rejected.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pyqs_answer_key_chk') then
    alter table public.pyqs add constraint pyqs_answer_key_chk
      check (correct_answer is null or options is null or public.pyq_answer_valid(options, correct_answer)) not valid;
  end if;
end $$;

create or replace function public.pyqs_set_hash() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.content_hash := md5(lower(regexp_replace(btrim(new.question), '\s+', ' ', 'g')) || '|' || coalesce(new.options::text, ''));
  return new;
end $$;
drop trigger if exists pyqs_set_hash on public.pyqs;
create trigger pyqs_set_hash before insert or update of question, options on public.pyqs for each row execute function public.pyqs_set_hash();
update public.pyqs set question = question where content_hash is null;      -- fires the trigger for legacy rows

do $$
declare n bigint;
begin
  select count(*) into n from (select 1 from public.pyqs where owner_id is null and paper_id is not null group by paper_id, content_hash having count(*) > 1) d;
  if n > 0 then raise exception 'Migration 009 blocked: % duplicate question group(s) inside the same paper. Merge or archive them, then re-run.', n; end if;
  select count(*) into n from (select 1 from public.pyqs where owner_id is not null group by owner_id, content_hash having count(*) > 1) d;
  if n > 0 then raise exception 'Migration 009 blocked: % duplicate custom question group(s) for one owner. Merge them, then re-run.', n; end if;
end $$;

-- Same question may appear in different papers (repeat questions); never twice inside one paper.
create unique index if not exists pyqs_paper_hash_key  on public.pyqs (paper_id, content_hash) where owner_id is null and paper_id is not null;
create unique index if not exists pyqs_custom_hash_key on public.pyqs (owner_id, content_hash) where owner_id is not null;
create index if not exists pyqs_paper_idx on public.pyqs (paper_id) where paper_id is not null;
create index if not exists pyqs_year_idx  on public.pyqs (year desc) where year is not null;

------------------------------------------------------------------
-- 3. pyq_subtopics: PYQ -> topic -> subtopic, enforced by composite FKs
------------------------------------------------------------------
-- Needed as the target of the composite FK below (id alone is already unique; this adds the pair).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ssc_subtopics_topic_id_id_key') then
    alter table public.ssc_subtopics add constraint ssc_subtopics_topic_id_id_key unique (topic_id, id);
  end if;
end $$;

create table if not exists public.pyq_subtopics (
  pyq_id uuid not null,
  ssc_topic_id uuid not null,
  ssc_subtopic_id uuid not null,
  primary key (pyq_id, ssc_subtopic_id),
  -- a subtopic link cannot exist without the PYQ's link to that subtopic's TOPIC ...
  constraint pyq_subtopics_topic_fk foreign key (pyq_id, ssc_topic_id) references public.pyq_topics (pyq_id, ssc_topic_id) on delete cascade,
  -- ... and the subtopic must actually belong to that topic.
  constraint pyq_subtopics_subtopic_fk foreign key (ssc_topic_id, ssc_subtopic_id) references public.ssc_subtopics (topic_id, id) on delete cascade
);
create index if not exists pyq_subtopics_subtopic_idx on public.pyq_subtopics (ssc_subtopic_id, pyq_id);
alter table public.pyq_subtopics enable row level security;
drop policy if exists pyq_subtopics_read on public.pyq_subtopics;
drop policy if exists pyq_subtopics_admin on public.pyq_subtopics;
drop policy if exists pyq_subtopics_own_insert on public.pyq_subtopics;
drop policy if exists pyq_subtopics_own_delete on public.pyq_subtopics;
create policy pyq_subtopics_read  on public.pyq_subtopics for select to authenticated using (exists (select 1 from public.pyqs p where p.id = pyq_id));
create policy pyq_subtopics_admin on public.pyq_subtopics for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pyq_subtopics_own_insert on public.pyq_subtopics for insert to authenticated with check (exists (select 1 from public.pyqs p where p.id = pyq_id and p.owner_id = auth.uid()));
create policy pyq_subtopics_own_delete on public.pyq_subtopics for delete to authenticated using (exists (select 1 from public.pyqs p where p.id = pyq_id and p.owner_id = auth.uid()));
revoke all on public.pyq_subtopics from anon;

------------------------------------------------------------------
-- 4. practice_sessions + pyq_attempts
------------------------------------------------------------------
create table if not exists public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  scope_type text not null check (scope_type in ('ssc_topic','ssc_subtopic','ssc_subject','weak','mixed')),
  scope_id uuid,
  pyq_ids uuid[] not null check (cardinality(pyq_ids) between 1 and 200),   -- ordered SNAPSHOT: refresh resumes the same order
  state text not null default 'active' check (state in ('active','completed','abandoned')),
  started_at timestamptz not null default public.app_now(),
  ended_at timestamptz,
  constraint practice_sessions_scope_chk check ((scope_type in ('weak','mixed')) = (scope_id is null)),
  constraint practice_sessions_end_chk check ((state = 'active') = (ended_at is null))
);
create unique index if not exists practice_sessions_one_active on public.practice_sessions (user_id) where state = 'active';
create index if not exists practice_sessions_user_idx on public.practice_sessions (user_id, started_at desc);
alter table public.practice_sessions enable row level security;
drop policy if exists practice_sessions_select_own on public.practice_sessions;
create policy practice_sessions_select_own on public.practice_sessions for select to authenticated using (user_id = auth.uid());
revoke all on public.practice_sessions from anon, authenticated;
grant select on public.practice_sessions to authenticated;

alter table public.pyq_attempts
  add column if not exists selected_answer text,                 -- null only on legacy rows
  add column if not exists time_taken_seconds int check (time_taken_seconds between 0 and 7200),
  add column if not exists session_id uuid references public.practice_sessions (id) on delete set null;
create unique index if not exists pyq_attempts_session_pyq_key on public.pyq_attempts (session_id, pyq_id) where session_id is not null;
create index if not exists pyq_attempts_session_idx on public.pyq_attempts (session_id) where session_id is not null;

drop policy if exists "own rows" on public.pyq_attempts;
drop policy if exists pyq_attempts_select_own on public.pyq_attempts;
create policy pyq_attempts_select_own on public.pyq_attempts for select to authenticated using (user_id = auth.uid());
revoke all on public.pyq_attempts from anon, authenticated;
grant select on public.pyq_attempts to authenticated;       -- no INSERT/UPDATE/DELETE: only submit_pyq_answer() writes

------------------------------------------------------------------
-- 5. RPCs
------------------------------------------------------------------
-- Make sure the user has a progress row on a topic they practise (counts as started; touches last_studied_at).
create or replace function public._ensure_topic_progress(p_uid uuid, p_topic uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.entity_accessible('ssc_topic', p_topic, p_uid) then return; end if;
  insert into public.user_progress (user_id, entity_type, entity_id, status, last_studied_at) values (p_uid, 'ssc_topic', p_topic, 'learning', p_now)
  on conflict (user_id, entity_type, entity_id) do update set
    last_studied_at = greatest(public.user_progress.last_studied_at, excluded.last_studied_at),
    status = case when public.user_progress.status = 'not_started' then 'learning'::public.status_t else public.user_progress.status end;
end $$;

-- Candidate questions for a scope, in a DETERMINISTIC order:
-- never attempted first, then last-attempt wrong, then last-attempt correct; oldest attempt first; newer papers first; id.
create or replace function public._practice_candidates(p_uid uuid, p_scope text, p_scope_id uuid, p_limit int)
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
     where not y.archived and (y.owner_id is null or y.owner_id = p_uid) and public.pyq_answer_valid(y.options, y.correct_answer))
  select r.id, (row_number() over (order by r.rk, r.last_at asc nulls first, r.yr desc nulls last, r.id))::int from ranked r
   order by 2 limit p_limit;
end $$;

create or replace function public._practice_json(s public.practice_sessions) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object('id', s.id, 'scope_type', s.scope_type, 'scope_id', s.scope_id, 'state', s.state,
    'pyq_ids', to_jsonb(s.pyq_ids), 'total', cardinality(s.pyq_ids), 'started_at', s.started_at, 'ended_at', s.ended_at,
    'answered', coalesce((select jsonb_agg(jsonb_build_object('pyq_id', a.pyq_id, 'selected', a.selected_answer, 'is_correct', a.is_correct,
                                   'time_taken_seconds', a.time_taken_seconds) order by a.created_at, a.id)
                           from public.pyq_attempts a where a.session_id = s.id), '[]'::jsonb))
$$;

create or replace function public.start_practice(p_scope text, p_scope_id uuid default null, p_count int default 10) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := public._require_uid(); v_now timestamptz := public.app_now(); s public.practice_sessions; v_ids uuid[];
begin
  if p_scope not in ('ssc_topic','ssc_subtopic','ssc_subject','weak','mixed') then raise exception 'Unknown practice scope' using errcode = '22023'; end if;
  if (p_scope in ('weak','mixed')) <> (p_scope_id is null) then raise exception 'scope_id is required for topic/subtopic/subject scopes and must be empty for weak/mixed' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('practice:' || v_uid::text, 0));
  p_count := least(greatest(coalesce(p_count, 10), 1), 50);

  select * into s from public.practice_sessions where user_id = v_uid and state = 'active' for update;
  if found then
    if s.scope_type = p_scope and s.scope_id is not distinct from p_scope_id then return public._practice_json(s); end if;   -- refresh/second tab: same session, same order
    update public.practice_sessions set state = 'abandoned', ended_at = v_now where id = s.id;
  end if;

  if p_scope in ('ssc_topic','ssc_subtopic') and not public.entity_accessible(p_scope::public.entity_t, p_scope_id, v_uid) then raise exception 'Item not found' using errcode = 'P0002'; end if;
  if p_scope = 'ssc_subject' and not exists (select 1 from public.ssc_subjects x where x.id = p_scope_id and not coalesce(x.archived, false)) then raise exception 'Item not found' using errcode = 'P0002'; end if;

  select array_agg(c.pyq_id order by c.pos) into v_ids from public._practice_candidates(v_uid, p_scope, p_scope_id, p_count) c;
  if v_ids is null then raise exception 'No practice questions are available for this scope' using errcode = 'P0002'; end if;

  insert into public.practice_sessions (user_id, scope_type, scope_id, pyq_ids, started_at) values (v_uid, p_scope, p_scope_id, v_ids, v_now) returning * into s;
  if p_scope = 'ssc_topic' then perform public._ensure_topic_progress(v_uid, p_scope_id, v_now); end if;
  return public._practice_json(s);
end $$;

create or replace function public.practice_state(p_session uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := public._require_uid(); s public.practice_sessions;
begin
  select * into s from public.practice_sessions where id = p_session and user_id = v_uid;
  if not found then raise exception 'Practice session not found' using errcode = 'P0002'; end if;
  return public._practice_json(s);
end $$;

-- The client sends: session, question, selected option key, time taken. The SERVER decides correctness.
create or replace function public.submit_pyq_answer(p_session uuid, p_pyq uuid, p_selected text, p_time_seconds int default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid(); v_now timestamptz := public.app_now(); s public.practice_sessions; y public.pyqs;
  a public.pyq_attempts; v_dup boolean := false; v_time int; v_answered int; r record;
begin
  select * into s from public.practice_sessions where id = p_session and user_id = v_uid for update;   -- another user's session looks like "not found"
  if not found then raise exception 'Practice session not found' using errcode = 'P0002'; end if;
  if s.state <> 'active' then raise exception 'Practice session has ended' using errcode = '55000'; end if;
  if not (p_pyq = any (s.pyq_ids)) then raise exception 'That question is not part of this session' using errcode = '22023'; end if;   -- tampered ids

  select * into a from public.pyq_attempts where session_id = s.id and pyq_id = p_pyq;
  if found then v_dup := true;                                  -- duplicate submission: return the ORIGINAL result, change nothing
  else
    select * into y from public.pyqs where id = p_pyq and (owner_id is null or owner_id = v_uid);
    if not found or not public.pyq_answer_valid(y.options, y.correct_answer) then raise exception 'This question has no valid answer key' using errcode = '22023'; end if;
    if p_selected is null or not (y.options ? p_selected) then raise exception 'Choose one of the listed options' using errcode = '22023'; end if;
    v_time := least(greatest(coalesce(p_time_seconds, 0), 0), 7200, floor(extract(epoch from (v_now - s.started_at)))::int + 5);   -- informational only
    insert into public.pyq_attempts (user_id, pyq_id, session_id, selected_answer, is_correct, time_taken_seconds, created_at)
    values (v_uid, p_pyq, s.id, p_selected, p_selected = y.correct_answer, v_time, v_now)
    on conflict (session_id, pyq_id) where session_id is not null do nothing returning * into a;
    if not found then
      select * into a from public.pyq_attempts where session_id = s.id and pyq_id = p_pyq; v_dup := true;
    else
      for r in select pt.ssc_topic_id from public.pyq_topics pt where pt.pyq_id = p_pyq loop perform public._ensure_topic_progress(v_uid, r.ssc_topic_id, v_now); end loop;
      perform public._touch_streak(v_uid, public.user_today(v_uid));
    end if;
  end if;

  select * into y from public.pyqs where id = p_pyq;
  select count(*) into v_answered from public.pyq_attempts where session_id = s.id;
  return jsonb_build_object('is_correct', a.is_correct, 'selected', a.selected_answer, 'correct_answer', y.correct_answer, 'explanation', y.explanation,
                            'duplicate', v_dup, 'answered', v_answered, 'total', cardinality(s.pyq_ids));
end $$;

-- finish: idempotent summary. Detects weak topics (rules live in 010) and opens a revision for each.
create or replace function public.finish_practice(p_session uuid, p_abandon boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid(); v_now timestamptz := public.app_now(); s public.practice_sessions;
  v_att int; v_ok int; v_avg numeric; v_weak jsonb := '[]'::jsonb; r record; g record;
begin
  select * into s from public.practice_sessions where id = p_session and user_id = v_uid for update;
  if not found then raise exception 'Practice session not found' using errcode = 'P0002'; end if;
  if s.state = 'active' then
    update public.practice_sessions set state = case when p_abandon then 'abandoned' else 'completed' end, ended_at = v_now where id = s.id returning * into s;
  end if;
  select count(*), count(*) filter (where is_correct), avg(time_taken_seconds) into v_att, v_ok, v_avg from public.pyq_attempts where session_id = s.id;

  if s.state = 'completed' then
    for r in select distinct pt.ssc_topic_id as topic_id from public.pyq_attempts a join public.pyq_topics pt on pt.pyq_id = a.pyq_id where a.session_id = s.id loop
      select * into g from public.user_entity_signals('ssc_topic', r.topic_id);
      if found and g.mastery = 'weak' then
        perform public._open_weakness_revision(v_uid, 'ssc_topic', r.topic_id);
        v_weak := v_weak || jsonb_build_array(jsonb_build_object('topic_id', r.topic_id, 'title', g.title, 'weak_reason', g.weak_reason, 'recent_accuracy', g.pyq_recent_accuracy));
      end if;
    end loop;
  end if;
  return jsonb_build_object('session_id', s.id, 'state', s.state, 'planned', cardinality(s.pyq_ids), 'attempted', v_att, 'correct', v_ok,
    'skipped', cardinality(s.pyq_ids) - v_att, 'accuracy', case when v_att > 0 then round(100.0 * v_ok / v_att) end,
    'avg_seconds', case when v_avg is not null then round(v_avg) end, 'weak_topics', v_weak);
end $$;

drop function if exists public.topic_pyqs(uuid, int);
create function public.topic_pyqs(p_topic uuid, lim int default 5)
returns table(id uuid, exam text, year int, question text, difficulty public.difficulty_t)
language sql stable security invoker set search_path = public
as $$
  select y.id, coalesce(pp.exam, y.exam), coalesce(pp.year, y.year), y.question, y.difficulty_level
    from pyq_topics pt join pyqs y on y.id = pt.pyq_id left join exam_papers pp on pp.id = y.paper_id
   where pt.ssc_topic_id = p_topic and not y.archived
   order by coalesce(pp.year, y.year) desc nulls last, y.id limit lim
$$;

revoke all on function public._ensure_topic_progress(uuid, uuid, timestamptz), public._practice_candidates(uuid, text, uuid, int), public._practice_json(public.practice_sessions) from public, anon, authenticated;
revoke all on function public.start_practice(text, uuid, int), public.practice_state(uuid), public.submit_pyq_answer(uuid, uuid, text, int), public.finish_practice(uuid, boolean), public.topic_pyqs(uuid, int) from public, anon;
grant execute on function public.start_practice(text, uuid, int), public.practice_state(uuid), public.submit_pyq_answer(uuid, uuid, text, int), public.finish_practice(uuid, boolean), public.topic_pyqs(uuid, int) to authenticated;
