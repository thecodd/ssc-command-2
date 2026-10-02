-- 010_learning_signals.sql — Phase 4. Safe to re-run. Requires 005-009.
--
-- ONE definition of every learning concept, in SQL, so no screen can invent its own:
--   learning_weak_reason()  weak?   (5+ attempts and recent accuracy < 50%  OR  two consecutive Hard reviews  OR  low confidence with no usable accuracy)
--   learning_mastery()      not_started > weak > needs_revision > in_progress > mastered > strong > learning   (first match wins)
--   user_entity_signals()   the raw signals + derived mastery for the caller's tracked entities
--   daily_focus()           picked > overdue revision > due revision > weak > continue > start next (deduped, capped at 5)
--   dashboard_summary()     live, non-archived, SSC-relevant denominators; percentages cannot exceed 100
-- Mastery is DERIVED on every call. Nothing stores a mastery score. Thresholds are the lc_* functions from 005, mirrored in
-- lib/learning/config.ts (a Node test compares them). Reference vectors: database/tests/reference/learning_oracle.js.
-- All functions are SECURITY INVOKER: RLS applies and each caller only ever sees their own progress.

grant execute on function public._user_tz(uuid) to authenticated;     -- returns the caller's own zone (profiles RLS)

create or replace function public.priority_rank(p public.priority_t) returns int
language sql immutable set search_path = ''
as $$ select case p when 'very_high' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end $$;

create or replace function public.learning_weak_reason(p_attempts int, p_recent_acc numeric, p_confidence int, p_ratings text[]) returns text
language sql immutable set search_path = ''
as $$
  select case
    when coalesce(p_attempts, 0) >= public.lc_min_attempts() and p_recent_acc is not null and p_recent_acc < public.lc_weak_accuracy() then 'low_accuracy'
    when coalesce(cardinality(p_ratings), 0) >= public.lc_hard_streak()
         and (select bool_and(x = 'hard') from unnest(p_ratings[1:public.lc_hard_streak()]) as x) then 'hard_streak'
    when p_confidence is not null and p_confidence <= public.lc_weak_confidence()
         and not (coalesce(p_attempts, 0) >= public.lc_min_attempts() and p_recent_acc is not null) then 'low_confidence'
  end
$$;

create or replace function public.learning_mastery(
  p_status text, p_completion int, p_confidence int, p_sessions int, p_attempts int, p_recent_acc numeric,
  p_revision_due date, p_today date, p_ratings text[], p_reviews_done int, p_ladder_complete boolean
) returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_done boolean := p_status in ('completed', 'strong');          -- legacy 'strong' counts as completed
  v_acc numeric := case when coalesce(p_attempts, 0) >= public.lc_min_attempts() then p_recent_acc end;   -- unknown below the minimum sample
begin
  if not (p_status <> 'not_started' or coalesce(p_completion, 0) > 0 or coalesce(p_sessions, 0) > 0 or coalesce(p_attempts, 0) > 0) then return 'not_started'; end if;
  if public.learning_weak_reason(p_attempts, p_recent_acc, p_confidence, p_ratings) is not null then return 'weak'; end if;
  if p_revision_due is not null and p_revision_due <= p_today then return 'needs_revision'; end if;
  if not v_done then return 'in_progress'; end if;
  if p_ladder_complete and (coalesce(p_attempts, 0) = 0 or (v_acc is not null and v_acc >= public.lc_mastered_accuracy()))
     and (p_confidence is null or p_confidence >= public.lc_strong_confidence()) then return 'mastered'; end if;
  if (v_acc is not null and v_acc >= public.lc_strong_accuracy() and (p_confidence is null or p_confidence >= 3))
     or (coalesce(p_attempts, 0) = 0 and coalesce(p_reviews_done, 0) >= 1 and p_confidence is not null and p_confidence >= public.lc_strong_confidence()) then return 'strong'; end if;
  return 'learning';   -- first pass done, not yet proven
end $$;

