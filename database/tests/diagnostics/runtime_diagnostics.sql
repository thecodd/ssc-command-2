-- READ-ONLY runtime diagnostics for the scratch database (run by the validation kit after the SQL suites, whatever their result; output goes to logs/diagnostics.log).
-- It asserts nothing and changes nothing: it records the facts needed to diagnose a failing suite on a real PostgreSQL (which overload runs, volatility, who can execute,
-- what auth.uid() is, table privileges, default privileges). No passwords, tokens or secrets are printed.
\pset pager off
\pset null '(null)'
\echo '== D1 server / session'
select version() as version, current_user, session_user, current_setting('server_version_num') as server_version_num, current_database() as db;
\echo '== D2 roles (no passwords)'
select rolname, rolsuper, rolbypassrls, rolcanlogin, rolinherit from pg_roles where rolname in ('postgres', 'anon', 'authenticated', 'service_role', 'authenticator', 'supabase_auth_admin') order by 1;
\echo '== D3 every overload of the practice / revision / clock functions: volatility (v=volatile s=stable i=immutable), SECURITY DEFINER, STRICT, pinned config, who can EXECUTE'
select p.oid::regprocedure as function, p.prosecdef as definer, p.provolatile as vol, p.proisstrict as strict, p.proconfig as config, pg_get_userbyid(p.proowner) as owner,
       (select string_agg(r, ',' order by r) from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, p.oid, 'execute')) as can_execute,
       has_function_privilege('public', p.oid, 'execute') as public_can_execute
  from pg_proc p where p.pronamespace = 'public'::regnamespace
   and p.proname in ('practice_question', 'practice_state', 'practice_options', 'start_practice', 'submit_pyq_answer', 'finish_practice', 'schedule_revision', 'review_revision', 'revision_next', 'revision_queue',
                     '_ladder', 'user_today', 'app_now', 'set_progress', 'daily_focus', 'user_entity_signals', '_require_uid', 'is_admin')
 order by p.proname, p.oid;
\echo '== D4 functions with more than one overload (an old overload would run instead of the new one)'
select proname, count(*) as overloads, string_agg(oid::regprocedure::text, ' | ') as signatures from pg_proc where pronamespace = 'public'::regnamespace group by proname having count(*) > 1 order by 1;
\echo '== D5 auth.uid() / auth.role() as installed'
select p.oid::regprocedure as function, pg_get_userbyid(p.proowner) as owner, pg_get_functiondef(p.oid) as definition from pg_proc p where p.pronamespace = 'auth'::regnamespace and p.proname in ('uid', 'role') order by 1;
\echo '== D6 table privileges of anon / authenticated (any of select, insert, update, delete, truncate, references, trigger), public schema'
select c.relname, c.relrowsecurity as rls,
       (select string_agg(p, ',' order by p) from unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p where has_table_privilege('authenticated', c.oid, p)) as authenticated_has,
       (select string_agg(p, ',' order by p) from unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p where has_table_privilege('anon', c.oid, p)) as anon_has
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by 1;
\echo '== D7 column-level SELECT grants on pyqs for authenticated (the answer key must be absent)'
select a.attname, has_column_privilege('authenticated', 'public.pyqs'::regclass, a.attname, 'select') as can_select from pg_attribute a where a.attrelid = 'public.pyqs'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum;
\echo '== D8 default privileges (ALTER DEFAULT PRIVILEGES) in schema public'
select pg_get_userbyid(d.defaclrole) as for_role, d.defaclobjtype as objtype, d.defaclacl from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'public' order by 1, 2;
\echo '== D9 policies on the curriculum / custom-content tables'
select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename in ('chapters', 'pyqs', 'ssc_topics', 'practice_sessions', 'pyq_attempts', 'revision_schedule', 'revision_reviews') order by tablename, policyname;
\echo '== D10 triggers on revision / progress / chapters / pyqs'
select c.relname as table_name, t.tgname, pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname in ('revision_schedule', 'revision_reviews', 'user_progress', 'chapters', 'pyqs') order by 1, 2;
\echo '== D11 pure arithmetic: revision_next on the default and the custom ladder (the preview that PASSES in the suites)'
select 'default 1,3,7,15,30 step1 good' as probe, step, graduated, interval_days, due_date from public.revision_next(1, 'good', '{1,3,7,15,30}', date '2026-10-01')
union all select 'custom 2,5,20 step1 good', step, graduated, interval_days, due_date from public.revision_next(1, 'good', '{2,5,20}', date '2026-10-01')
union all select 'custom 2,5,20 step2 hard', step, graduated, interval_days, due_date from public.revision_next(2, 'hard', '{2,5,20}', date '2026-10-01');
