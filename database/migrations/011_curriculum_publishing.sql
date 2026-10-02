-- 011_curriculum_publishing.sql — Phase 4. Safe to re-run. Requires 005-010.
--
-- LIFECYCLE of official curriculum containers (books = NCERT editions, ssc_exams = SSC syllabus versions):
--     draft -> in_review -> published -> archived          (+ in_review -> draft to send back, archived -> published to restore)
--   Never published -> draft, never hard delete (005 guard). Imports ALWAYS land as draft. Only an admin can change status, through
--   set_publish_status(); publishing needs a source and some content.
--   Visibility is enforced by RLS: normal users never see draft/in_review containers or anything underneath them.
--   Archived content stays readable (history, existing progress) but is excluded from active_entities() and therefore from every count.
--
-- TRUST FLAGS: sources.is_verified and ssc_exams.is_official can only be changed by verify_source() / set_exam_official()
--   (admin RPCs that also stamp who/when). An uploaded file can never set them: import_* functions reject files that try, and apply never writes them.
--
-- LEGACY: every existing book / exam becomes 'published' (archived books -> 'archived') so current users see no change.
--   books.archived is kept as a mirror of status = 'archived' for older code.
--   SQL-editor / service-role writes (no JWT) skip the transition and gate checks on purpose: they are the break-glass / seeding path.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'publish_status_t' and typnamespace = 'public'::regnamespace) then
    create type public.publish_status_t as enum ('draft','in_review','published','archived');
  end if;
end $$;

alter table public.books     add column if not exists status public.publish_status_t not null default 'published';
alter table public.ssc_exams add column if not exists status public.publish_status_t not null default 'published';
update public.books set status = 'archived' where coalesce(archived, false) and status = 'published';
alter table public.books     alter column status set default 'draft';
alter table public.ssc_exams alter column status set default 'draft';
alter table public.sources add column if not exists verified_at timestamptz, add column if not exists verified_by uuid references public.profiles (id) on delete set null;

------------------------------------------------------------------
-- 1. Transition + gate enforcement, trust flags
------------------------------------------------------------------
create or replace function public.enforce_publish_rules() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_table_name = 'books' then new.archived := (new.status = 'archived'); end if;
  if auth.uid() is null then return new; end if;                          -- break-glass / seeding
  if tg_op = 'INSERT' then new.status := 'draft'; return new; end if;     -- API inserts always start as draft
  if new.status is distinct from old.status then
    if not public.is_admin() then raise exception 'Only admins can change publishing status' using errcode = '42501'; end if;
    if (old.status::text || '>' || new.status::text) not in ('draft>in_review','in_review>draft','in_review>published','published>archived','archived>published','draft>archived','in_review>archived') then
      raise exception 'Invalid status change: % -> %', old.status, new.status using errcode = '55000';
    end if;
    if new.status = 'published' then
      if new.source_id is null then raise exception 'A source is required before publishing' using errcode = '23514'; end if;
      if tg_table_name = 'books' and not exists (select 1 from public.chapters c where c.book_id = new.id and not coalesce(c.archived, false)) then
        raise exception 'Add at least one chapter before publishing this book' using errcode = '23514'; end if;
      if tg_table_name = 'ssc_exams' and not exists (select 1 from public.ssc_tiers t where t.exam_id = new.id) then
        raise exception 'Add at least one tier before publishing this exam version' using errcode = '23514'; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists enforce_publish_rules on public.books;
create trigger enforce_publish_rules before insert or update on public.books for each row execute function public.enforce_publish_rules();
drop trigger if exists enforce_publish_rules on public.ssc_exams;
create trigger enforce_publish_rules before insert or update on public.ssc_exams for each row execute function public.enforce_publish_rules();

create or replace function public.guard_trust_flags() returns trigger
language plpgsql set search_path = ''
as $$
declare v_changed boolean;
begin
  if auth.uid() is null or current_setting('app.allow_flag_change', true) = 'on' then return new; end if;
  if tg_table_name = 'sources' then
    v_changed := case when tg_op = 'INSERT' then new.is_verified else new.is_verified is distinct from old.is_verified end;
  else
    v_changed := case when tg_op = 'INSERT' then new.is_official else new.is_official is distinct from old.is_official end;
  end if;
  if v_changed then raise exception 'Trust flags can only be changed through the admin verification workflow' using errcode = '42501'; end if;
  return new;
end $$;
drop trigger if exists guard_trust_flags on public.sources;
create trigger guard_trust_flags before insert or update on public.sources for each row execute function public.guard_trust_flags();
drop trigger if exists guard_trust_flags on public.ssc_exams;
create trigger guard_trust_flags before insert or update on public.ssc_exams for each row execute function public.guard_trust_flags();

create or replace function public.set_publish_status(p_kind text, p_id uuid, p_to public.publish_status_t) returns text
language plpgsql security definer set search_path = ''
as $$
begin
  perform public._require_uid();
  if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  if p_kind = 'book' then update public.books set status = p_to where id = p_id;
  elsif p_kind = 'ssc_exam' then update public.ssc_exams set status = p_to where id = p_id;
  else raise exception 'kind must be book or ssc_exam' using errcode = '22023'; end if;
  if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
  return p_to::text;