-- Live (non-archived) trackable entities. 011 redefines this to also require a PUBLISHED container: it is the single place that decides "active".
create or replace function public.active_entities()
returns table(entity_type public.entity_t, entity_id uuid, title text, priority public.priority_t, estimated_minutes int, sort_pos int)
language sql stable security invoker set search_path = public
as $$
  select 'ncert_chapter'::public.entity_t, c.id, c.title, c.priority, c.estimated_minutes, coalesce(c.number, 9999) from chapters c where not coalesce(c.archived, false)
  union all select 'ssc_topic'::public.entity_t, t.id, t.title, t.priority, t.estimated_minutes, coalesce(t.position, 0) from ssc_topics t where not coalesce(t.archived, false)
  union all select 'ssc_subtopic'::public.entity_t, s.id, s.title, null::public.priority_t, null::int, coalesce(s.position, 0)
              from ssc_subtopics s join ssc_topics t on t.id = s.topic_id where not s.archived and not coalesce(t.archived, false)
$$;

create or replace function public.user_entity_signals(p_type public.entity_t default null, p_id uuid default null)
returns table(
  entity_type public.entity_t, entity_id uuid, title text, priority public.priority_t, estimated_minutes int,
  status text, completion int, confidence int, sessions int, seconds_spent int, last_studied_at timestamptz, completed_at timestamptz,
  pyq_count int, pyq_attempts int, pyq_recent_accuracy numeric, revision_due_date date, revision_step int,
  last_ratings text[], reviews_done int, ladder_complete boolean, today date, mastery text, weak_reason text)
