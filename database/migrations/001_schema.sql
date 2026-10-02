-- CGL COMMAND — schema v1. Run in Supabase SQL editor.
create extension if not exists pg_trgm;

create type status_t as enum ('not_started','learning','completed','strong','revision');
create type relevance_t as enum ('very_high','high','medium','low','not_mapped');
create type priority_t as enum ('very_high','high','medium','low');
create type mapping_t as enum ('foundation','direct','supporting','background');
create type task_status_t as enum ('todo','in_progress','completed');
create type resource_t as enum ('pdf','video','website','book','notes','other');
create type entity_t as enum ('ncert_chapter','ssc_topic','ssc_subtopic','pyq','resource','concept');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text, daily_goal_minutes int not null default 45,
  streak_count int not null default 0, last_study_date date,
  revision_intervals int[] not null default '{1,3,7,15,30}',
  is_admin boolean not null default false, created_at timestamptz default now()
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  name text not null, source_url text, edition text, academic_year text,
  curriculum_version text, is_verified boolean not null default false,
  created_at timestamptz default now()
);

-- NCERT hierarchy: class -> subject -> book -> chapter -> concept
create table classes (id uuid primary key default gen_random_uuid(), grade int not null unique check (grade between 6 and 12), label text);
create table subjects (id uuid primary key default gen_random_uuid(), class_id uuid not null references classes on delete cascade, name text not null, archived boolean default false, unique(class_id,name));
create table books (id uuid primary key default gen_random_uuid(), subject_id uuid not null references subjects on delete cascade, source_id uuid references sources, title text not null, edition text, academic_year text, source_url text, archived boolean default false);
create table chapters (
  id uuid primary key default gen_random_uuid(), book_id uuid not null references books on delete cascade,
  number int, title text not null, relevance relevance_t not null default 'not_mapped',
  priority priority_t not null default 'medium', estimated_minutes int, source_url text,
  owner_id uuid references profiles, -- non-null = user's custom chapter
  archived boolean default false, created_at timestamptz default now()
);
create table concepts (id uuid primary key default gen_random_uuid(), chapter_id uuid not null references chapters on delete cascade, title text not null, position int default 0, owner_id uuid references profiles);

-- SSC hierarchy: exam(version) -> tier -> subject -> topic -> subtopic
create table ssc_exams (id uuid primary key default gen_random_uuid(), name text not null default 'SSC CGL', exam_version text not null, source_id uuid references sources, is_official boolean not null default false, notification_url text, unique(name,exam_version));
create table ssc_tiers (id uuid primary key default gen_random_uuid(), exam_id uuid not null references ssc_exams on delete cascade, name text not null, position int default 0);
create table ssc_subjects (id uuid primary key default gen_random_uuid(), tier_id uuid not null references ssc_tiers on delete cascade, name text not null, position int default 0, archived boolean default false);
create table ssc_topics (id uuid primary key default gen_random_uuid(), subject_id uuid not null references ssc_subjects on delete cascade, title text not null, priority priority_t default 'medium', estimated_minutes int, owner_id uuid references profiles, archived boolean default false, position int default 0);
create table ssc_subtopics (id uuid primary key default gen_random_uuid(), topic_id uuid not null references ssc_topics on delete cascade, title text not null, owner_id uuid references profiles, position int default 0);

create table ncert_ssc_mappings (
  id uuid primary key default gen_random_uuid(),
  ncert_chapter_id uuid not null references chapters on delete cascade,
  ssc_topic_id uuid not null references ssc_topics on delete cascade,
  mapping_type mapping_t not null, relevance relevance_t not null default 'medium',
  reason text, recommended boolean not null default true, created_at timestamptz default now(),
  unique (ncert_chapter_id, ssc_topic_id)
);

create table tags (id uuid primary key default gen_random_uuid(), name text not null unique);
create table topic_tags (tag_id uuid references tags on delete cascade, entity_type entity_t not null, entity_id uuid not null, primary key (tag_id, entity_type, entity_id));