end $$;

create or replace function public.verify_source(p_source uuid, p_verified boolean default true) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := public._require_uid();
begin
  if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  perform set_config('app.allow_flag_change', 'on', true);
  update public.sources set is_verified = p_verified, verified_at = case when p_verified then public.app_now() end, verified_by = case when p_verified then v_uid end where id = p_source;
  perform set_config('app.allow_flag_change', 'off', true);
  if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
end $$;

-- An exam version can be marked official only when its source is verified and a notification URL is on record.
create or replace function public.set_exam_official(p_exam uuid, p_official boolean default true) returns void
language plpgsql security definer set search_path = ''
as $$
declare e public.ssc_exams;
begin
  perform public._require_uid();
  if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  select * into e from public.ssc_exams where id = p_exam;
  if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
  if p_official and (nullif(btrim(e.notification_url), '') is null or not coalesce((select s.is_verified from public.sources s where s.id = e.source_id), false)) then
    raise exception 'Official status needs a notification URL and a verified source' using errcode = '23514';
  end if;
  perform set_config('app.allow_flag_change', 'on', true);
  update public.ssc_exams set is_official = p_official where id = p_exam;
  perform set_config('app.allow_flag_change', 'off', true);
end $$;

revoke all on function public.set_publish_status(text, uuid, public.publish_status_t), public.verify_source(uuid, boolean), public.set_exam_official(uuid, boolean) from public, anon;
grant execute on function public.set_publish_status(text, uuid, public.publish_status_t), public.verify_source(uuid, boolean), public.set_exam_official(uuid, boolean) to authenticated;

------------------------------------------------------------------
-- 2. Visibility: draft / in_review content is invisible to normal users (admins see everything)
------------------------------------------------------------------
create or replace function public.is_book_visible(p uuid) returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.books b where b.id = p and (b.status in ('published','archived') or public.is_admin())) $$;
create or replace function public.is_chapter_visible(p uuid) returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.chapters c join public.books b on b.id = c.book_id where c.id = p and (b.status in ('published','archived') or public.is_admin())) $$;
create or replace function public.is_exam_visible(p uuid) returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.ssc_exams e where e.id = p and (e.status in ('published','archived') or public.is_admin())) $$;
create or replace function public.is_tier_visible(p uuid) returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.ssc_tiers t join public.ssc_exams e on e.id = t.exam_id where t.id = p and (e.status in ('published','archived') or public.is_admin())) $$;
create or replace function public.is_ssc_subject_visible(p uuid) returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.ssc_subjects s join public.ssc_tiers t on t.id = s.tier_id join public.ssc_exams e on e.id = t.exam_id
                      where s.id = p and (e.status in ('published','archived') or public.is_admin())) $$;
create or replace function public.is_topic_visible(p uuid) returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.ssc_topics x join public.ssc_subjects s on s.id = x.subject_id join public.ssc_tiers t on t.id = s.tier_id join public.ssc_exams e on e.id = t.exam_id
                      where x.id = p and (e.status in ('published','archived') or public.is_admin())) $$;
revoke all on function public.is_book_visible(uuid), public.is_chapter_visible(uuid), public.is_exam_visible(uuid), public.is_tier_visible(uuid),
  public.is_ssc_subject_visible(uuid), public.is_topic_visible(uuid) from public, anon;
grant execute on function public.is_book_visible(uuid), public.is_chapter_visible(uuid), public.is_exam_visible(uuid), public.is_tier_visible(uuid),
  public.is_ssc_subject_visible(uuid), public.is_topic_visible(uuid) to authenticated;

do $$ begin
  -- containers
  drop policy if exists "read" on public.books;      drop policy if exists books_read on public.books;
  create policy books_read on public.books for select to authenticated using (status in ('published','archived') or public.is_admin());
  drop policy if exists "read" on public.ssc_exams;  drop policy if exists ssc_exams_read on public.ssc_exams;
  create policy ssc_exams_read on public.ssc_exams for select to authenticated using (status in ('published','archived') or public.is_admin());
  drop policy if exists "read" on public.ssc_tiers;  drop policy if exists ssc_tiers_read on public.ssc_tiers;
  create policy ssc_tiers_read on public.ssc_tiers for select to authenticated using (public.is_exam_visible(exam_id));
  drop policy if exists "read" on public.ssc_subjects; drop policy if exists ssc_subjects_read on public.ssc_subjects;
  create policy ssc_subjects_read on public.ssc_subjects for select to authenticated using (public.is_tier_visible(tier_id));
  drop policy if exists "read" on public.ncert_ssc_mappings; drop policy if exists mappings_read on public.ncert_ssc_mappings;
  create policy mappings_read on public.ncert_ssc_mappings for select to authenticated using (public.is_chapter_visible(ncert_chapter_id) and public.is_topic_visible(ssc_topic_id));

  -- rows beneath containers: official rows need a visible parent; custom rows can only be attached to visible parents
  drop policy if exists read_official_or_own on public.chapters;  drop policy if exists own_custom_write on public.chapters;
  create policy read_official_or_own on public.chapters for select to authenticated using ((owner_id is null and public.is_book_visible(book_id)) or owner_id = auth.uid());
  create policy own_custom_write on public.chapters for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid() and public.is_book_visible(book_id));

  drop policy if exists read_official_or_own on public.concepts;  drop policy if exists own_custom_write on public.concepts;
  create policy read_official_or_own on public.concepts for select to authenticated using ((owner_id is null and public.is_chapter_visible(chapter_id)) or owner_id = auth.uid());
  create policy own_custom_write on public.concepts for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid() and public.is_chapter_visible(chapter_id));

  drop policy if exists read_official_or_own on public.ssc_topics;  drop policy if exists own_custom_write on public.ssc_topics;
  create policy read_official_or_own on public.ssc_topics for select to authenticated using ((owner_id is null and public.is_ssc_subject_visible(subject_id)) or owner_id = auth.uid());
  create policy own_custom_write on public.ssc_topics for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid() and public.is_ssc_subject_visible(subject_id));

  drop policy if exists read_official_or_own on public.ssc_subtopics;  drop policy if exists own_custom_write on public.ssc_subtopics;
  create policy read_official_or_own on public.ssc_subtopics for select to authenticated using ((owner_id is null and public.is_topic_visible(topic_id)) or owner_id = auth.uid());
  create policy own_custom_write on public.ssc_subtopics for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid() and public.is_topic_visible(topic_id));