language sql security invoker set search_path = public
as $$
  with me as (select auth.uid() as uid, public.user_today(auth.uid()) as today),
  base as (
    select e.entity_type, e.entity_id, e.title, e.priority, e.estimated_minutes, up.status::text as status, up.completion, up.confidence,
           up.sessions, up.seconds_spent, up.last_studied_at, up.completed_at
      from public.active_entities() e
      join public.user_progress up on up.user_id = (select uid from me) and up.entity_type = e.entity_type and up.entity_id = e.entity_id
     where (p_type is null or e.entity_type = p_type) and (p_id is null or e.entity_id = p_id)),
  -- A topic with subtopics: effective completion = share of its subtopics completed (the manual value only applies to leaves).
  sub as (
    select s.topic_id, count(*)::int as total, (count(*) filter (where sp.status = 'completed'))::int as done
      from public.ssc_subtopics s
      left join public.user_progress sp on sp.user_id = (select uid from me) and sp.entity_type = 'ssc_subtopic' and sp.entity_id = s.id
     where not s.archived and s.topic_id in (select entity_id from base where entity_type = 'ssc_topic')
     group by s.topic_id),
  att as (
    select 'ssc_topic'::public.entity_t as et, pt.ssc_topic_id as eid, a.is_correct, a.created_at
      from public.pyq_attempts a join public.pyq_topics pt on pt.pyq_id = a.pyq_id
     where a.user_id = (select uid from me) and pt.ssc_topic_id in (select entity_id from base where entity_type = 'ssc_topic')
    union all
    select 'ssc_subtopic'::public.entity_t, ps.ssc_subtopic_id, a.is_correct, a.created_at
      from public.pyq_attempts a join public.pyq_subtopics ps on ps.pyq_id = a.pyq_id
     where a.user_id = (select uid from me) and ps.ssc_subtopic_id in (select entity_id from base where entity_type = 'ssc_subtopic')),
  attr as (select et, eid, is_correct, row_number() over (partition by et, eid order by created_at desc) as rn from att),
  agg as (select et, eid, count(*)::int as n, 100.0 * avg(case when is_correct then 1 else 0 end) filter (where rn <= public.lc_recent_window()) as recent from attr group by et, eid),
  pc as (
    select 'ssc_topic'::public.entity_t as et, pt.ssc_topic_id as eid, count(*)::int as n
      from public.pyq_topics pt join public.pyqs y on y.id = pt.pyq_id and not y.archived
     where pt.ssc_topic_id in (select entity_id from base where entity_type = 'ssc_topic') group by pt.ssc_topic_id
    union all
    select 'ssc_subtopic'::public.entity_t, ps.ssc_subtopic_id, count(*)::int
      from public.pyq_subtopics ps join public.pyqs y on y.id = ps.pyq_id and not y.archived
     where ps.ssc_subtopic_id in (select entity_id from base where entity_type = 'ssc_subtopic') group by ps.ssc_subtopic_id),
  rv as (select r.entity_type as et, r.entity_id as eid, r.due_date, r.step from public.revision_schedule r where r.user_id = (select uid from me) and not r.done),
  rw as (select v.entity_type as et, v.entity_id as eid, v.rating, v.graduated,
                row_number() over (partition by v.entity_type, v.entity_id order by v.reviewed_at desc, v.id desc) as rn
           from public.revision_reviews v where v.user_id = (select uid from me)),
  rg as (select et, eid, count(*)::int as n, (array_agg(rating order by rn) filter (where rn <= 3)) as ratings,
                coalesce(bool_or(graduated) filter (where rn = 1), false) as last_grad from rw group by et, eid),
  f as (
    select b.*, case when b.entity_type = 'ssc_topic' and sub.total > 0 then round(100.0 * sub.done / sub.total)::int else b.completion end as eff_completion,
           coalesce(pc.n, 0) as pyq_n, coalesce(agg.n, 0) as attempts_n, agg.recent as recent_acc, rv.due_date as due, rv.step as step_n,
           coalesce(rg.ratings, '{}'::text[]) as ratings, coalesce(rg.n, 0) as reviews_n, (coalesce(rg.last_grad, false) and rv.due_date is null) as ladder_done,
           (select today from me) as today_d
      from base b
      left join sub on sub.topic_id = b.entity_id and b.entity_type = 'ssc_topic'
      left join pc  on pc.et  = b.entity_type and pc.eid  = b.entity_id
      left join agg on agg.et = b.entity_type and agg.eid = b.entity_id
      left join rv  on rv.et  = b.entity_type and rv.eid  = b.entity_id
      left join rg  on rg.et  = b.entity_type and rg.eid  = b.entity_id)
  select f.entity_type, f.entity_id, f.title, f.priority, f.estimated_minutes, f.status, f.eff_completion, f.confidence, f.sessions, f.seconds_spent,
         f.last_studied_at, f.completed_at, f.pyq_n, f.attempts_n, f.recent_acc, f.due, f.step_n, f.ratings, f.reviews_n, f.ladder_done, f.today_d,
         public.learning_mastery(f.status, f.eff_completion, f.confidence, f.sessions, f.attempts_n, f.recent_acc, f.due, f.today_d, f.ratings, f.reviews_n, f.ladder_done),
         public.learning_weak_reason(f.attempts_n, f.recent_acc, f.confidence, f.ratings)
    from f
$$;

