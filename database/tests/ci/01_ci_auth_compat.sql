-- Applied AFTER GoTrue has migrated the auth schema, BEFORE the validation kit. Makes auth.uid()/auth.role() read BOTH GUC styles, because PostgREST 12 sets only
-- request.jwt.claims while the SQL test harness sets request.jwt.claim.sub as well. CREATE OR REPLACE of the same signature; idempotent.
\set ON_ERROR_STOP on
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