end $$;

-- "Active" now also means: inside a PUBLISHED container (archived and draft content never count).
create or replace function public.active_entities()
returns table(entity_type public.entity_t, entity_id uuid, title text, priority public.priority_t, estimated_minutes int, sort_pos int)
language sql stable security invoker set search_path = public
as $$
  select 'ncert_chapter'::public.entity_t, c.id, c.title, c.priority, c.estimated_minutes, coalesce(c.number, 9999)
    from chapters c join books b on b.id = c.book_id where b.status = 'published' and not coalesce(c.archived, false)
  union all
  select 'ssc_topic'::public.entity_t, t.id, t.title, t.priority, t.estimated_minutes, coalesce(t.position, 0)
    from ssc_topics t join ssc_subjects s on s.id = t.subject_id join ssc_tiers tr on tr.id = s.tier_id join ssc_exams e on e.id = tr.exam_id
   where e.status = 'published' and not coalesce(s.archived, false) and not coalesce(t.archived, false)
  union all
  select 'ssc_subtopic'::public.entity_t, st.id, st.title, null::public.priority_t, null::int, coalesce(st.position, 0)
    from ssc_subtopics st join ssc_topics t on t.id = st.topic_id join ssc_subjects s on s.id = t.subject_id join ssc_tiers tr on tr.id = s.tier_id join ssc_exams e on e.id = tr.exam_id
   where e.status = 'published' and not coalesce(s.archived, false) and not coalesce(t.archived, false) and not st.archived
$$;

create or replace function public.entity_accessible(p_type public.entity_t, p_id uuid, p_uid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case p_type
    when 'ncert_chapter' then exists (select 1 from public.chapters c join public.books b on b.id = c.book_id
                                       where c.id = p_id and b.status = 'published' and not coalesce(c.archived, false) and (c.owner_id is null or c.owner_id = p_uid))
    when 'ssc_topic'     then exists (select 1 from public.ssc_topics t join public.ssc_subjects s on s.id = t.subject_id join public.ssc_tiers tr on tr.id = s.tier_id join public.ssc_exams e on e.id = tr.exam_id
                                       where t.id = p_id and e.status = 'published' and not coalesce(t.archived, false) and (t.owner_id is null or t.owner_id = p_uid))
    when 'ssc_subtopic'  then exists (select 1 from public.ssc_subtopics st join public.ssc_topics t on t.id = st.topic_id join public.ssc_subjects s on s.id = t.subject_id
                                       join public.ssc_tiers tr on tr.id = s.tier_id join public.ssc_exams e on e.id = tr.exam_id
                                       where st.id = p_id and e.status = 'published' and not st.archived and not coalesce(t.archived, false) and (st.owner_id is null or st.owner_id = p_uid))
    else false end
$$;
revoke all on function public.entity_accessible(public.entity_t, uuid, uuid) from public, anon, authenticated;

------------------------------------------------------------------
-- 3. Import staging (admin only). Files are parsed by the app, STAGED here, validated in SQL, applied in ONE transaction as DRAFT.
------------------------------------------------------------------
create table if not exists public.import_runs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles (id) on delete set null,
  file_name text,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  source jsonb not null default '{}'::jsonb,                          -- {name, source_url, edition, academic_year, curriculum_version}; never trust flags
  status text not null default 'uploaded' check (status in ('uploaded','validated','invalid','applied','discarded')),
  dry_run boolean not null default true,
  counts jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default public.app_now(),
  validated_at timestamptz,
  applied_at timestamptz
);
create unique index if not exists import_runs_applied_sha on public.import_runs (file_sha256) where status = 'applied';   -- same file cannot be applied twice
create index if not exists import_runs_admin_idx on public.import_runs (admin_id, created_at desc);