-- "What should I study now?" Deterministic and explainable: every row says WHY (kind + reason).
-- Order: picked (today's tasks linked to an item) > overdue revision (most overdue first) > due revision > weak
--   (priority, PYQ count, lower accuracy, studied longest ago) > continue (most recently studied) > start next (highest priority
--   topic whose recommended foundation/direct NCERT chapters are completed).  Deduped per item (strongest reason wins), capped.
create or replace function public.daily_focus(p_limit int default null)
returns table(entity_type public.entity_t, entity_id uuid, title text, kind text, reason text, overdue_days int,
              estimated_minutes int, priority public.priority_t, rank int)
language sql security invoker set search_path = public
as $$
  with me as (select auth.uid() as uid, public.user_today(auth.uid()) as today, least(greatest(coalesce(p_limit, public.lc_focus_max()), 1), 10) as lim),
  sig as (select * from public.user_entity_signals()),
  cand as (
    select t.entity_type, t.entity_id, e.title, 'picked'::text as kind, 'You added this to today''s focus'::text as reason, 0 as overdue_days,
           e.estimated_minutes, e.priority, 0 as ord, 0::numeric as s1, 0::numeric as s2, null::timestamptz as s3
      from public.tasks t join public.active_entities() e on e.entity_type = t.entity_type and e.entity_id = t.entity_id
     where t.user_id = (select uid from me) and t.entity_id is not null and t.status <> 'completed' and t.due_date = (select today from me)
    union all
    select r.entity_type, r.entity_id, e.title,
           case when r.due_date < (select today from me) then 'overdue_revision' else 'due_revision' end,
           case when r.due_date < (select today from me) then 'Revision overdue by ' || ((select today from me) - r.due_date) || ' day(s)' else 'Revision due today' end,
           greatest((select today from me) - r.due_date, 0), e.estimated_minutes, e.priority,
           case when r.due_date < (select today from me) then 1 else 2 end, ((select today from me) - r.due_date)::numeric, 0::numeric, null::timestamptz
      from public.revision_schedule r join public.active_entities() e on e.entity_type = r.entity_type and e.entity_id = r.entity_id
     where r.user_id = (select uid from me) and not r.done and r.due_date <= (select today from me)
    union all
    select s.entity_type, s.entity_id, s.title, 'weak',
           'Weak: ' || case s.weak_reason when 'low_accuracy' then 'recent PYQ accuracy is low' when 'hard_streak' then 'two Hard reviews in a row' else 'you rated your confidence low' end,
           0, s.estimated_minutes, s.priority, 3,
           (public.priority_rank(s.priority) * 1000 + least(s.pyq_count, 999))::numeric, coalesce(s.pyq_recent_accuracy, 101)::numeric, s.last_studied_at
      from sig s where s.mastery = 'weak'
    union all
    select s.entity_type, s.entity_id, s.title, 'continue', 'Keep going (' || s.completion || '% done)', 0, s.estimated_minutes, s.priority, 4,
           coalesce(extract(epoch from s.last_studied_at), 0)::numeric, 0::numeric, null::timestamptz
      from sig s where s.mastery = 'in_progress'
    union all
    (select e.entity_type, e.entity_id, e.title, 'start_next', 'Next priority topic', 0, e.estimated_minutes, e.priority, 5,
            public.priority_rank(e.priority)::numeric, e.sort_pos::numeric, null::timestamptz
       from public.active_entities() e
      where e.entity_type = 'ssc_topic'
        and not exists (select 1 from public.user_progress up where up.user_id = (select uid from me) and up.entity_type = e.entity_type and up.entity_id = e.entity_id and up.status <> 'not_started')
        and not exists (select 1 from public.ncert_ssc_mappings m
                         where m.ssc_topic_id = e.entity_id and m.recommended and m.mapping_type in ('foundation', 'direct')
                           and not exists (select 1 from public.user_progress cp where cp.user_id = (select uid from me) and cp.entity_type = 'ncert_chapter'
                                                  and cp.entity_id = m.ncert_chapter_id and cp.status = 'completed'))
      order by public.priority_rank(e.priority) desc, e.sort_pos, e.entity_id limit 10)),
  dedup as (select distinct on (c.entity_type, c.entity_id) c.* from cand c order by c.entity_type, c.entity_id, c.ord),
  ranked as (select d.*, (row_number() over (order by d.ord, d.s1 desc nulls last, d.s2 asc nulls last, d.s3 asc nulls first, d.entity_id))::int as rk from dedup d)
  select r.entity_type, r.entity_id, r.title, r.kind, r.reason, r.overdue_days, r.estimated_minutes, r.priority, r.rk
    from ranked r where r.rk <= (select lim from me) order by r.rk
$$;

-- Dashboard numbers. Denominators: live (non-archived, published) SSC topics; NCERT chapters that have at least one RECOMMENDED
-- mapping to a live SSC topic (unmapped chapters are not "required"). Numerators are subsets, so no percentage can exceed 100.
-- Revision % = reviews done in the last 30 days / (those + currently overdue). Study seconds = today's sessions (closed seconds + the
-- already-banked part of an open one).
create or replace function public.dashboard_summary()
returns table(ncert_total int, ncert_done int, ssc_total int, ssc_done int, ncert_percent int, ssc_percent int, overall_percent int,
              pyq_attempts int, pyq_correct int, pyq_percent int, revision_percent int, revisions_due int, tasks_open int,
              today_seconds int, streak int, weak_count int)
