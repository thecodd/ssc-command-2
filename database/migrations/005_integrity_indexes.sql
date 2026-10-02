-- 005_integrity_indexes.sql — Phase 4. Safe to re-run. Non-destructive except where stated.
-- Contents: foundation functions (clock, constants), natural-key uniqueness, FK/query indexes,
-- owner-deletion behaviour, official-row delete guard, archive flags, tasks/notes housekeeping.
-- Requires: 001-004.

------------------------------------------------------------------
-- 0. Foundation functions
------------------------------------------------------------------
-- app_now(): the ONLY clock RPCs use. In production it is clock_timestamp(). Tests may pin it by setting
-- BOTH app.allow_test_clock = 'on' and app.test_now in the session; API clients cannot set GUCs.
create or replace function public.app_now() returns timestamptz
language sql volatile set search_path = ''
as $$ select coalesce(case when current_setting('app.allow_test_clock', true) = 'on' then nullif(current_setting('app.test_now', true), '')::timestamptz end, clock_timestamp()) $$;

-- user_today(): the user's local calendar date (profiles.timezone, default Asia/Kolkata). SECURITY INVOKER:
-- a client asking about someone else's uid gets the default zone because RLS hides that profile.
create or replace function public.user_today(p_uid uuid default auth.uid()) returns date
language sql volatile set search_path = ''
as $$ select (public.app_now() at time zone coalesce((select p.timezone from public.profiles p where p.id = coalesce(p_uid, auth.uid())), 'Asia/Kolkata'))::date $$;

-- Learning constants. MIRROR lib/learning/config.ts (a Node test compares the two). Change both together.
create or replace function public.lc_min_attempts() returns int language sql immutable as $$ select 5 $$;
create or replace function public.lc_recent_window() returns int language sql immutable as $$ select 10 $$;
create or replace function public.lc_weak_accuracy() returns int language sql immutable as $$ select 50 $$;
create or replace function public.lc_strong_accuracy() returns int language sql immutable as $$ select 75 $$;
create or replace function public.lc_mastered_accuracy() returns int language sql immutable as $$ select 80 $$;
create or replace function public.lc_weak_confidence() returns int language sql immutable as $$ select 2 $$;
create or replace function public.lc_strong_confidence() returns int language sql immutable as $$ select 4 $$;
create or replace function public.lc_hard_streak() returns int language sql immutable as $$ select 2 $$;
create or replace function public.lc_default_ladder() returns int[] language sql immutable as $$ select '{1,3,7,15,30}'::int[] $$;
create or replace function public.lc_max_intervals() returns int language sql immutable as $$ select 12 $$;
create or replace function public.lc_max_interval_days() returns int language sql immutable as $$ select 365 $$;
create or replace function public.lc_step_good() returns int language sql immutable as $$ select 1 $$;
create or replace function public.lc_step_easy() returns int language sql immutable as $$ select 2 $$;
create or replace function public.lc_stale_seconds() returns int language sql immutable as $$ select 600 $$;
create or replace function public.lc_stale_credit_seconds() returns int language sql immutable as $$ select 90 $$;
create or replace function public.lc_min_session_seconds() returns int language sql immutable as $$ select 30 $$;
create or replace function public.lc_max_session_seconds() returns int language sql immutable as $$ select 21600 $$;
create or replace function public.lc_focus_max() returns int language sql immutable as $$ select 5 $$;

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := public.app_now(); return new; end $$;

------------------------------------------------------------------
-- 1. Natural-key uniqueness. Refuses to run (with a clear message) if duplicates already exist,
--    instead of deleting anything. Fix the listed groups, then re-run.
------------------------------------------------------------------
do $$
declare r record; n bigint;
begin
  for r in select * from (values
    ('books',         'subject_id, title, coalesce(edition, '''')', null),
    ('chapters',      'book_id, title',                              'owner_id is null'),
    ('chapters',      'book_id, title, owner_id',                    'owner_id is not null'),
    ('concepts',      'chapter_id, title',                           'owner_id is null'),
    ('concepts',      'chapter_id, title, owner_id',                 'owner_id is not null'),
    ('ssc_tiers',     'exam_id, name',                               null),
    ('ssc_subjects',  'tier_id, name',                               null),
    ('ssc_topics',    'subject_id, title',                           'owner_id is null'),
    ('ssc_topics',    'subject_id, title, owner_id',                 'owner_id is not null'),
    ('ssc_subtopics', 'topic_id, title',                             'owner_id is null'),
    ('ssc_subtopics', 'topic_id, title, owner_id',                   'owner_id is not null'),
    ('sources',       'name, coalesce(edition, '''')',               null)
  ) as v(tbl, cols, pred) loop
    execute format('select count(*) from (select 1 from public.%I %s group by %s having count(*) > 1) d',
                   r.tbl, case when r.pred is null then '' else 'where ' || r.pred end, r.cols) into n;
    if n > 0 then
      raise exception 'Migration 005 blocked: % duplicate group(s) in public.% on (%). Merge or rename them, then re-run.', n, r.tbl, r.cols;
    end if;
  end loop;
