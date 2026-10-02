-- 007_progress_sessions.sql — Phase 4. Safe to re-run. Requires 005, 006.
--
-- WHAT THIS DOES
--   1. user_progress: completed_at; legacy status values normalised (no row deleted); the lifecycle is
--      not_started | learning | completed (the enum keeps 'strong'/'revision' but nothing writes them any more).
--      Clients get SELECT only. Every write goes through set_progress() or the study/revision/practice RPCs.
--   2. study_sessions: a server-side state machine (active | paused | completed | abandoned). All durations come from
--      the server clock (public.app_now()); no RPC accepts a number of seconds from the client.
--   3. One open session per user, enforced by a partial unique index.
--   4. Counters (seconds_spent, sessions, last_studied_at) and the streak are updated atomically in SQL.
--
-- LEGACY DATA (non-destructive)
--   * 'strong'  -> status 'completed', completion 100, confidence 5 if it was empty (the "strong" claim is kept as confidence).
--   * 'revision'-> 'completed' if completion was 100, otherwise 'learning'.
--   * learning with completion 100 -> completed; not_started with completion > 0 -> learning.
--   * Old sessions: ended_at set -> 'completed'; ended_at null -> 'abandoned' with ended_at = started_at and 0 credited seconds
--     (their time was never recorded, so nothing is invented).

------------------------------------------------------------------
-- 0. Small internal helpers (SECURITY DEFINER callers only)
------------------------------------------------------------------
create or replace function public._require_uid() returns uuid
language plpgsql stable set search_path = ''
as $$ declare v uuid := auth.uid(); begin if v is null then raise exception 'Not authenticated' using errcode = '28000'; end if; return v; end $$;

create or replace function public._user_tz(p_uid uuid) returns text
language sql stable set search_path = ''
as $$ select coalesce((select p.timezone from public.profiles p where p.id = p_uid), 'Asia/Kolkata') $$;

-- Advances the streak for one local calendar day. Idempotent and monotonic (an older day never lowers it).
create or replace function public._touch_streak(p_uid uuid, p_day date) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_last date; v_streak int;
begin
  select p.last_study_date, p.streak_count into v_last, v_streak from public.profiles p where p.id = p_uid for update;
  if not found then return; end if;
  if v_last is not null and p_day <= v_last then return; end if;
  update public.profiles
     set streak_count = case when v_last = p_day - 1 then coalesce(v_streak, 0) + 1 else 1 end, last_study_date = p_day
   where id = p_uid;
end $$;
drop function if exists public.touch_streak();   -- clients must not be able to bump their own streak

