-- 008_revision_engine.sql — Phase 4. Safe to re-run. Requires 005-007.
--
-- MODEL
--   revision_schedule = CURRENT state: at most ONE open (done = false) row per user+entity, carrying `step` on the user's ladder.
--   revision_reviews  = append-only HISTORY of every review (rating, step before/after, interval, graduation).
--   The ladder is profiles.revision_intervals (default 1,3,7,15,30). Changing it affects future scheduling only; reviews are never rewritten.
--
-- RULES (single implementation: revision_next(); the Node oracle in database/tests/reference must agree)
--   easy  -> step + 2     good -> step + 1     hard -> step - 1 (min 0) and the next gap is the SHORTEST interval.
--   Moving past the last step graduates the item (row done = true, no open row).  Next due is anchored on the review date.
--   Completing an already-completed item never reschedules (seeding only fires on the transition INTO completed and never
--   when an open row exists).
--
-- LEGACY DATA (non-destructive)
--   Phase 1 pre-created five pending rows per item. Extra pending rows are COPIED to revision_schedule_legacy and then
--   removed; the earliest one is kept as the open row (step = its position on the ladder). Finished legacy rows that carry a rating are
--   copied into revision_reviews (source = 'legacy') and stay in revision_schedule as done rows.

------------------------------------------------------------------
-- 0. Ladder validation moved into the profile guard (one place; mirrors lib/learning validateLadder)
------------------------------------------------------------------
create or replace function public.profiles_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare i int; n int;
begin
  if auth.uid() is not null then
    if tg_op = 'UPDATE' and new.is_admin is distinct from old.is_admin then
      raise exception 'is_admin cannot be changed through the API' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and new.is_admin then
      raise exception 'is_admin cannot be set through the API' using errcode = '42501';
    end if;
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
  end if;
  n := coalesce(cardinality(new.revision_intervals), 0);
  if n < 1 or n > public.lc_max_intervals() then raise exception 'Use 1 to % revision intervals', public.lc_max_intervals() using errcode = '22023'; end if;
  for i in 1..n loop
    if new.revision_intervals[i] is null or new.revision_intervals[i] < 1 or new.revision_intervals[i] > public.lc_max_interval_days() then
      raise exception 'Revision intervals must be whole days between 1 and %', public.lc_max_interval_days() using errcode = '22023';
    end if;
    if i > 1 and new.revision_intervals[i] <= new.revision_intervals[i - 1] then raise exception 'Revision intervals must increase' using errcode = '22023'; end if;
  end loop;
  return new;
end $$;

------------------------------------------------------------------
-- 1. revision_schedule: step + reason; collapse legacy rows
------------------------------------------------------------------
alter table public.revision_schedule
  add column if not exists step int not null default 0,
  add column if not exists reason text,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.revision_schedule_legacy (
  id bigserial primary key, row_data jsonb not null, archived_at timestamptz not null default now()
);
alter table public.revision_schedule_legacy enable row level security;   -- no policies: not readable through the API
revoke all on public.revision_schedule_legacy from anon, authenticated;

do $$
declare v_moved int;
begin
  -- keep the earliest pending row per (user, entity); archive the rest, then delete them
  with ranked as (
    select r.*, row_number() over (partition by user_id, entity_type, entity_id order by due_date, id) as rn
      from public.revision_schedule r where not r.done),
  moved as (
    delete from public.revision_schedule r using ranked k
     where r.id = k.id and k.rn > 1
    returning to_jsonb(r) as j)
  insert into public.revision_schedule_legacy (row_data) select j from moved;
  get diagnostics v_moved = row_count;
  raise notice '008: archived % surplus legacy pending revision rows', v_moved;
end $$;