end $$;

create unique index if not exists books_natural_key            on public.books (subject_id, title, (coalesce(edition, '')));
create unique index if not exists chapters_official_key        on public.chapters (book_id, title) where owner_id is null;
create unique index if not exists chapters_custom_key          on public.chapters (book_id, title, owner_id) where owner_id is not null;
create unique index if not exists concepts_official_key        on public.concepts (chapter_id, title) where owner_id is null;
create unique index if not exists concepts_custom_key          on public.concepts (chapter_id, title, owner_id) where owner_id is not null;
create unique index if not exists ssc_tiers_natural_key        on public.ssc_tiers (exam_id, name);
create unique index if not exists ssc_subjects_natural_key     on public.ssc_subjects (tier_id, name);
create unique index if not exists ssc_topics_official_key      on public.ssc_topics (subject_id, title) where owner_id is null;
create unique index if not exists ssc_topics_custom_key        on public.ssc_topics (subject_id, title, owner_id) where owner_id is not null;
create unique index if not exists ssc_subtopics_official_key   on public.ssc_subtopics (topic_id, title) where owner_id is null;
create unique index if not exists ssc_subtopics_custom_key     on public.ssc_subtopics (topic_id, title, owner_id) where owner_id is not null;
create unique index if not exists sources_natural_key          on public.sources (name, (coalesce(edition, '')));
-- (subjects (class_id,name), classes (grade), ssc_exams (name,exam_version), mappings (chapter,topic) are already unique in 001.)

------------------------------------------------------------------
-- 2. Query-pattern indexes. Only patterns that exist in the app: class tree, syllabus lists,
--    per-user lookups, cascade targets. Not every FK column.
------------------------------------------------------------------
create index if not exists books_subject_idx            on public.books (subject_id);
create index if not exists books_source_idx             on public.books (source_id) where source_id is not null;
create index if not exists ssc_exams_source_idx         on public.ssc_exams (source_id) where source_id is not null;
create index if not exists chapters_book_number_idx     on public.chapters (book_id, number);
create index if not exists chapters_owner_idx           on public.chapters (owner_id) where owner_id is not null;
create index if not exists concepts_chapter_pos_idx     on public.concepts (chapter_id, position);
create index if not exists concepts_owner_idx           on public.concepts (owner_id) where owner_id is not null;
create index if not exists ssc_tiers_exam_pos_idx       on public.ssc_tiers (exam_id, position);
create index if not exists ssc_subjects_tier_pos_idx    on public.ssc_subjects (tier_id, position);
create index if not exists ssc_topics_subject_pos_idx   on public.ssc_topics (subject_id, position);
create index if not exists ssc_topics_owner_idx         on public.ssc_topics (owner_id) where owner_id is not null;
create index if not exists ssc_subtopics_topic_pos_idx  on public.ssc_subtopics (topic_id, position);
create index if not exists ssc_subtopics_owner_idx      on public.ssc_subtopics (owner_id) where owner_id is not null;
create index if not exists pyqs_owner_idx               on public.pyqs (owner_id) where owner_id is not null;
create index if not exists pyq_topics_topic_idx         on public.pyq_topics (ssc_topic_id, pyq_id);   -- topic -> PYQs (PK starts with pyq_id)
create index if not exists pyq_attempts_user_pyq_idx    on public.pyq_attempts (user_id, pyq_id, created_at desc);
create index if not exists pyq_attempts_user_time_idx   on public.pyq_attempts (user_id, created_at desc);
create index if not exists pyq_attempts_pyq_idx         on public.pyq_attempts (pyq_id);                -- cascade from pyqs
create index if not exists resources_user_idx           on public.resources (user_id) where user_id is not null;
create index if not exists resources_entity_idx         on public.resources (entity_type, entity_id) where entity_id is not null;
create index if not exists topic_tags_entity_idx        on public.topic_tags (entity_type, entity_id);
create index if not exists mappings_recommended_idx     on public.ncert_ssc_mappings (ncert_chapter_id) where recommended;
create index if not exists progress_user_recent_idx     on public.user_progress (user_id, last_studied_at desc nulls last);
create index if not exists progress_user_status_idx     on public.user_progress (user_id, entity_type, status);
create index if not exists revision_open_due_idx        on public.revision_schedule (user_id, due_date) where not done;
create index if not exists tasks_open_due_idx           on public.tasks (user_id, due_date) where status <> 'completed';