-- Can this user study/practise this entity right now? (exists, not archived, official or their own custom row.)
-- 011 redefines it to also require a published container.
create or replace function public.entity_accessible(p_type public.entity_t, p_id uuid, p_uid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case p_type
    when 'ncert_chapter' then exists (select 1 from public.chapters c where c.id = p_id and not coalesce(c.archived, false) and (c.owner_id is null or c.owner_id = p_uid))
    when 'ssc_topic'     then exists (select 1 from public.ssc_topics t where t.id = p_id and not coalesce(t.archived, false) and (t.owner_id is null or t.owner_id = p_uid))
    when 'ssc_subtopic'  then exists (select 1 from public.ssc_subtopics s join public.ssc_topics t on t.id = s.topic_id
                                      where s.id = p_id and not s.archived and not coalesce(t.archived, false) and (s.owner_id is null or s.owner_id = p_uid))
    else false end
$$;
revoke all on function public._touch_streak(uuid, date), public.entity_accessible(public.entity_t, uuid, uuid) from public, anon, authenticated;

------------------------------------------------------------------
-- 1. user_progress
------------------------------------------------------------------
alter table public.user_progress add column if not exists completed_at timestamptz;

-- Legacy normalisation (order matters; every statement is idempotent).
update public.user_progress set confidence = coalesce(confidence, 5) where status = 'strong';
update public.user_progress set status = 'completed', completion = 100 where status = 'strong';
update public.user_progress set status = case when completion >= 100 then 'completed'::public.status_t else 'learning'::public.status_t end where status = 'revision';
update public.user_progress set status = 'learning' where status = 'not_started' and completion > 0;
update public.user_progress set status = 'completed' where status = 'learning' and completion = 100;
update public.user_progress set completion = 100 where status = 'completed' and completion < 100;
update public.user_progress set completed_at = coalesce(completed_at, last_studied_at, public.app_now()) where status = 'completed' and completed_at is null;
update public.user_progress set completed_at = null where status <> 'completed' and completed_at is not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_progress_completion_status_chk') then
    alter table public.user_progress add constraint user_progress_completion_status_chk
      check ((status = 'completed') = (completion = 100) and (status <> 'not_started' or completion = 0));
  end if;
end $$;

-- Writes only through RPCs (definer). SELECT stays RLS-scoped to the owner.
drop policy if exists "own rows" on public.user_progress;
drop policy if exists user_progress_select_own on public.user_progress;
create policy user_progress_select_own on public.user_progress for select to authenticated using (user_id = auth.uid());
revoke all on public.user_progress from anon, authenticated;
grant select on public.user_progress to authenticated;

-- Learner input: lifecycle status, completion, confidence. Nothing else is settable.
--   * completion 100 <=> completed. Leaving 'completed' without an explicit completion caps it at 99. not_started => 0.
--   * completed_at = when the item last ENTERED 'completed' (cleared when it leaves). Staying completed keeps it.
--   * Completing already-completed items is a no-op here; revision seeding (008) triggers only on the transition.
create or replace function public.set_progress(
  p_type public.entity_t, p_id uuid, p_status text default null, p_completion int default null, p_confidence int default null
) returns public.user_progress
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid(); v_now timestamptz := public.app_now();
  cur public.user_progress; v_status public.status_t; v_completion int; res public.user_progress;
begin
  if p_type not in ('ncert_chapter','ssc_topic','ssc_subtopic') then raise exception 'Progress can only be tracked on chapters, topics and subtopics' using errcode = '22023'; end if;
  if not public.entity_accessible(p_type, p_id, v_uid) then raise exception 'Item not found' using errcode = 'P0002'; end if;
  if p_status is not null and p_status not in ('not_started','learning','completed') then raise exception 'Status must be not_started, learning or completed' using errcode = '22023'; end if;
  if p_completion is not null and p_completion not between 0 and 100 then raise exception 'Completion must be 0-100' using errcode = '22023'; end if;
  if p_confidence is not null and p_confidence not between 1 and 5 then raise exception 'Confidence must be 1-5' using errcode = '22023'; end if;

  select * into cur from public.user_progress where user_id = v_uid and entity_type = p_type and entity_id = p_id for update;
  if not found then cur.status := 'not_started'; cur.completion := 0; end if;

  if p_status is not null then v_status := p_status::public.status_t;
  elsif p_completion is not null then
    v_status := case when p_completion = 100 then 'completed'::public.status_t
                     when cur.status = 'completed' then 'learning'::public.status_t
                     when cur.status = 'not_started' and p_completion > 0 then 'learning'::public.status_t
                     else cur.status end;
  else v_status := cur.status; end if;

  v_completion := case v_status when 'completed' then 100 when 'not_started' then 0
                  else least(99, coalesce(p_completion, cur.completion, 0)) end;

  insert into public.user_progress (user_id, entity_type, entity_id, status, completion, confidence, completed_at)
  values (v_uid, p_type, p_id, v_status, v_completion, p_confidence, case when v_status = 'completed' then v_now end)
  on conflict (user_id, entity_type, entity_id) do update set
    status = excluded.status,
    completion = excluded.completion,
    confidence = coalesce(excluded.confidence, public.user_progress.confidence),
    completed_at = case when excluded.status = 'completed' then coalesce(public.user_progress.completed_at, excluded.completed_at) else null end
  returning * into res;
  return res;
end $$;

------------------------------------------------------------------
-- 2. study_sessions: server-side state machine
------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'session_state_t' and typnamespace = 'public'::regnamespace) then
    create type public.session_state_t as enum ('active','paused','completed','abandoned');
  end if;
end $$;

alter table public.study_sessions
  add column if not exists state public.session_state_t,
  add column if not exists active_since timestamptz,
  add column if not exists accumulated_seconds int not null default 0,
  add column if not exists last_heartbeat_at timestamptz;