create table if not exists public.import_rows (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.import_runs (id) on delete cascade,
  kind text not null check (kind in ('ncert','ssc','mapping')),
  row_no int not null,
  data jsonb not null,
  status text not null default 'pending' check (status in ('pending','valid','invalid','applied')),
  errors jsonb not null default '[]'::jsonb,
  natural_key text,
  unique (run_id, kind, row_no)
);
create index if not exists import_rows_run_status_idx on public.import_rows (run_id, status);
create index if not exists import_rows_run_key_idx on public.import_rows (run_id, natural_key);

alter table public.import_runs enable row level security;
alter table public.import_rows enable row level security;
drop policy if exists import_runs_admin_read on public.import_runs;
drop policy if exists import_rows_admin_read on public.import_rows;
create policy import_runs_admin_read on public.import_runs for select to authenticated using (public.is_admin());
create policy import_rows_admin_read on public.import_rows for select to authenticated using (public.is_admin());
revoke all on public.import_runs, public.import_rows from anon, authenticated;
grant select on public.import_runs, public.import_rows to authenticated;       -- writes only through the RPCs below

create or replace function public._import_err(p_field text, p_msg text) returns jsonb
language sql immutable set search_path = ''
as $$ select jsonb_build_array(jsonb_build_object('field', p_field, 'message', p_msg)) $$;

create or replace function public._import_admin() returns uuid
language plpgsql stable set search_path = ''
as $$ declare v uuid := public._require_uid(); begin if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if; return v; end $$;

