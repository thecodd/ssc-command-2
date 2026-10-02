-- CI / validation-stack bootstrap for a PLAIN PostgreSQL 15+ scratch database that will sit behind GoTrue + PostgREST (see docs/CI_PHASE7_GATE.md).
-- Run by scripts/ci/prepare_database.mjs as the database superuser, BEFORE GoTrue starts. NOT part of the migrations and never applied to Supabase.
-- psql variables: authenticator_password, auth_admin_password (the script passes them with -v; they are never echoed).
\set ON_ERROR_STOP on
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
select format('create role authenticator login noinherit password %L', :'authenticator_password') where not exists (select 1 from pg_roles where rolname = 'authenticator') \gexec
select format('alter role authenticator password %L', :'authenticator_password') \gexec
select format('create role supabase_auth_admin login noinherit createrole password %L', :'auth_admin_password') where not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') \gexec
select format('alter role supabase_auth_admin password %L', :'auth_admin_password') \gexec
grant anon, authenticated, service_role to authenticator;
select format('grant create on database %I to supabase_auth_admin', current_database()) \gexec
create schema if not exists auth authorization supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase-like default privileges for objects created later by this role (the migrations 004/014 then revoke what must not stay)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
-- PostgREST has no schema-change hook on plain Postgres: an event trigger tells it to reload its schema cache after every DDL statement.
-- Lives in its own schema (NOT public) so the security suite's "every function in public is classified" check stays meaningful.
create schema if not exists ci_support;
grant usage on schema ci_support to public;
create or replace function ci_support.notify_pgrst() returns event_trigger language plpgsql as $$ begin notify pgrst, 'reload schema'; end $$;
drop event trigger if exists ci_pgrst_watch;
create event trigger ci_pgrst_watch on ddl_command_end execute function ci_support.notify_pgrst();