-- Legacy backfill (only rows not yet migrated).
update public.study_sessions set state = case when ended_at is not null then 'completed'::public.session_state_t else 'abandoned'::public.session_state_t end,
       accumulated_seconds = seconds where state is null;
update public.study_sessions set ended_at = started_at where state = 'abandoned' and ended_at is null;
alter table public.study_sessions alter column state set default 'active';
alter table public.study_sessions alter column state set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'study_sessions_state_chk') then
    alter table public.study_sessions add constraint study_sessions_state_chk check (
      accumulated_seconds >= 0 and seconds >= 0 and (
        (state = 'active'  and active_since is not null and ended_at is null) or
        (state = 'paused'  and active_since is null     and ended_at is null) or
        (state in ('completed','abandoned') and active_since is null and ended_at is not null and ended_at >= started_at)));
  end if;
end $$;

-- ONE open session per user, enforced by the database (two tabs / duplicate start / races cannot create a second).
create unique index if not exists study_sessions_one_open on public.study_sessions (user_id) where state in ('active','paused');
create index if not exists study_sessions_entity_idx on public.study_sessions (user_id, entity_type, entity_id, started_at desc);

drop policy if exists "own rows" on public.study_sessions;
drop policy if exists study_sessions_select_own on public.study_sessions;
create policy study_sessions_select_own on public.study_sessions for select to authenticated using (user_id = auth.uid());
revoke all on public.study_sessions from anon, authenticated;
grant select on public.study_sessions to authenticated;

-- Seconds a still-running segment may be credited: up to the last heartbeat + grace, never beyond "now".
-- A tab that dies mid-session therefore stops earning time ~90 s after its last heartbeat (not lost, not inflated).
create or replace function public._segment_credit(s public.study_sessions, p_now timestamptz) returns int
language sql stable set search_path = ''
as $$
  select case when s.state <> 'active' or s.active_since is null then 0
    else greatest(0, floor(extract(epoch from
           (least(p_now, coalesce(s.last_heartbeat_at, s.active_since) + make_interval(secs => public.lc_stale_credit_seconds())) - s.active_since))))::int end
$$;

create or replace function public._session_json(s public.study_sessions, p_now timestamptz) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'entity_type', s.entity_type, 'entity_id', s.entity_id, 'state', s.state,
    'started_at', s.started_at, 'ended_at', s.ended_at, 'seconds', s.seconds,
    'elapsed_seconds', least(public.lc_max_session_seconds(), s.accumulated_seconds + public._segment_credit(s, p_now)),
    'server_now', p_now)
$$;

-- Close a session exactly once (idempotent) and apply its effects in ONE place:
-- counters on user_progress (single atomic upsert), streak for the local day(s) touched, and the matching focus task.
create or replace function public._close_session(p_id uuid, p_final public.session_state_t, p_now timestamptz) returns public.study_sessions
language plpgsql security definer set search_path = ''
as $$
declare
  s public.study_sessions; v_total int; v_end timestamptz; v_tz text; v_start_day date; v_end_day date;
begin
  select * into s from public.study_sessions where id = p_id for update;
  if not found then return null; end if;
  if s.state in ('completed','abandoned') then return s; end if;

  v_total := least(public.lc_max_session_seconds(), s.accumulated_seconds + public._segment_credit(s, p_now));
  v_end := case when p_final = 'completed' then p_now
                when s.state = 'active' then least(p_now, coalesce(s.last_heartbeat_at, s.active_since) + make_interval(secs => public.lc_stale_credit_seconds()))
                else coalesce(s.last_heartbeat_at, s.started_at) end;
  v_end := greatest(v_end, s.started_at);

  update public.study_sessions
     set state = p_final, seconds = v_total, accumulated_seconds = v_total, active_since = null, ended_at = v_end
   where id = s.id returning * into s;

  insert into public.user_progress (user_id, entity_type, entity_id, status, seconds_spent, sessions, last_studied_at)
  values (s.user_id, s.entity_type, s.entity_id, 'learning', v_total, case when v_total >= public.lc_min_session_seconds() then 1 else 0 end,
          case when v_total > 0 then s.ended_at end)
  on conflict (user_id, entity_type, entity_id) do update set
    seconds_spent   = public.user_progress.seconds_spent + excluded.seconds_spent,
    sessions        = public.user_progress.sessions + excluded.sessions,
    last_studied_at = greatest(public.user_progress.last_studied_at, excluded.last_studied_at),
    status          = case when public.user_progress.status = 'not_started' then 'learning'::public.status_t else public.user_progress.status end;

  if v_total >= public.lc_min_session_seconds() then
    v_tz := public._user_tz(s.user_id);
    v_start_day := (s.started_at at time zone v_tz)::date;
    v_end_day := (s.ended_at at time zone v_tz)::date;
    perform public._touch_streak(s.user_id, v_start_day);                               -- a session crossing local midnight
    if v_end_day > v_start_day then perform public._touch_streak(s.user_id, v_end_day); end if;   -- counts for both days
    update public.tasks set status = 'completed'
     where user_id = s.user_id and entity_type = s.entity_type and entity_id = s.entity_id and status <> 'completed' and due_date = v_end_day;
  end if;
  return s;
