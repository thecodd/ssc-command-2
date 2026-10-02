-- 004_hardening.sql — Phase 2 production hardening. Safe to re-run.
-- Fixes: recursive profiles policy, admin self-escalation, resource/custom-content policies, anon access,
-- timezone + streak in the database, ranked search, and RPCs that replace large IN(...) lists.

------------------------------------------------------------------
-- 0. Anonymous role gets nothing. The app only uses authenticated users.
------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

------------------------------------------------------------------
-- 1. is_admin(): minimal, deterministic, no RLS recursion.
--    SECURITY DEFINER runs as the function owner (postgres), which bypasses RLS on profiles,
--    so it never re-enters a profiles policy. search_path is empty, so every name is schema-qualified.
--    Unauthenticated callers: auth.uid() is NULL -> no row -> false.
------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false) $$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

------------------------------------------------------------------
-- 2. profiles: timezone, non-recursive policies, column-level privileges, guard trigger.
------------------------------------------------------------------
alter table public.profiles add column if not exists timezone text not null default 'Asia/Kolkata';

drop policy if exists "own profile" on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
-- None of these policies reads the profiles table, so there is nothing to recurse into.
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = auth.uid() and is_admin = false);
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Privileges are the primary defence: clients can never write is_admin, streak_count or last_study_date.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (id, display_name, timezone) on public.profiles to authenticated;
grant update (display_name, daily_goal_minutes, revision_intervals, timezone) on public.profiles to authenticated;

-- Defence in depth (catches an accidental future GRANT) + timezone validation.
-- Requests from the SQL editor / service role carry no JWT (auth.uid() is NULL) and may change is_admin.
create or replace function public.profiles_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is not null then
    if tg_op = 'UPDATE' and new.is_admin is distinct from old.is_admin then
      raise exception 'is_admin cannot be changed through the API' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and new.is_admin then
      raise exception 'is_admin cannot be set through the API' using errcode = '42501';
    end if;
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles for each row execute function public.profiles_guard();