update public.revision_schedule r
   set step = greatest(coalesce(array_position(coalesce(nullif(p.revision_intervals, '{}'::int[]), public.lc_default_ladder()), r.interval_days), 1) - 1, 0),
       reason = coalesce(r.reason, 'completion')
  from public.profiles p
 where p.id = r.user_id and not r.done and r.reason is null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'revision_schedule_reason_chk') then
    alter table public.revision_schedule add constraint revision_schedule_reason_chk check (reason is null or reason in ('completion','manual','weakness'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'revision_schedule_step_chk') then
    alter table public.revision_schedule add constraint revision_schedule_step_chk check (step >= 0);
  end if;
end $$;

create unique index if not exists revision_schedule_one_open on public.revision_schedule (user_id, entity_type, entity_id) where not done;

drop policy if exists "own rows" on public.revision_schedule;
drop policy if exists revision_schedule_select_own on public.revision_schedule;
create policy revision_schedule_select_own on public.revision_schedule for select to authenticated using (user_id = auth.uid());
revoke all on public.revision_schedule from anon, authenticated;
grant select on public.revision_schedule to authenticated;

------------------------------------------------------------------
-- 2. revision_reviews: append-only history
------------------------------------------------------------------
create table if not exists public.revision_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  entity_type public.entity_t not null,
  entity_id uuid not null,
  schedule_id uuid references public.revision_schedule (id) on delete set null,
  due_date date not null,                          -- what it was scheduled for
  reviewed_at timestamptz not null default public.app_now(),
  reviewed_on date not null,                       -- LOCAL date at review time (frozen: later timezone changes don't rewrite history)
  rating text not null check (rating in ('easy','good','hard')),
  step_before int check (step_before >= 0),
  step_after int check (step_after >= 0),
  interval_days_after int check (interval_days_after >= 1),
  graduated boolean not null default false,
  confidence int check (confidence between 1 and 5),
  source text not null default 'app' check (source in ('app','legacy')),
  constraint revision_reviews_entity_type_chk check (entity_type in ('ncert_chapter','ssc_topic','ssc_subtopic')),
  constraint revision_reviews_entity_fk foreign key (entity_type, entity_id) references public.entities (type, id) on delete cascade
);
create index if not exists revision_reviews_entity_idx on public.revision_reviews (user_id, entity_type, entity_id, reviewed_at desc);
create index if not exists revision_reviews_day_idx on public.revision_reviews (user_id, reviewed_on);
alter table public.revision_reviews enable row level security;
drop policy if exists revision_reviews_select_own on public.revision_reviews;
create policy revision_reviews_select_own on public.revision_reviews for select to authenticated using (user_id = auth.uid());
revoke all on public.revision_reviews from anon, authenticated;
grant select on public.revision_reviews to authenticated;

-- Append-only: UPDATE is never allowed; DELETE is allowed only as a cascade from a parent (user/entity deletion),
-- detected by trigger depth (>1 means "fired by an FK cascade", not by a direct statement).
create or replace function public.revision_reviews_append_only() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then raise exception 'revision_reviews is append-only' using errcode = '55000'; end if;
  if pg_trigger_depth() <= 1 then raise exception 'revision_reviews is append-only' using errcode = '55000'; end if;
  return old;
end $$;
drop trigger if exists revision_reviews_append_only on public.revision_reviews;
create trigger revision_reviews_append_only before update or delete on public.revision_reviews for each row execute function public.revision_reviews_append_only();

-- Legacy finished rows with a rating -> history (idempotent)
insert into public.revision_reviews (user_id, entity_type, entity_id, schedule_id, due_date, reviewed_at, reviewed_on, rating, source)
select r.user_id, r.entity_type, r.entity_id, r.id, r.due_date, coalesce(r.done_at, r.created_at),
       (coalesce(r.done_at, r.created_at) at time zone public._user_tz(r.user_id))::date, r.rating, 'legacy'
  from public.revision_schedule r
 where r.done and r.rating is not null
   and not exists (select 1 from public.revision_reviews v where v.schedule_id = r.id and v.source = 'legacy');

------------------------------------------------------------------
-- 3. Pure scheduling function (the only implementation of the ladder rule)
------------------------------------------------------------------
create or replace function public.revision_next(p_step int, p_rating text, p_ladder int[], p_today date)
returns table(step int, graduated boolean, interval_days int, due_date date)
language sql immutable set search_path = ''
as $$
  with c as (select cardinality(p_ladder) as n, greatest(least(p_step, cardinality(p_ladder) - 1), 0) as at),
  t as (select n, case p_rating when 'easy' then at + public.lc_step_easy() when 'good' then at + public.lc_step_good() when 'hard' then greatest(at - 1, 0) end as tgt from c)
  select case when tgt > n - 1 then n else tgt end,
         tgt > n - 1,
         case when tgt > n - 1 then null when p_rating = 'hard' then p_ladder[1] else p_ladder[tgt + 1] end,
         case when tgt > n - 1 then null else p_today + (case when p_rating = 'hard' then p_ladder[1] else p_ladder[tgt + 1] end) end
    from t
$$;

create or replace function public._ladder(p_uid uuid) returns int[]
language sql stable set search_path = ''
as $$ select coalesce((select nullif(p.revision_intervals, '{}'::int[]) from public.profiles p where p.id = p_uid), public.lc_default_ladder()) $$;

-- Create the open revision unless one already exists (idempotent: never resets an existing ladder).
create or replace function public._seed_revision(p_uid uuid, p_type public.entity_t, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_ladder int[] := public._ladder(p_uid); v_today date := public.user_today(p_uid);
begin
  insert into public.revision_schedule (user_id, entity_type, entity_id, due_date, interval_days, step, reason, done)
  values (p_uid, p_type, p_id, v_today + v_ladder[1], v_ladder[1], 0, p_reason, false)
  on conflict (user_id, entity_type, entity_id) where not done do nothing;
end $$;

-- Study/complete -> schedule revision, on the TRANSITION into completed, whatever write path caused it.
create or replace function public.progress_seed_revision() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    perform public._seed_revision(new.user_id, new.entity_type, new.entity_id, 'completion');
  end if;
  return null;
end $$;
drop trigger if exists progress_seed_revision on public.user_progress;
create trigger progress_seed_revision after insert or update of status on public.user_progress for each row execute function public.progress_seed_revision();

-- Backfill: completed items that have no revision rows at all get their first revision.
select public._seed_revision(p.user_id, p.entity_type, p.entity_id, 'completion')
  from public.user_progress p
 where p.status = 'completed'
   and not exists (select 1 from public.revision_schedule r where r.user_id = p.user_id and r.entity_type = p.entity_type and r.entity_id = p.entity_id);

-- Practice found a weakness: make sure a revision is due today (pull an open one forward; create one if none).
create or replace function public._open_weakness_revision(p_uid uuid, p_type public.entity_t, p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_today date := public.user_today(p_uid);
begin
  update public.revision_schedule set due_date = v_today, reason = 'weakness'
   where user_id = p_uid and entity_type = p_type and entity_id = p_id and not done and due_date > v_today;
  insert into public.revision_schedule (user_id, entity_type, entity_id, due_date, interval_days, step, reason, done)
  values (p_uid, p_type, p_id, v_today, (public._ladder(p_uid))[1], 0, 'weakness', false)
  on conflict (user_id, entity_type, entity_id) where not done do nothing;
end $$;

------------------------------------------------------------------
-- 4. Client RPCs
------------------------------------------------------------------
-- "Revise this now": needs an existing progress row (you can't revise what you never started).
create or replace function public.schedule_revision(p_type public.entity_t, p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := public._require_uid(); v_today date := public.user_today(v_uid); s public.revision_schedule;
begin
  if p_type not in ('ncert_chapter','ssc_topic','ssc_subtopic') then raise exception 'Unsupported item type' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rev:' || v_uid::text, 0));
  if not exists (select 1 from public.user_progress where user_id = v_uid and entity_type = p_type and entity_id = p_id and status <> 'not_started') then
    raise exception 'Start studying this item before scheduling a revision' using errcode = '55000';
  end if;
  update public.revision_schedule set due_date = least(due_date, v_today), reason = 'manual'
   where user_id = v_uid and entity_type = p_type and entity_id = p_id and not done returning * into s;
  if not found then
    insert into public.revision_schedule (user_id, entity_type, entity_id, due_date, interval_days, step, reason, done)
    values (v_uid, p_type, p_id, v_today, (public._ladder(v_uid))[1], 0, 'manual', false) returning * into s;
  end if;
  return jsonb_build_object('schedule_id', s.id, 'step', s.step, 'due_date', s.due_date, 'reason', s.reason);
end $$;

-- review: ladder rule, history row, schedule update, progress counters, confidence and streak in ONE transaction.
-- p_expected_step is optimistic concurrency: a double tap / second tab sends the step it saw, and the second call is rejected.
create or replace function public.review_revision(p_schedule uuid, p_rating text, p_expected_step int, p_confidence int default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid(); v_now timestamptz := public.app_now(); v_today date := public.user_today(v_uid);
  s public.revision_schedule; n record; v_ladder int[]; v_review uuid;
begin
  if p_rating is null or p_rating not in ('easy','good','hard') then raise exception 'Rating must be easy, good or hard' using errcode = '22023'; end if;
  if p_confidence is not null and p_confidence not between 1 and 5 then raise exception 'Confidence must be 1-5' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rev:' || v_uid::text, 0));
  select * into s from public.revision_schedule where id = p_schedule and user_id = v_uid for update;
  if not found then raise exception 'Revision not found' using errcode = 'P0002'; end if;
  if s.done then raise exception 'This revision is already complete' using errcode = '55000'; end if;
  if s.step is distinct from p_expected_step then raise exception 'This revision changed. Refresh and try again' using errcode = '40001'; end if;

  v_ladder := public._ladder(v_uid);
  select * into n from public.revision_next(s.step, p_rating, v_ladder, v_today);

  insert into public.revision_reviews (user_id, entity_type, entity_id, schedule_id, due_date, reviewed_at, reviewed_on, rating, step_before, step_after, interval_days_after, graduated, confidence)
  values (v_uid, s.entity_type, s.entity_id, s.id, s.due_date, v_now, v_today, p_rating, s.step, n.step, n.interval_days, n.graduated, p_confidence)
  returning id into v_review;

  update public.revision_schedule
     set step = n.step, due_date = coalesce(n.due_date, s.due_date), interval_days = coalesce(n.interval_days, s.interval_days),
         done = n.graduated, done_at = case when n.graduated then v_now end, rating = p_rating
   where id = s.id returning * into s;

  insert into public.user_progress (user_id, entity_type, entity_id, status, completion, confidence, revision_count, last_studied_at, completed_at)
  values (v_uid, s.entity_type, s.entity_id, 'completed', 100, p_confidence, 1, v_now, v_now)
  on conflict (user_id, entity_type, entity_id) do update set
    revision_count  = public.user_progress.revision_count + 1,
    last_studied_at = v_now,
    confidence      = coalesce(excluded.confidence, public.user_progress.confidence);

  perform public._touch_streak(v_uid, v_today);
  return jsonb_build_object('review_id', v_review, 'schedule_id', s.id, 'rating', p_rating, 'step', s.step, 'graduated', s.done,
                            'due_date', case when s.done then null else s.due_date end, 'interval_days', n.interval_days);
end $$;

revoke all on function public._seed_revision(uuid, public.entity_t, uuid, text), public._open_weakness_revision(uuid, public.entity_t, uuid),
  public.progress_seed_revision(), public._ladder(uuid) from public, anon, authenticated;
revoke all on function public.schedule_revision(public.entity_t, uuid), public.review_revision(uuid, text, int, int) from public, anon;
grant execute on function public.schedule_revision(public.entity_t, uuid), public.review_revision(uuid, text, int, int) to authenticated;
grant execute on function public.revision_next(int, text, int[], date) to authenticated;