end $$;

-- Close any open session that has gone quiet. Active: no heartbeat for lc_stale_seconds. Paused: untouched for lc_max_session_seconds.
create or replace function public._recover_stale(p_uid uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in select id from public.study_sessions
            where user_id = p_uid
              and ((state = 'active' and coalesce(last_heartbeat_at, active_since) < p_now - make_interval(secs => public.lc_stale_seconds()))
                or (state = 'paused' and coalesce(last_heartbeat_at, started_at) < p_now - make_interval(secs => public.lc_max_session_seconds())))
            for update loop
    perform public._close_session(r.id, 'abandoned', p_now);
  end loop;
end $$;
revoke all on function public._segment_credit(public.study_sessions, timestamptz), public._session_json(public.study_sessions, timestamptz),
  public._close_session(uuid, public.session_state_t, timestamptz), public._recover_stale(uuid, timestamptz) from public, anon, authenticated;

-- start: idempotent per entity (refresh / second tab returns the SAME session); switching entity closes the old one.
create or replace function public.study_start(p_type public.entity_t, p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := public._require_uid(); v_now timestamptz := public.app_now(); s public.study_sessions;
begin
  if p_type not in ('ncert_chapter','ssc_topic','ssc_subtopic') then raise exception 'Unsupported item type' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('study:' || v_uid::text, 0));
  if not public.entity_accessible(p_type, p_id, v_uid) then raise exception 'Item not found' using errcode = 'P0002'; end if;
  perform public._recover_stale(v_uid, v_now);

  select * into s from public.study_sessions where user_id = v_uid and state in ('active','paused') for update;
  if found then
    if s.entity_type = p_type and s.entity_id = p_id then return public._session_json(s, v_now); end if;
    perform public._close_session(s.id, 'abandoned', v_now);   -- switched topics without finishing; time so far is credited
  end if;

  insert into public.study_sessions (user_id, entity_type, entity_id, state, started_at, active_since, last_heartbeat_at, accumulated_seconds, seconds)
  values (v_uid, p_type, p_id, 'active', v_now, v_now, v_now, 0, 0) returning * into s;
  insert into public.user_progress (user_id, entity_type, entity_id, status) values (v_uid, p_type, p_id, 'learning') on conflict do nothing;
  update public.user_progress set status = 'learning' where user_id = v_uid and entity_type = p_type and entity_id = p_id and status = 'not_started';
  return public._session_json(s, v_now);
end $$;

create or replace function public.study_pause(p_session uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := public._require_uid(); v_now timestamptz := public.app_now(); s public.study_sessions;
begin
  perform pg_advisory_xact_lock(hashtextextended('study:' || v_uid::text, 0));
  perform public._recover_stale(v_uid, v_now);
  select * into s from public.study_sessions where id = p_session and user_id = v_uid for update;
  if not found then raise exception 'Session not found' using errcode = 'P0002'; end if;
  if s.state in ('completed','abandoned') then raise exception 'Session already ended' using errcode = '55000'; end if;
  if s.state = 'active' then
    update public.study_sessions
       set accumulated_seconds = least(public.lc_max_session_seconds(), s.accumulated_seconds + public._segment_credit(s, v_now)),
           active_since = null, state = 'paused', last_heartbeat_at = v_now
     where id = s.id returning * into s;
  end if;
  return public._session_json(s, v_now);
end $$;

create or replace function public.study_resume(p_session uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := public._require_uid(); v_now timestamptz := public.app_now(); s public.study_sessions;
begin
  perform pg_advisory_xact_lock(hashtextextended('study:' || v_uid::text, 0));
  perform public._recover_stale(v_uid, v_now);
  select * into s from public.study_sessions where id = p_session and user_id = v_uid for update;
  if not found then raise exception 'Session not found' using errcode = 'P0002'; end if;
  if s.state in ('completed','abandoned') then raise exception 'Session already ended' using errcode = '55000'; end if;
  if s.state = 'paused' then
    update public.study_sessions set state = 'active', active_since = v_now, last_heartbeat_at = v_now where id = s.id returning * into s;
  end if;
  return public._session_json(s, v_now);
end $$;

-- heartbeat never raises for an ended session: it reports the state so the client can stop its timer.
create or replace function public.study_heartbeat(p_session uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := public._require_uid(); v_now timestamptz := public.app_now(); s public.study_sessions;
begin
  perform pg_advisory_xact_lock(hashtextextended('study:' || v_uid::text, 0));
  perform public._recover_stale(v_uid, v_now);
  select * into s from public.study_sessions where id = p_session and user_id = v_uid for update;
  if not found then raise exception 'Session not found' using errcode = 'P0002'; end if;
  if s.state in ('active','paused') then
    update public.study_sessions set last_heartbeat_at = greatest(coalesce(last_heartbeat_at, v_now), v_now) where id = s.id returning * into s;
  end if;
  return public._session_json(s, v_now);
end $$;

-- finish: idempotent. A second call (double tap, second tab, or after recovery) returns the closed session without re-counting.
create or replace function public.study_finish(p_session uuid, p_confidence int default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := public._require_uid(); v_now timestamptz := public.app_now(); s public.study_sessions;
begin
  if p_confidence is not null and p_confidence not between 1 and 5 then raise exception 'Confidence must be 1-5' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('study:' || v_uid::text, 0));
  select * into s from public.study_sessions where id = p_session and user_id = v_uid for update;
  if not found then raise exception 'Session not found' using errcode = 'P0002'; end if;
  if s.state in ('active','paused') then
    s := public._close_session(s.id, 'completed', v_now);
    if p_confidence is not null then
      update public.user_progress set confidence = p_confidence where user_id = v_uid and entity_type = s.entity_type and entity_id = s.entity_id;
    end if;
  end if;
  return public._session_json(s, v_now);
end $$;

-- recover: call when the Study page loads. Sweeps this user's stale session and returns the open one (or null).
create or replace function public.study_recover() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := public._require_uid(); v_now timestamptz := public.app_now(); s public.study_sessions;
begin
  perform pg_advisory_xact_lock(hashtextextended('study:' || v_uid::text, 0));
  perform public._recover_stale(v_uid, v_now);
  select * into s from public.study_sessions where user_id = v_uid and state in ('active','paused');
  if not found then return null; end if;
  return public._session_json(s, v_now);
end $$;

-- Optional cron job (service role only): closes stale sessions for everyone.
create or replace function public.study_sweep_stale() returns int
language plpgsql security definer set search_path = ''
as $$
declare r record; n int := 0; v_now timestamptz := public.app_now();
begin
  for r in select distinct user_id from public.study_sessions
            where (state = 'active' and coalesce(last_heartbeat_at, active_since) < v_now - make_interval(secs => public.lc_stale_seconds()))
               or (state = 'paused' and coalesce(last_heartbeat_at, started_at) < v_now - make_interval(secs => public.lc_max_session_seconds())) loop
    perform public._recover_stale(r.user_id, v_now); n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.set_progress(public.entity_t, uuid, text, int, int), public.study_start(public.entity_t, uuid), public.study_pause(uuid),
  public.study_resume(uuid), public.study_heartbeat(uuid), public.study_finish(uuid, int), public.study_recover(), public.study_sweep_stale() from public, anon;
grant execute on function public.set_progress(public.entity_t, uuid, text, int, int), public.study_start(public.entity_t, uuid), public.study_pause(uuid),
  public.study_resume(uuid), public.study_heartbeat(uuid), public.study_finish(uuid, int), public.study_recover() to authenticated;
grant execute on function public.study_sweep_stale() to service_role;