-- Profile creation on signup: definer, fixed search_path, idempotent.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(split_part(coalesce(new.email, ''), '@', 1), ''))
  on conflict (id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Streak is computed in the DB using the user's own timezone (clients cannot write the columns).
create or replace function public.touch_streak() returns void
language plpgsql security definer set search_path = ''
as $$
declare v_tz text; v_last date; v_streak int; v_today date;
begin
  if auth.uid() is null then return; end if;
  select p.timezone, p.last_study_date, p.streak_count into v_tz, v_last, v_streak from public.profiles p where p.id = auth.uid();
  if not found then return; end if;
  v_today := (now() at time zone v_tz)::date;
  if v_last = v_today then return; end if;
  update public.profiles
     set streak_count = case when v_last = v_today - 1 then coalesce(v_streak, 0) + 1 else 1 end, last_study_date = v_today
   where id = auth.uid();
end $$;
revoke all on function public.touch_streak() from public, anon;
grant execute on function public.touch_streak() to authenticated;

------------------------------------------------------------------
-- 3. Resources: user_id NULL = official, user_id = me = personal. Explicit per-command policies.
------------------------------------------------------------------
drop policy if exists "read resources" on public.resources;
drop policy if exists "own resources" on public.resources;
drop policy if exists resources_select on public.resources;
drop policy if exists resources_insert_own on public.resources;
drop policy if exists resources_update_own on public.resources;
drop policy if exists resources_delete_own on public.resources;
drop policy if exists resources_admin_official on public.resources;
create policy resources_select on public.resources for select to authenticated using (user_id is null or user_id = auth.uid());
create policy resources_insert_own on public.resources for insert to authenticated with check (user_id = auth.uid());
-- WITH CHECK (user_id = auth.uid()) means a user can never flip a row to NULL (official).
create policy resources_update_own on public.resources for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy resources_delete_own on public.resources for delete to authenticated using (user_id = auth.uid());
create policy resources_admin_official on public.resources for all to authenticated
  using (user_id is null and public.is_admin()) with check (user_id is null and public.is_admin());

------------------------------------------------------------------
-- 4. Custom content (owner_id): admins manage only OFFICIAL rows (owner_id IS NULL) and cannot read
--    or change another user's private custom rows. Users manage only their own and can't promote them.
------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['chapters','concepts','ssc_topics','ssc_subtopics','pyqs'] loop
    execute format('drop policy if exists "read" on public.%I', t);
    execute format('drop policy if exists "write" on public.%I', t);
    execute format('drop policy if exists read_official_or_own on public.%I', t);
    execute format('drop policy if exists admin_official_write on public.%I', t);
    execute format('drop policy if exists own_custom_write on public.%I', t);
    execute format('create policy read_official_or_own on public.%I for select to authenticated using (owner_id is null or owner_id = auth.uid())', t);
    execute format('create policy admin_official_write on public.%I for all to authenticated using (owner_id is null and public.is_admin()) with check (owner_id is null and public.is_admin())', t);
    execute format('create policy own_custom_write on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;

-- pyq_topics: only links to PYQs the caller can see; users may link/unlink their own custom PYQs.
drop policy if exists "read" on public.pyq_topics;
drop policy if exists pyq_topics_read on public.pyq_topics;
drop policy if exists pyq_topics_own_insert on public.pyq_topics;
drop policy if exists pyq_topics_own_delete on public.pyq_topics;
create policy pyq_topics_read on public.pyq_topics for select to authenticated using (exists (select 1 from public.pyqs p where p.id = pyq_id));
create policy pyq_topics_own_insert on public.pyq_topics for insert to authenticated with check (exists (select 1 from public.pyqs p where p.id = pyq_id and p.owner_id = auth.uid()));
create policy pyq_topics_own_delete on public.pyq_topics for delete to authenticated using (exists (select 1 from public.pyqs p where p.id = pyq_id and p.owner_id = auth.uid()));

------------------------------------------------------------------
-- 5. Ranked search: exact > prefix > word-prefix > substring, then trigram similarity.
------------------------------------------------------------------
create or replace function public.search_rank(t text, qq text, pre text, wpre text) returns int
language sql immutable parallel safe set search_path = ''
as $$ select case when lower(coalesce(t, '')) = qq then 0 when coalesce(t, '') ilike pre then 1 when coalesce(t, '') ilike wpre then 2 else 3 end $$;

drop function if exists public.global_search(text, int);
create function public.global_search(q text, lim int default 5)
returns table(kind text, id uuid, title text, subtitle text, href text)
language sql stable security invoker set search_path = public, extensions
as $$
  with e as (select replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') as s),
  p as (select trim(q) as raw, lower(trim(q)) as qq, '%' || s || '%' as pat, s || '%' as pre, '% ' || s || '%' as wpre from e)
  (select 'book'::text, b.id, b.title, ('Class ' || cl.grade || ' · ' || s.name)::text, ('/ncert/' || cl.grade)::text
     from books b join subjects s on s.id = b.subject_id join classes cl on cl.id = s.class_id, p
     where coalesce(b.archived, false) = false and b.title ilike p.pat
     order by search_rank(b.title, p.qq, p.pre, p.wpre), similarity(b.title, p.raw) desc, b.title limit lim)
  union all
  (select 'chapter'::text, c.id, c.title, ('Class ' || cl.grade || ' · ' || s.name)::text, ('/ncert/chapter/' || c.id)::text
     from chapters c join books b on b.id = c.book_id join subjects s on s.id = b.subject_id join classes cl on cl.id = s.class_id, p
     where coalesce(c.archived, false) = false and c.title ilike p.pat
     order by search_rank(c.title, p.qq, p.pre, p.wpre), similarity(c.title, p.raw) desc, c.title limit lim)
  union all
  (select 'concept'::text, k.id, k.title, c.title::text, ('/ncert/chapter/' || c.id || '?tab=concepts')::text
     from concepts k join chapters c on c.id = k.chapter_id, p where k.title ilike p.pat
     order by search_rank(k.title, p.qq, p.pre, p.wpre), similarity(k.title, p.raw) desc, k.title limit lim)
  union all
  (select 'ssc_subject'::text, s.id, s.name, tr.name::text, ('/ssc/subject/' || s.id)::text
     from ssc_subjects s join ssc_tiers tr on tr.id = s.tier_id, p where coalesce(s.archived, false) = false and s.name ilike p.pat
     order by search_rank(s.name, p.qq, p.pre, p.wpre), s.name limit lim)
  union all
  (select 'ssc_topic'::text, t.id, t.title, s.name::text, ('/ssc/topic/' || t.id)::text
     from ssc_topics t join ssc_subjects s on s.id = t.subject_id, p where coalesce(t.archived, false) = false and t.title ilike p.pat
     order by search_rank(t.title, p.qq, p.pre, p.wpre), similarity(t.title, p.raw) desc, t.title limit lim)
  union all
  (select 'ssc_subtopic'::text, st.id, st.title, t.title::text, ('/ssc/topic/' || t.id)::text
     from ssc_subtopics st join ssc_topics t on t.id = st.topic_id, p where st.title ilike p.pat
     order by search_rank(st.title, p.qq, p.pre, p.wpre), similarity(st.title, p.raw) desc, st.title limit lim)
  union all
  (select 'note'::text, n.id, coalesce(nullif(n.title, ''), 'Untitled note')::text, left(coalesce(n.content, ''), 80)::text,
          (case n.entity_type when 'ncert_chapter' then '/ncert/chapter/' || n.entity_id || '?tab=notes' when 'ssc_topic' then '/ssc/topic/' || n.entity_id else '/notes' end)::text
     from notes n, p where n.title ilike p.pat or n.content ilike p.pat
     order by search_rank(n.title, p.qq, p.pre, p.wpre), n.updated_at desc limit lim)
  union all
  (select 'pyq'::text, y.id, left(y.question, 90)::text, (coalesce(y.exam, '') || ' ' || coalesce(y.year::text, ''))::text, '/pyqs'::text
     from pyqs y, p where y.question ilike p.pat
     order by search_rank(y.question, p.qq, p.pre, p.wpre), y.year desc nulls last limit lim)
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
revoke all on function public.global_search(text, int) from public, anon;
grant execute on function public.global_search(text, int) to authenticated;

------------------------------------------------------------------
-- 6. RPCs that replace big IN(...) lists (PostgREST puts IN lists in the URL).
--    security invoker: RLS still applies to the caller.
------------------------------------------------------------------
create or replace function public.topic_pyq_stats(p_topic uuid)
returns table(pyq_count int, attempts int, correct int)
language sql stable security invoker set search_path = public
as $$
  select (select count(*) from pyq_topics pt where pt.ssc_topic_id = p_topic)::int,
         (select count(*) from pyq_attempts a join pyq_topics pt on pt.pyq_id = a.pyq_id where pt.ssc_topic_id = p_topic and a.user_id = auth.uid())::int,
         (select count(*) from pyq_attempts a join pyq_topics pt on pt.pyq_id = a.pyq_id where pt.ssc_topic_id = p_topic and a.user_id = auth.uid() and a.is_correct)::int
$$;
create or replace function public.topic_pyqs(p_topic uuid, lim int default 5)
returns table(id uuid, exam text, year int, question text, difficulty priority_t)
language sql stable security invoker set search_path = public
as $$
  select y.id, y.exam, y.year, y.question, y.difficulty from pyq_topics pt join pyqs y on y.id = pt.pyq_id
   where pt.ssc_topic_id = p_topic order by y.year desc nulls last, y.id limit lim
$$;
create or replace function public.subject_pyq_counts(p_subject uuid)
returns table(ssc_topic_id uuid, n int)
language sql stable security invoker set search_path = public
as $$
  select pt.ssc_topic_id, count(*)::int from pyq_topics pt join ssc_topics t on t.id = pt.ssc_topic_id
   where t.subject_id = p_subject group by pt.ssc_topic_id
$$;
do $$ declare f text; begin
  foreach f in array array['topic_pyq_stats(uuid)','topic_pyqs(uuid,int)','subject_pyq_counts(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
