-- ============================================================================
-- audit-security.sql  —  READ ONLY. Paste the whole thing and hit Run.
--
-- ONE query on purpose: the Supabase SQL editor only returns the LAST result
-- set of a multi-statement script, so a split audit silently loses its most
-- important half. Everything below comes back as a single table.
--
-- Answers what an ERD cannot: *who can reach this data?* The anon key ships in
-- the browser bundle, so any table anon can SELECT is effectively public, and a
-- table with RLS off has no second line of defence.
--
-- Read the `verdict` column. Anything starting with "!!" is exposed data.
-- ============================================================================

with tables_audit as (
  select
    'A. table' as section,
    c.relname::text as name,
    (case when c.relrowsecurity then 'RLS on' else 'RLS OFF' end
      || ', ' || (select count(*) from pg_policies p
                   where p.schemaname = 'public' and p.tablename = c.relname)::text
      || ' policies')::text as detail,
    (case when has_table_privilege('anon', c.oid, 'select') then 'read' else '' end
      || case when has_table_privilege('anon', c.oid, 'insert')
                or has_table_privilege('anon', c.oid, 'update')
                or has_table_privilege('anon', c.oid, 'delete') then ' write' else '' end)::text as anon_can,
    (case when has_table_privilege('authenticated', c.oid, 'select') then 'read' else '' end)::text as auth_can,
    (case
      when (has_table_privilege('anon', c.oid, 'insert')
         or has_table_privilege('anon', c.oid, 'update')
         or has_table_privilege('anon', c.oid, 'delete')) and not c.relrowsecurity
        then '!! EXPOSED - anon can WRITE, no RLS'
      when has_table_privilege('anon', c.oid, 'select') and not c.relrowsecurity
        then '!! EXPOSED - anon can READ, no RLS'
      when has_table_privilege('anon', c.oid, 'select')
           and (select count(*) from pg_policies p
                 where p.schemaname = 'public' and p.tablename = c.relname) = 0
        then 'ok - granted but RLS denies all'
      when has_table_privilege('anon', c.oid, 'select')
        then 'REVIEW - anon reads via policy'
      when not c.relrowsecurity
        then 'ok - no anon grant (RLS off, definer/service_role only)'
      else 'ok - locked'
    end)::text as verdict,
    (case
      when (has_table_privilege('anon', c.oid, 'select')
         or has_table_privilege('anon', c.oid, 'insert')) and not c.relrowsecurity then 0
      when has_table_privilege('anon', c.oid, 'select') then 1
      else 2 end) as sort
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
funcs_audit as (
  -- Only the ones that are actually reachable without the service role.
  -- SECURITY DEFINER runs as the owner and bypasses RLS, so a DEFINER function
  -- anon can execute is a direct data path. A few are legitimate: the public
  -- apply / assessment flow (apply_to_position, set_candidate_cv, submit_*).
  select
    'B. function' as section,
    p.proname::text as name,
    (case when p.prosecdef then 'SECURITY DEFINER' else 'invoker' end
      || ' (' || left(pg_get_function_identity_arguments(p.oid), 60) || ')')::text as detail,
    (case when has_function_privilege('anon', p.oid, 'execute') then 'execute' else '' end)::text as anon_can,
    (case when has_function_privilege('authenticated', p.oid, 'execute') then 'execute' else '' end)::text as auth_can,
    (case
      when p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
        then '!! REVIEW - definer, callable by anon'
      when p.prosecdef
        then 'REVIEW - definer, callable by authenticated'
      else 'ok - invoker rights'
    end)::text as verdict,
    (case when has_function_privilege('anon', p.oid, 'execute') then 0 else 1 end) as sort
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef                      -- definer only; invoker funcs can't escalate
    and (has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute'))
)
select section, name, detail, anon_can, auth_can, verdict
from (select * from tables_audit union all select * from funcs_audit) x
order by section, sort, name;