------------------------------------------------------------------
-- 3. Ownership deletion: custom content follows its owner. Deleting a user must never be blocked by their
--    custom rows. (books.source_id / ssc_exams.source_id stay NO ACTION: a referenced source cannot be deleted.)
------------------------------------------------------------------
do $$
declare t text; c text;
begin
  foreach t in array array['chapters','concepts','ssc_topics','ssc_subtopics','pyqs'] loop
    c := t || '_owner_id_fkey';
    if exists (select 1 from pg_constraint where conname = c and conrelid = ('public.' || t)::regclass and confdeltype <> 'c') then
      execute format('alter table public.%I drop constraint %I', t, c);
      execute format('alter table public.%I add constraint %I foreign key (owner_id) references public.profiles (id) on delete cascade', t, c);
    end if;
  end loop;
end $$;

------------------------------------------------------------------
-- 4. Official curriculum is archived, never hard-deleted through the API.
--    A JWT request (auth.uid() not null) may not delete a row whose owner_id is NULL (or that has no owner_id).
--    SQL editor / service role (no JWT) remains available as an explicit break-glass path.
--    Custom rows (owner_id set) stay deletable by their owner under RLS. Mappings stay deletable by admins (a link, not content).
------------------------------------------------------------------
create or replace function public.forbid_official_delete() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is not null and (to_jsonb(old) ->> 'owner_id') is null then
    raise exception 'Official curriculum is archived, not deleted (% %)', tg_table_name, old.id using errcode = '42501';
  end if;
  return old;
end $$;

do $$
declare t text;
begin
  foreach t in array array['classes','subjects','books','chapters','concepts','ssc_exams','ssc_tiers','ssc_subjects','ssc_topics','ssc_subtopics','pyqs','sources'] loop
    execute format('drop trigger if exists forbid_official_delete on public.%I', t);
    execute format('create trigger forbid_official_delete before delete on public.%I for each row execute function public.forbid_official_delete()', t);
  end loop;
end $$;

-- Archive flags for leaf-level curriculum (chapters/topics/books/subjects already have one).
alter table public.concepts      add column if not exists archived boolean not null default false;
alter table public.ssc_subtopics add column if not exists archived boolean not null default false;

------------------------------------------------------------------
-- 5. tasks: entity pair integrity + completed_at; notes: updated_at maintenance
------------------------------------------------------------------
-- A task with only half of an entity reference is meaningless: drop the dangling half (the task itself is kept).
update public.tasks set entity_type = null, entity_id = null where (entity_type is null) <> (entity_id is null);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_entity_pair_chk') then
    alter table public.tasks add constraint tasks_entity_pair_chk check ((entity_type is null) = (entity_id is null));
  end if;
end $$;

alter table public.tasks add column if not exists completed_at timestamptz;
update public.tasks set completed_at = coalesce(completed_at, created_at) where status = 'completed' and completed_at is null;
create or replace function public.tasks_completed_at() returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.status = 'completed' then
    new.completed_at := coalesce(case when tg_op = 'UPDATE' and old.status = 'completed' then old.completed_at end, public.app_now());
  else
    new.completed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists tasks_completed_at on public.tasks;
create trigger tasks_completed_at before insert or update of status on public.tasks for each row execute function public.tasks_completed_at();

drop trigger if exists notes_touch_updated_at on public.notes;
create trigger notes_touch_updated_at before update on public.notes for each row execute function public.touch_updated_at();