create table pyqs (
  id uuid primary key default gen_random_uuid(), exam text, year int, tier text, subject text,
  question text not null, options jsonb, correct_answer text, explanation text,
  difficulty priority_t, source text, owner_id uuid references profiles, created_at timestamptz default now()
);
create table pyq_topics (pyq_id uuid references pyqs on delete cascade, ssc_topic_id uuid references ssc_topics on delete cascade, primary key (pyq_id, ssc_topic_id));
create table pyq_attempts (id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles on delete cascade, pyq_id uuid not null references pyqs on delete cascade, is_correct boolean not null, created_at timestamptz default now());

create table notes (id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles on delete cascade, entity_type entity_t not null, entity_id uuid not null, title text, content text, tags text[] default '{}', created_at timestamptz default now(), updated_at timestamptz default now());
create table resources (id uuid primary key default gen_random_uuid(), user_id uuid references profiles on delete cascade, entity_type entity_t, entity_id uuid, title text not null, url text, type resource_t default 'other', description text, created_at timestamptz default now());
create table study_sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles on delete cascade, entity_type entity_t not null, entity_id uuid not null, started_at timestamptz not null default now(), ended_at timestamptz, seconds int not null default 0);
create table user_progress (
  user_id uuid not null references profiles on delete cascade, entity_type entity_t not null, entity_id uuid not null,
  status status_t not null default 'not_started', completion int not null default 0 check (completion between 0 and 100),
  confidence int check (confidence between 1 and 5), seconds_spent int not null default 0, sessions int not null default 0,
  revision_count int not null default 0, last_studied_at timestamptz, primary key (user_id, entity_type, entity_id)
);
create table revision_schedule (id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles on delete cascade, entity_type entity_t not null, entity_id uuid not null, due_date date not null, interval_days int not null, done boolean not null default false, rating text check (rating in ('easy','good','hard')), done_at timestamptz);
create table tasks (id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles on delete cascade, title text not null, description text, subject text, entity_type entity_t, entity_id uuid, priority priority_t default 'medium', due_date date, estimated_minutes int, status task_status_t not null default 'todo', created_at timestamptz default now());

-- Indexes
create index on chapters using gin (title gin_trgm_ops);
create index on ssc_topics using gin (title gin_trgm_ops);
create index on ssc_subtopics using gin (title gin_trgm_ops);
create index on concepts using gin (title gin_trgm_ops);
create index on notes using gin (title gin_trgm_ops);
create index on pyqs using gin (question gin_trgm_ops);
create index on ncert_ssc_mappings (ssc_topic_id);
create index on ncert_ssc_mappings (ncert_chapter_id);
create index on revision_schedule (user_id, done, due_date);
create index on tasks (user_id, status, due_date);
create index on notes (user_id, entity_type, entity_id);
create index on study_sessions (user_id, started_at);

-- Auto-create profile
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into profiles (id, display_name) values (new.id, split_part(new.email,'@',1)); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create function is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin from profiles where id = auth.uid()), false) $$;

-- RLS: user-owned tables
do $$ declare t text; begin
  foreach t in array array['notes','study_sessions','user_progress','revision_schedule','tasks','pyq_attempts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "own rows" on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
alter table profiles enable row level security;
create policy "own profile" on profiles for all using (id = auth.uid()) with check (id = auth.uid() and is_admin = (select is_admin from profiles where id = auth.uid()));
alter table resources enable row level security;
create policy "read resources" on resources for select using (user_id is null or user_id = auth.uid());
create policy "own resources" on resources for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Curriculum: readable by signed-in users; writable by admins; custom rows (owner_id) by owner
do $$ declare t text; begin
  foreach t in array array['sources','classes','subjects','books','ssc_exams','ssc_tiers','ssc_subjects','ncert_ssc_mappings','tags','topic_tags','pyq_topics'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "read" on %I for select using (auth.uid() is not null)', t);
    execute format('create policy "admin write" on %I for all using (is_admin()) with check (is_admin())', t);
  end loop;
  foreach t in array array['chapters','concepts','ssc_topics','ssc_subtopics','pyqs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "read" on %I for select using (owner_id is null or owner_id = auth.uid() or is_admin())', t);
    execute format('create policy "write" on %I for all using (is_admin() or owner_id = auth.uid()) with check (is_admin() or owner_id = auth.uid())', t);
  end loop;
end $$;