language sql security invoker set search_path = public
as $$
  with me as (select auth.uid() as uid, public.user_today(auth.uid()) as today, public._user_tz(auth.uid()) as tz),
  win as (select uid, today, ((today)::timestamp at time zone tz) as day_start, ((today + 1)::timestamp at time zone tz) as day_end from me),
  ae as (select * from public.active_entities()),
  mapped as (
    select e.entity_id from ae e
     where e.entity_type = 'ncert_chapter'
       and exists (select 1 from public.ncert_ssc_mappings m join ae t on t.entity_type = 'ssc_topic' and t.entity_id = m.ssc_topic_id
                    where m.ncert_chapter_id = e.entity_id and m.recommended)),
  done as (select up.entity_type, up.entity_id from public.user_progress up where up.user_id = (select uid from me) and up.status = 'completed'),
  t as (
    select (select count(*) from mapped)::int as nt,
           (select count(*) from mapped m join done d on d.entity_type = 'ncert_chapter' and d.entity_id = m.entity_id)::int as nd,
           (select count(*) from ae where entity_type = 'ssc_topic')::int as st,
           (select count(*) from ae e join done d on d.entity_type = 'ssc_topic' and d.entity_id = e.entity_id where e.entity_type = 'ssc_topic')::int as sd),
  att as (select count(*)::int as n, (count(*) filter (where is_correct))::int as ok from public.pyq_attempts where user_id = (select uid from me)),
  rev as (
    select (select count(*) from public.revision_reviews v where v.user_id = (select uid from me) and v.reviewed_at >= public.app_now() - interval '30 days')::int as done30,
           (select count(*) from public.revision_schedule r where r.user_id = (select uid from me) and not r.done and r.due_date < (select today from me))::int as overdue,
           (select count(*) from public.revision_schedule r where r.user_id = (select uid from me) and not r.done and r.due_date <= (select today from me))::int as due_now),
  sess as (
    select coalesce(sum(case when s.state in ('completed', 'abandoned') then s.seconds else s.accumulated_seconds end), 0)::int as secs
      from public.study_sessions s, win w where s.user_id = w.uid and s.started_at >= w.day_start and s.started_at < w.day_end)
  select t.nt, t.nd, t.st, t.sd,
         case when t.nt > 0 then least(100, round(100.0 * t.nd / t.nt))::int else 0 end,
         case when t.st > 0 then least(100, round(100.0 * t.sd / t.st))::int else 0 end,
         case when t.nt + t.st > 0 then least(100, round(100.0 * (t.nd + t.sd) / (t.nt + t.st)))::int else 0 end,
         att.n, att.ok, case when att.n > 0 then round(100.0 * att.ok / att.n)::int else 0 end,
         case when rev.done30 + rev.overdue > 0 then round(100.0 * rev.done30 / (rev.done30 + rev.overdue))::int else 0 end,
         rev.due_now,
         (select count(*) from public.tasks k where k.user_id = (select uid from me) and k.status <> 'completed')::int,
         sess.secs,
         coalesce((select case when p.last_study_date in ((select today from me), (select today from me) - 1) then p.streak_count else 0 end
                     from public.profiles p where p.id = (select uid from me)), 0),
         (select count(*) from public.user_entity_signals() x where x.mastery = 'weak')::int
    from t, att, rev, sess
$$;

revoke all on function public.priority_rank(public.priority_t), public.learning_weak_reason(int, numeric, int, text[]),
  public.learning_mastery(text, int, int, int, int, numeric, date, date, text[], int, boolean), public.active_entities(),
  public.user_entity_signals(public.entity_t, uuid), public.daily_focus(int), public.dashboard_summary() from public, anon;
grant execute on function public.priority_rank(public.priority_t), public.learning_weak_reason(int, numeric, int, text[]),
  public.learning_mastery(text, int, int, int, int, numeric, date, date, text[], int, boolean), public.active_entities(),
  public.user_entity_signals(public.entity_t, uuid), public.daily_focus(int), public.dashboard_summary() to authenticated;
