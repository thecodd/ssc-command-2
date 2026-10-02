-- 013_revision_queue.sql — Phase 7. Safe to re-run. Requires 007-012. SQL NOT EXECUTED when written (no Postgres available).
-- Read-only. No table, policy or rule from 008 changes: this adds ONE SECURITY INVOKER function so the queue (grouping + ordering + the signals
-- shown on each card) is decided in SQL, next to daily_focus(), instead of in React. Grants are set by 014 (which must stay the LAST migration).
--
-- bucket:   overdue (due_date < today) | today (= today) | upcoming (> today)       -- the user's own local "today" (user_today)
-- ordering: bucket (overdue, today, upcoming) > OLDEST due first > weak > lower mastery > entity id.
--           "Oldest due first" is exactly how daily_focus() orders overdue/due revisions (most overdue first), so the first overdue/today row of this
--           queue is the same item daily_focus() puts first among revisions. Weak and mastery only break ties between equally old revisions.
-- Rows are the user's OPEN schedule rows (revision_schedule_one_open guarantees at most one per item) for live entities. Graduated history is read from revision_reviews.
create or replace function public.revision_queue()
returns table(schedule_id uuid, entity_type public.entity_t, entity_id uuid, title text, due_date date, step int, reason text,
              bucket text, days_overdue int, days_until int, mastery text, weak_reason text, confidence int, completion int, last_studied_at timestamptz,
              pyq_count int, pyq_attempts int, pyq_recent_accuracy numeric, reviews_done int, last_ratings text[], ladder int[], today date, rank int)
language sql stable security invoker set search_path = public
as $$
  with me as (select auth.uid() as uid, public.user_today(auth.uid()) as today, public._ladder(auth.uid()) as ladder),
  sig as (select * from public.user_entity_signals()),
  q as (
    select r.id as sid, r.entity_type as et, r.entity_id as eid, e.title as ttl, r.due_date as due, r.step as stp, r.reason as why,
           case when r.due_date < (select today from me) then 'overdue' when r.due_date = (select today from me) then 'today' else 'upcoming' end as bk,
           greatest((select today from me) - r.due_date, 0) as od, greatest(r.due_date - (select today from me), 0) as du,
           coalesce(s.mastery, 'not_started') as ms, s.weak_reason as wr, s.confidence as cf, s.completion as cp, s.last_studied_at as ls,
           coalesce(s.pyq_count, 0) as pc, coalesce(s.pyq_attempts, 0) as pa, s.pyq_recent_accuracy as acc, coalesce(s.reviews_done, 0) as rd,
           coalesce(s.last_ratings, '{}'::text[]) as lr
      from public.revision_schedule r
      join public.active_entities() e on e.entity_type = r.entity_type and e.entity_id = r.entity_id
      left join sig s on s.entity_type = r.entity_type and s.entity_id = r.entity_id
     where r.user_id = (select uid from me) and not r.done)
  select q.sid, q.et, q.eid, q.ttl, q.due, q.stp, q.why, q.bk, q.od, q.du, q.ms, q.wr, q.cf, q.cp, q.ls, q.pc, q.pa, q.acc, q.rd, q.lr,
         (select ladder from me), (select today from me),
         (row_number() over (order by case q.bk when 'overdue' then 0 when 'today' then 1 else 2 end, q.due, (q.ms = 'weak') desc,
            case q.ms when 'not_started' then 0 when 'weak' then 1 when 'needs_revision' then 2 when 'in_progress' then 3 when 'learning' then 4 when 'strong' then 5 else 6 end, q.eid))::int
    from q
   order by 23
$$;
