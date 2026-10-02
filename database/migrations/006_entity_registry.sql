-- 006_entity_registry.sql — Phase 4. Safe to re-run. Requires 005.
--
-- PURPOSE: make every (entity_type, entity_id) reference in user data point at a real row.
--
-- HOW IT WORKS
--   * public.entities (id, type) is a registry of referenceable curriculum rows. Clients have NO privileges on it.
--   * Curriculum tables (chapters, concepts, ssc_topics, ssc_subtopics, pyqs) each get a constant `kind` column and a
--     DEFERRED composite FK (kind, id) -> entities (type, id). An AFTER INSERT trigger (SECURITY DEFINER) writes the
--     registry row; an AFTER DELETE trigger removes it. Because registration is AFTER insert, an INSERT ... ON CONFLICT
--     DO NOTHING that inserts nothing also registers nothing (no orphan registry rows). The FK is deferred so it is
--     checked at commit, after the trigger ran.
--   * Referencing tables (user_progress, revision_schedule, study_sessions, notes, resources, tasks, topic_tags) get a
--     composite FK (entity_type, entity_id) -> entities (type, id) ON DELETE CASCADE plus a per-table CHECK of allowed
--     types. The composite key also guarantees the TYPE matches the id.
--
-- WHAT THE REGISTRY GUARANTEES (and does not)
--   + A reference can never point at a nonexistent entity, or at an id of the wrong type.   (FK)
--   + A curriculum row can never exist without its registry row.                             (deferred FK)
--   - A registry row without a curriculum row is prevented by triggers and locked-down privileges, not by a constraint
--     (Postgres cannot FK one table to "one of five tables"). public.entities_integrity_report() audits this; tests run it.
--
-- ARCHIVE vs DELETE
--   * Archiving (archived = true, or publish status 'archived' in 011) does NOT touch the registry: references stay valid,
--     history is preserved, live queries exclude the row.
--   * Hard-deleting OFFICIAL rows is blocked for API users (005 guard). Only break-glass (SQL editor / service role)
--     can do it, and then the AFTER DELETE trigger removes the registry row and the FK CASCADE deletes every user's
--     progress/notes/revisions/etc. for that entity. That is deliberate and irreversible: archive instead.
--   * A user deleting their OWN custom entity cascades to their own references only (nobody else can reference it).
--   * Legacy rows that cannot satisfy the new constraints are MOVED to entity_ref_quarantine, never silently deleted.

create table if not exists public.entities (
  id   uuid primary key,
  type public.entity_t not null,
  constraint entities_type_id_key unique (type, id)
);
alter table public.entities enable row level security;     -- no policies: nobody reads it through the API
revoke all on public.entities from anon, authenticated;

create table if not exists public.entity_ref_quarantine (
  id bigserial primary key,
  source_table text not null,
  row_data jsonb not null,
  reason text not null,
  quarantined_at timestamptz not null default now()
);
alter table public.entity_ref_quarantine enable row level security;
revoke all on public.entity_ref_quarantine from anon, authenticated;

create or replace function public.entity_register() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.entities (id, type) values (new.id, tg_argv[0]::public.entity_t) on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.entity_unregister() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.entities where id = old.id and type = tg_argv[0]::public.entity_t;
  return old;
end $$;
revoke all on function public.entity_register() from public, anon, authenticated;
revoke all on function public.entity_unregister() from public, anon, authenticated;

------------------------------------------------------------------
-- Curriculum tables: kind column, backfill, deferred FK, triggers
------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
    ('chapters','ncert_chapter'), ('concepts','concept'), ('ssc_topics','ssc_topic'), ('ssc_subtopics','ssc_subtopic'), ('pyqs','pyq')
  ) as v(tbl, kind) loop
    execute format('alter table public.%I add column if not exists kind public.entity_t not null default %L', r.tbl, r.kind);
    execute format('alter table public.%I drop constraint if exists %I', r.tbl, r.tbl || '_kind_chk');
    execute format('alter table public.%I add constraint %I check (kind = %L)', r.tbl, r.tbl || '_kind_chk', r.kind);
    execute format('insert into public.entities (id, type) select id, kind from public.%I on conflict (id) do nothing', r.tbl);
    if not exists (select 1 from pg_constraint where conname = r.tbl || '_entity_fk') then
      execute format('alter table public.%I add constraint %I foreign key (kind, id) references public.entities (type, id) deferrable initially deferred', r.tbl, r.tbl || '_entity_fk');
    end if;
    execute format('drop trigger if exists entity_register on public.%I', r.tbl);
    execute format('create trigger entity_register after insert on public.%I for each row execute function public.entity_register(%L)', r.tbl, r.kind);
    execute format('drop trigger if exists entity_unregister on public.%I', r.tbl);
    execute format('create trigger entity_unregister after delete on public.%I for each row execute function public.entity_unregister(%L)', r.tbl, r.kind);
  end loop;