create or replace function public.import_create_run(p_file_name text, p_sha256 text, p_source jsonb, p_dry_run boolean default true) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_admin uuid := public._import_admin(); v_id uuid;
begin
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'file_sha256 must be a lowercase hex SHA-256' using errcode = '22023'; end if;
  p_source := coalesce(p_source, '{}'::jsonb);
  if p_source ?| array['is_verified','is_official','verified','official','status','publish_status','published'] then
    raise exception 'Import sources cannot declare trust or publishing flags' using errcode = '22023'; end if;
  if nullif(btrim(p_source ->> 'name'), '') is null then raise exception 'A source name is required' using errcode = '22023'; end if;
  if exists (select 1 from public.import_runs where file_sha256 = p_sha256 and status = 'applied') then raise exception 'This file was already imported' using errcode = '23505'; end if;
  insert into public.import_runs (admin_id, file_name, file_sha256, source, dry_run) values (v_admin, left(p_file_name, 200), p_sha256, p_source, coalesce(p_dry_run, true)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.import_stage_rows(p_run uuid, p_kind text, p_rows jsonb) returns int
language plpgsql security definer set search_path = ''
as $$
declare r public.import_runs; v_base int; v_n int;
begin
  perform public._import_admin();
  if p_kind not in ('ncert','ssc','mapping') then raise exception 'kind must be ncert, ssc or mapping' using errcode = '22023'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a JSON array' using errcode = '22023'; end if;
  v_n := jsonb_array_length(p_rows);
  if v_n > 2000 then raise exception 'At most 2000 rows per call' using errcode = '22023'; end if;
  select * into r from public.import_runs where id = p_run for update;
  if not found then raise exception 'Import run not found' using errcode = 'P0002'; end if;
  if r.status in ('applied','discarded') then raise exception 'Import run is closed' using errcode = '55000'; end if;
  select coalesce(max(row_no), 0) into v_base from public.import_rows where run_id = p_run and kind = p_kind;
  insert into public.import_rows (run_id, kind, row_no, data)
  select p_run, p_kind, v_base + o.ord, o.val from jsonb_array_elements(p_rows) with ordinality as o(val, ord) where jsonb_typeof(o.val) = 'object';
  update public.import_runs set status = 'uploaded', validated_at = null where id = p_run;
  return v_n;
end $$;

-- Resolution helpers (exact, case-sensitive: they match the case-sensitive natural-key indexes). Counted over DB rows UNION rows in this file.
create or replace function public._import_chapter_matches(p_run uuid, p_class text, p_subject text, p_book text, p_edition text, p_chapter text) returns int
language sql stable security definer set search_path = ''
as $$
  select count(distinct k)::int from (
    select concat_ws('|', cl.grade::text, s.name, b.title, coalesce(b.edition, ''), ch.title) as k
      from public.chapters ch join public.books b on b.id = ch.book_id join public.subjects s on s.id = b.subject_id join public.classes cl on cl.id = s.class_id
     where ch.owner_id is null and cl.grade::text = p_class and s.name = p_subject and ch.title = p_chapter
       and (p_book is null or b.title = p_book) and (p_edition is null or coalesce(b.edition, '') = p_edition)
    union
    select concat_ws('|', n.data ->> 'class', n.data ->> 'subject', n.data ->> 'book', coalesce(n.data ->> 'edition', ''), n.data ->> 'chapter')
      from public.import_rows n
     where n.run_id = p_run and n.kind = 'ncert' and n.data ->> 'class' = p_class and n.data ->> 'subject' = p_subject and n.data ->> 'chapter' = p_chapter
       and (p_book is null or n.data ->> 'book' = p_book) and (p_edition is null or coalesce(n.data ->> 'edition', '') = p_edition)
  ) u
$$;
create or replace function public._import_topic_matches(p_run uuid, p_exam text, p_version text, p_tier text, p_subject text, p_topic text) returns int
language sql stable security definer set search_path = ''
as $$
  select count(distinct k)::int from (
    select concat_ws('|', e.name, e.exam_version, tr.name, ss.name, t.title) as k
      from public.ssc_topics t join public.ssc_subjects ss on ss.id = t.subject_id join public.ssc_tiers tr on tr.id = ss.tier_id join public.ssc_exams e on e.id = tr.exam_id
     where t.owner_id is null and e.name = coalesce(p_exam, 'SSC CGL') and e.exam_version = p_version and tr.name = p_tier and ss.name = p_subject and t.title = p_topic
    union
    select concat_ws('|', coalesce(n.data ->> 'exam', 'SSC CGL'), n.data ->> 'exam_version', n.data ->> 'tier', n.data ->> 'subject', n.data ->> 'topic')
      from public.import_rows n
     where n.run_id = p_run and n.kind = 'ssc' and coalesce(n.data ->> 'exam', 'SSC CGL') = coalesce(p_exam, 'SSC CGL') and n.data ->> 'exam_version' = p_version
       and n.data ->> 'tier' = p_tier and n.data ->> 'subject' = p_subject and n.data ->> 'topic' = p_topic
  ) u
$$;

create or replace function public.import_validate_run(p_run uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.import_runs; v_total int; v_invalid int; v_errs jsonb; v_counts jsonb;
begin
  perform public._import_admin();
  select * into r from public.import_runs where id = p_run for update;
  if not found then raise exception 'Import run not found' using errcode = 'P0002'; end if;
  if r.status in ('applied','discarded') then raise exception 'Import run is closed' using errcode = '55000'; end if;
  update public.import_rows set status = 'pending', errors = '[]'::jsonb, natural_key = null where run_id = p_run;

  -- 1. trust / publishing flags are never accepted from a file
  update public.import_rows set status = 'invalid', errors = errors || public._import_err('flags', 'Files cannot declare verified/official/status/published flags')
   where run_id = p_run and data ?| array['is_verified','is_official','verified','official','status','publish_status','published'];

  -- 2. required fields
  update public.import_rows w set status = 'invalid', errors = w.errors || public._import_err('required', 'Missing: ' || m.miss)
    from (select i.id, (select string_agg(k, ', ') from unnest(case i.kind
                          when 'ncert' then array['class','subject','book','chapter']
                          when 'ssc' then array['exam_version','tier','subject','topic']
                          else array['class','subject','chapter','exam_version','tier','ssc_subject','topic','mapping_type'] end) as k
                        where nullif(btrim(i.data ->> k), '') is null) as miss
            from public.import_rows i where i.run_id = p_run) m
   where w.id = m.id and m.miss is not null;

  -- 3. value checks
  update public.import_rows set status = 'invalid', errors = errors || public._import_err('class', 'class must be a whole number from 6 to 12')
   where run_id = p_run and kind in ('ncert','mapping') and nullif(btrim(data ->> 'class'), '') is not null
     and not (data ->> 'class' ~ '^\d{1,2}$' and (case when data ->> 'class' ~ '^\d{1,2}$' then (data ->> 'class')::int between 6 and 12 else false end));
  update public.import_rows set status = 'invalid', errors = errors || public._import_err('number', 'chapter_number / estimated_minutes must be whole numbers')
   where run_id = p_run and ((nullif(btrim(data ->> 'chapter_number'), '') is not null and data ->> 'chapter_number' !~ '^\d{1,4}$')
                         or (nullif(btrim(data ->> 'estimated_minutes'), '') is not null and data ->> 'estimated_minutes' !~ '^\d{1,5}$'));
  update public.import_rows set status = 'invalid', errors = errors || public._import_err('relevance', 'relevance must be very_high, high, medium, low or not_mapped')
   where run_id = p_run and nullif(data ->> 'relevance', '') is not null and data ->> 'relevance' not in ('very_high','high','medium','low','not_mapped');
  update public.import_rows set status = 'invalid', errors = errors || public._import_err('priority', 'priority must be very_high, high, medium or low')
   where run_id = p_run and nullif(data ->> 'priority', '') is not null and data ->> 'priority' not in ('very_high','high','medium','low');
  update public.import_rows set status = 'invalid', errors = errors || public._import_err('mapping_type', 'mapping_type must be foundation, direct, supporting or background')
   where run_id = p_run and kind = 'mapping' and nullif(data ->> 'mapping_type', '') is not null and data ->> 'mapping_type' not in ('foundation','direct','supporting','background');
  update public.import_rows set status = 'invalid', errors = errors || public._import_err('recommended', 'recommended must be true or false')
   where run_id = p_run and nullif(data ->> 'recommended', '') is not null and lower(data ->> 'recommended') not in ('true','false','yes','no','1','0');

  -- 4. natural keys + duplicates inside the file
  update public.import_rows set natural_key = case kind
      when 'ncert' then concat_ws('|', 'ncert', data ->> 'class', data ->> 'subject', data ->> 'book', coalesce(data ->> 'edition', ''), data ->> 'chapter')
      when 'ssc' then concat_ws('|', 'ssc', coalesce(data ->> 'exam', 'SSC CGL'), data ->> 'exam_version', data ->> 'tier', data ->> 'subject', data ->> 'topic', coalesce(data ->> 'subtopic', ''))
      else concat_ws('|', 'map', data ->> 'class', data ->> 'subject', coalesce(data ->> 'book', ''), data ->> 'chapter', coalesce(data ->> 'exam', 'SSC CGL'),
                     data ->> 'exam_version', data ->> 'tier', data ->> 'ssc_subject', data ->> 'topic') end
   where run_id = p_run;
  update public.import_rows set status = 'invalid', errors = errors || public._import_err('duplicate', 'Duplicate row in this file')
   where run_id = p_run and natural_key in (select natural_key from public.import_rows where run_id = p_run group by natural_key having count(*) > 1);

  -- 5. foreign-key resolution for mappings: each endpoint must resolve to exactly one chapter / topic (database or this file)
  update public.import_rows w set status = 'invalid', errors = w.errors || public._import_err('chapter', case when x.n = 0 then 'NCERT chapter not found in the database or this file' else 'NCERT chapter is ambiguous: add book / edition' end)
    from (select i.id, public._import_chapter_matches(i.run_id, i.data ->> 'class', i.data ->> 'subject', nullif(i.data ->> 'book', ''), nullif(i.data ->> 'edition', ''), i.data ->> 'chapter') as n
            from public.import_rows i where i.run_id = p_run and i.kind = 'mapping' and nullif(i.data ->> 'chapter', '') is not null) x
   where w.id = x.id and x.n <> 1;
  update public.import_rows w set status = 'invalid', errors = w.errors || public._import_err('topic', case when x.n = 0 then 'SSC topic not found in the database or this file' else 'SSC topic is ambiguous' end)
    from (select i.id, public._import_topic_matches(i.run_id, nullif(i.data ->> 'exam', ''), i.data ->> 'exam_version', i.data ->> 'tier', i.data ->> 'ssc_subject', i.data ->> 'topic') as n
            from public.import_rows i where i.run_id = p_run and i.kind = 'mapping' and nullif(i.data ->> 'topic', '') is not null) x
   where w.id = x.id and x.n <> 1;

  -- 6. imports may only touch DRAFT containers. Published content changes through a new edition / version (or the mapping editor).
  update public.import_rows set status = 'invalid', errors = errors || public._import_err('book', 'This book already exists and is not a draft. Import a new edition instead')
   where run_id = p_run and kind = 'ncert' and exists (
     select 1 from public.books b join public.subjects s on s.id = b.subject_id join public.classes cl on cl.id = s.class_id
      where cl.grade::text = data ->> 'class' and s.name = data ->> 'subject' and b.title = data ->> 'book' and coalesce(b.edition, '') = coalesce(data ->> 'edition', '') and b.status <> 'draft');
  update public.import_rows set status = 'invalid', errors = errors || public._import_err('exam_version', 'This exam version already exists and is not a draft. Import a new version instead')
   where run_id = p_run and kind = 'ssc' and exists (
     select 1 from public.ssc_exams e where e.name = coalesce(data ->> 'exam', 'SSC CGL') and e.exam_version = data ->> 'exam_version' and e.status <> 'draft');
  update public.import_rows set status = 'invalid', errors = errors || public._import_err('mapping', 'Both endpoints are already published. Use the mapping editor for live content')
   where run_id = p_run and kind = 'mapping' and
     exists (select 1 from public.chapters ch join public.books b on b.id = ch.book_id join public.subjects s on s.id = b.subject_id join public.classes cl on cl.id = s.class_id
              where ch.owner_id is null and b.status = 'published' and cl.grade::text = data ->> 'class' and s.name = data ->> 'subject' and ch.title = data ->> 'chapter'
                and (nullif(data ->> 'book', '') is null or b.title = data ->> 'book'))
     and exists (select 1 from public.ssc_topics t join public.ssc_subjects ss on ss.id = t.subject_id join public.ssc_tiers tr on tr.id = ss.tier_id join public.ssc_exams e on e.id = tr.exam_id
                  where t.owner_id is null and e.status = 'published' and e.name = coalesce(data ->> 'exam', 'SSC CGL') and e.exam_version = data ->> 'exam_version'
                    and tr.name = data ->> 'tier' and ss.name = data ->> 'ssc_subject' and t.title = data ->> 'topic');

  update public.import_rows set status = 'valid' where run_id = p_run and status = 'pending';

  select count(*), count(*) filter (where status = 'invalid') into v_total, v_invalid from public.import_rows where run_id = p_run;
  select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'row', e.row_no, 'errors', e.errors) order by e.kind, e.row_no), '[]'::jsonb) into v_errs
    from (select kind, row_no, errors from public.import_rows where run_id = p_run and status = 'invalid' order by kind, row_no limit 100) e;
  v_counts := jsonb_build_object('total', v_total, 'valid', v_total - v_invalid, 'invalid', v_invalid,
    'ncert', (select count(*) from public.import_rows where run_id = p_run and kind = 'ncert'),
    'ssc', (select count(*) from public.import_rows where run_id = p_run and kind = 'ssc'),
    'mapping', (select count(*) from public.import_rows where run_id = p_run and kind = 'mapping'));
  update public.import_runs set status = case when v_invalid = 0 and v_total > 0 then 'validated' else 'invalid' end,
         counts = v_counts, errors = v_errs, validated_at = public.app_now() where id = p_run;
  return jsonb_build_object('run_id', p_run, 'status', case when v_invalid = 0 and v_total > 0 then 'validated' else 'invalid' end, 'counts', v_counts, 'errors', v_errs);
