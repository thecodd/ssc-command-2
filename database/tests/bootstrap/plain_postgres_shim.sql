-- OPTIONAL bootstrap for a PLAIN PostgreSQL 15+ scratch database (i.e. NOT Supabase). Never apply it to a Supabase project: Supabase already provides all of this.
-- It supplies exactly what migrations 001-014 and the SQL test harness expect from Supabase and nothing else:
--   * roles anon / authenticated / service_role (NOLOGIN; the harness switches into them with SET LOCAL ROLE)
--   * schema auth with auth.users (id, aud, role, email) and auth.uid() / auth.role() reading the same GUCs PostgREST sets (request.jwt.claim.sub / request.jwt.claims)
--   * Supabase-like default privileges on schema public (new tables/functions/sequences are granted to the three roles; 004/014 then revoke what must not stay)
--   * pgcrypto/gen_random_uuid (built in since PG13) and pg_trgm availability is checked by the preflight (needs the postgresql-contrib package on some distros)
-- Idempotent. Applied by scripts/validate_phase7.mjs only with --shim-auth, and only to a database that passed the scratch-safety checks.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(), aud text, role text, email text, raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now());
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