end $$;

------------------------------------------------------------------
-- Referencing tables: quarantine invalid legacy rows, then enforce
------------------------------------------------------------------
do $$
declare r record; fk text; chk text; pair text;
begin
  for r in select * from (values
    ('user_progress',     'ncert_chapter,ssc_topic,ssc_subtopic',                 false),
    ('revision_schedule', 'ncert_chapter,ssc_topic,ssc_subtopic',                 false),
    ('study_sessions',    'ncert_chapter,ssc_topic,ssc_subtopic',                 false),
    ('notes',             'ncert_chapter,concept,ssc_topic,ssc_subtopic,pyq',     false),
    ('resources',         'ncert_chapter,concept,ssc_topic,ssc_subtopic,pyq',     true),
    ('tasks',             'ncert_chapter,ssc_topic,ssc_subtopic',                 true),
    ('topic_tags',        'ncert_chapter,concept,ssc_topic,ssc_subtopic,pyq',     false)
  ) as v(tbl, types, nullable) loop
    fk := r.tbl || '_entity_fk'; chk := r.tbl || '_entity_type_chk'; pair := r.tbl || '_entity_pair_chk';

    if r.nullable then   -- half references: drop the dangling half, keep the row
      execute format('update public.%I set entity_type = null, entity_id = null where (entity_type is null) <> (entity_id is null)', r.tbl);
    end if;

    execute format($q$
      with bad as (
        delete from public.%1$I t
         where %2$s
           and (t.entity_type::text <> all (string_to_array(%3$L, ','))
                or not exists (select 1 from public.entities e where e.type = t.entity_type and e.id = t.entity_id))
        returning to_jsonb(t) as j)
      insert into public.entity_ref_quarantine (source_table, row_data, reason)
      select %1$L, j, 'entity reference invalid or type not allowed for this table' from bad
    $q$, r.tbl, case when r.nullable then 't.entity_id is not null' else 'true' end, r.types);

    if not exists (select 1 from pg_constraint where conname = chk) then
      execute format('alter table public.%I add constraint %I check (entity_type = any (%L::public.entity_t[]))', r.tbl, chk, '{' || r.types || '}');
    end if;
    if r.nullable and not exists (select 1 from pg_constraint where conname = pair) then
      execute format('alter table public.%I add constraint %I check ((entity_type is null) = (entity_id is null))', r.tbl, pair);
    end if;
    if not exists (select 1 from pg_constraint where conname = fk) then
      execute format('alter table public.%I add constraint %I foreign key (entity_type, entity_id) references public.entities (type, id) on delete cascade', r.tbl, fk);
    end if;
  end loop;
end $$;

------------------------------------------------------------------
-- Audit: list any registry/curriculum inconsistency. Expect zero rows. Owner/service role only.
------------------------------------------------------------------
create or replace function public.entities_integrity_report() returns table(problem text, tbl text, id uuid)
language sql stable security definer set search_path = ''
as $$
  select 'registry row without curriculum row', e.type::text, e.id from public.entities e
   where not (
        (e.type = 'ncert_chapter' and exists (select 1 from public.chapters x      where x.id = e.id))
     or (e.type = 'concept'       and exists (select 1 from public.concepts x      where x.id = e.id))
     or (e.type = 'ssc_topic'     and exists (select 1 from public.ssc_topics x    where x.id = e.id))
     or (e.type = 'ssc_subtopic'  and exists (select 1 from public.ssc_subtopics x where x.id = e.id))
     or (e.type = 'pyq'           and exists (select 1 from public.pyqs x          where x.id = e.id)))
  union all select 'curriculum row without registry row', 'chapters',      c.id from public.chapters c      where not exists (select 1 from public.entities e where e.id = c.id and e.type = c.kind)
  union all select 'curriculum row without registry row', 'concepts',      c.id from public.concepts c      where not exists (select 1 from public.entities e where e.id = c.id and e.type = c.kind)
  union all select 'curriculum row without registry row', 'ssc_topics',    c.id from public.ssc_topics c    where not exists (select 1 from public.entities e where e.id = c.id and e.type = c.kind)
  union all select 'curriculum row without registry row', 'ssc_subtopics', c.id from public.ssc_subtopics c where not exists (select 1 from public.entities e where e.id = c.id and e.type = c.kind)
  union all select 'curriculum row without registry row', 'pyqs',          c.id from public.pyqs c          where not exists (select 1 from public.entities e where e.id = c.id and e.type = c.kind)
$$;
revoke all on function public.entities_integrity_report() from public, anon, authenticated;
grant execute on function public.entities_integrity_report() to service_role;