end $$;

-- apply: ONE function = ONE transaction. Any error rolls back every row. Everything lands as DRAFT, unverified, unofficial.
create or replace function public.import_apply_run(p_run uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.import_runs; w record; v_src uuid; v_cls uuid; v_sub uuid; v_book uuid; v_ch uuid; v_exam uuid; v_tier uuid; v_ss uuid; v_tp uuid;
  v_concepts text[]; i int; n_ncert int := 0; n_ssc int := 0; n_map int := 0;
begin
  perform public._import_admin();
  select * into r from public.import_runs where id = p_run for update;
  if not found then raise exception 'Import run not found' using errcode = 'P0002'; end if;
  if r.status <> 'validated' then raise exception 'Validate the run (with zero invalid rows) before applying' using errcode = '55000'; end if;
  if r.dry_run then raise exception 'This run is a dry run. Create a new run with dry_run = false to apply' using errcode = '55000'; end if;
  if exists (select 1 from public.import_rows where run_id = p_run and status <> 'valid') then raise exception 'Run contains rows that are not valid' using errcode = '55000'; end if;

  insert into public.sources (name, source_url, edition, academic_year, curriculum_version, is_verified)
  values (r.source ->> 'name', nullif(r.source ->> 'source_url', ''), nullif(r.source ->> 'edition', ''), nullif(r.source ->> 'academic_year', ''), nullif(r.source ->> 'curriculum_version', ''), false)
  on conflict (name, (coalesce(edition, ''))) do update set source_url = coalesce(public.sources.source_url, excluded.source_url)
  returning id into v_src;

  for w in select * from public.import_rows where run_id = p_run and kind = 'ncert' order by row_no loop
    insert into public.classes (grade, label) values ((w.data ->> 'class')::int, 'Class ' || (w.data ->> 'class'))
      on conflict (grade) do update set grade = excluded.grade returning id into v_cls;
    insert into public.subjects (class_id, name) values (v_cls, w.data ->> 'subject')
      on conflict (class_id, name) do update set name = excluded.name returning id into v_sub;
    select b.id into v_book from public.books b where b.subject_id = v_sub and b.title = w.data ->> 'book' and coalesce(b.edition, '') = coalesce(w.data ->> 'edition', '');
    if v_book is null then
      insert into public.books (subject_id, source_id, title, edition, academic_year, source_url)
      values (v_sub, v_src, w.data ->> 'book', nullif(w.data ->> 'edition', ''), nullif(w.data ->> 'academic_year', ''), nullif(w.data ->> 'source_url', '')) returning id into v_book;
    else
      update public.books set academic_year = coalesce(nullif(w.data ->> 'academic_year', ''), academic_year), source_url = coalesce(nullif(w.data ->> 'source_url', ''), source_url),
             source_id = coalesce(source_id, v_src) where id = v_book;
    end if;
    insert into public.chapters (book_id, title, number, relevance, priority, estimated_minutes, source_url)
    values (v_book, w.data ->> 'chapter', nullif(w.data ->> 'chapter_number', '')::int,
            coalesce(nullif(w.data ->> 'relevance', '')::public.relevance_t, 'not_mapped'), coalesce(nullif(w.data ->> 'priority', '')::public.priority_t, 'medium'),
            nullif(w.data ->> 'estimated_minutes', '')::int, nullif(w.data ->> 'source_url', ''))
    on conflict (book_id, title) where owner_id is null do update set
      number = coalesce(excluded.number, public.chapters.number),
      relevance = coalesce(nullif(w.data ->> 'relevance', '')::public.relevance_t, public.chapters.relevance),
      priority = coalesce(nullif(w.data ->> 'priority', '')::public.priority_t, public.chapters.priority),
      estimated_minutes = coalesce(excluded.estimated_minutes, public.chapters.estimated_minutes)
    returning id into v_ch;
    v_concepts := case when jsonb_typeof(w.data -> 'concepts') = 'array' then array(select jsonb_array_elements_text(w.data -> 'concepts'))
                       else string_to_array(coalesce(w.data ->> 'concepts', ''), '|') end;
    for i in 1..coalesce(cardinality(v_concepts), 0) loop
      if nullif(btrim(v_concepts[i]), '') is not null then
        insert into public.concepts (chapter_id, title, position) values (v_ch, btrim(v_concepts[i]), i - 1)
        on conflict (chapter_id, title) where owner_id is null do update set position = excluded.position;
      end if;
    end loop;
    n_ncert := n_ncert + 1; v_book := null;
  end loop;

  for w in select * from public.import_rows where run_id = p_run and kind = 'ssc' order by row_no loop
    insert into public.ssc_exams (name, exam_version, source_id) values (coalesce(nullif(w.data ->> 'exam', ''), 'SSC CGL'), w.data ->> 'exam_version', v_src)
      on conflict (name, exam_version) do update set source_id = coalesce(public.ssc_exams.source_id, excluded.source_id) returning id into v_exam;
    insert into public.ssc_tiers (exam_id, name) values (v_exam, w.data ->> 'tier') on conflict (exam_id, name) do update set name = excluded.name returning id into v_tier;
    insert into public.ssc_subjects (tier_id, name) values (v_tier, w.data ->> 'subject') on conflict (tier_id, name) do update set name = excluded.name returning id into v_ss;
    insert into public.ssc_topics (subject_id, title, priority, estimated_minutes)
    values (v_ss, w.data ->> 'topic', coalesce(nullif(w.data ->> 'priority', '')::public.priority_t, 'medium'), nullif(w.data ->> 'estimated_minutes', '')::int)
    on conflict (subject_id, title) where owner_id is null do update set
      priority = coalesce(nullif(w.data ->> 'priority', '')::public.priority_t, public.ssc_topics.priority),
      estimated_minutes = coalesce(excluded.estimated_minutes, public.ssc_topics.estimated_minutes)
    returning id into v_tp;
    if nullif(btrim(w.data ->> 'subtopic'), '') is not null then
      insert into public.ssc_subtopics (topic_id, title) values (v_tp, btrim(w.data ->> 'subtopic')) on conflict (topic_id, title) where owner_id is null do nothing;
    end if;
    n_ssc := n_ssc + 1;
  end loop;

  for w in select * from public.import_rows where run_id = p_run and kind = 'mapping' order by row_no loop
    select ch.id into v_ch from public.chapters ch join public.books b on b.id = ch.book_id join public.subjects s on s.id = b.subject_id join public.classes cl on cl.id = s.class_id
     where ch.owner_id is null and cl.grade::text = w.data ->> 'class' and s.name = w.data ->> 'subject' and ch.title = w.data ->> 'chapter'
       and (nullif(w.data ->> 'book', '') is null or b.title = w.data ->> 'book') and (nullif(w.data ->> 'edition', '') is null or coalesce(b.edition, '') = w.data ->> 'edition') limit 1;
    select t.id into v_tp from public.ssc_topics t join public.ssc_subjects ss on ss.id = t.subject_id join public.ssc_tiers tr on tr.id = ss.tier_id join public.ssc_exams e on e.id = tr.exam_id
     where t.owner_id is null and e.name = coalesce(nullif(w.data ->> 'exam', ''), 'SSC CGL') and e.exam_version = w.data ->> 'exam_version' and tr.name = w.data ->> 'tier'
       and ss.name = w.data ->> 'ssc_subject' and t.title = w.data ->> 'topic' limit 1;
    if v_ch is null or v_tp is null then raise exception 'Mapping row % could not be resolved', w.row_no using errcode = '23503'; end if;
    insert into public.ncert_ssc_mappings (ncert_chapter_id, ssc_topic_id, mapping_type, relevance, reason, recommended)
    values (v_ch, v_tp, (w.data ->> 'mapping_type')::public.mapping_t, coalesce(nullif(w.data ->> 'relevance', '')::public.relevance_t, 'medium'),
            nullif(w.data ->> 'reason', ''), coalesce(lower(w.data ->> 'recommended') in ('true','yes','1'), true))
    on conflict (ncert_chapter_id, ssc_topic_id) do update set mapping_type = excluded.mapping_type, relevance = excluded.relevance, reason = excluded.reason, recommended = excluded.recommended;
    n_map := n_map + 1;
  end loop;

  update public.import_rows set status = 'applied' where run_id = p_run;
  update public.import_runs set status = 'applied', applied_at = public.app_now() where id = p_run;
  return jsonb_build_object('run_id', p_run, 'applied', jsonb_build_object('ncert', n_ncert, 'ssc', n_ssc, 'mapping', n_map), 'published', false,
                            'note', 'Everything was created as DRAFT and unverified. Review, then publish with set_publish_status().');
end $$;

create or replace function public.import_discard_run(p_run uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public._import_admin();
  update public.import_runs set status = 'discarded' where id = p_run and status <> 'applied';
  if not found then raise exception 'Import run not found or already applied' using errcode = 'P0002'; end if;
  delete from public.import_rows where run_id = p_run;
end $$;

revoke all on function public._import_err(text, text), public._import_admin(), public._import_chapter_matches(uuid, text, text, text, text, text),
  public._import_topic_matches(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.import_create_run(text, text, jsonb, boolean), public.import_stage_rows(uuid, text, jsonb), public.import_validate_run(uuid),
  public.import_apply_run(uuid), public.import_discard_run(uuid) from public, anon;
grant execute on function public.import_create_run(text, text, jsonb, boolean), public.import_stage_rows(uuid, text, jsonb), public.import_validate_run(uuid),
  public.import_apply_run(uuid), public.import_discard_run(uuid) to authenticated;
