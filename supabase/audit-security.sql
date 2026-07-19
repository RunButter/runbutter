-- ============================================================================
-- audit-security.sql  —  READ ONLY. Paste into the Supabase SQL editor.
--
-- Answers the question an ERD cannot: *who can reach this data?* The anon key
-- ships in the browser bundle, so any table `anon` can SELECT is effectively
-- public, and any table with RLS off has no second line of defence.
--
-- Part A — table exposure     (look for rows flagged EXPOSED / REVIEW)
-- Part B — function exposure  (SECURITY DEFINER functions anon may execute)
-- Part C — tables with RLS on but zero policies (locked, usually intentional)
-- ============================================================================

-- ── Part A: which tables can the browser's keys reach? ──────────────────────
select
  c.relname                                                        as table_name,
  case when c.relrowsecurity then 'on' else 'OFF' end              as rls,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname)     as policies,
  case when has_table_privilege('anon', c.oid, 'select') then 'yes' else '-' end          as anon_read,
  case when has_table_privilege('anon', c.oid, 'insert')
         or has_table_privilege('anon', c.oid, 'update')
         or has_table_privilege('anon', c.oid, 'delete') then 'yes' else '-' end          as anon_write,
  case when has_table_privilege('authenticated', c.oid, 'select') then 'yes' else '-' end as auth_read,
  case
    when has_table_privilege('anon', c.oid, 'select') and not c.relrowsecurity
      then '!! EXPOSED - anon can read, no RLS'
    when (has_table_privilege('anon', c.oid, 'insert')
       or has_table_privilege('anon', c.oid, 'update')
       or has_table_privilege('anon', c.oid, 'delete')) and not c.relrowsecurity
      then '!! EXPOSED - anon can write, no RLS'
    when has_table_privilege('anon', c.oid, 'select') and c.relrowsecurity
         and (select count(*) from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname) = 0
      then 'ok - granted but RLS denies all'
    when has_table_privilege('anon', c.oid, 'select')
      then 'REVIEW - anon reads via policy'
    else 'ok - not reachable by anon'
  end                                                              as verdict
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by
  (has_table_privilege('anon', c.oid, 'select')
   or has_table_privilege('anon', c.oid, 'insert'))::int desc,
  c.relrowsecurity::int,
  c.relname;

-- ── Part B: which functions can anon execute? ───────────────────────────────
-- SECURITY DEFINER functions run as their owner and bypass RLS, so an
-- anon-executable one is a direct data path. The public apply/assessment flow
-- legitimately needs a few (apply_to_position, set_candidate_cv, submit_*).
-- Anything else showing up here deserves a second look.
select
  p.proname                                              as function_name,
  pg_get_function_identity_arguments(p.oid)              as arguments,
  case when p.prosecdef then 'DEFINER' else 'invoker' end as runs_as,
  case when has_function_privilege('anon', p.oid, 'execute') then 'yes' else '-' end           as anon,
  case when has_function_privilege('authenticated', p.oid, 'execute') then 'yes' else '-' end  as authenticated
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (has_function_privilege('anon', p.oid, 'execute')
    or has_function_privilege('authenticated', p.oid, 'execute'))
order by p.prosecdef desc, p.proname;

-- ── Part C: RLS on, no policies (= deny all except definer/service_role) ────
-- This is the intended end state for the locked ATS tables (migration 0042):
-- nothing reaches them except SECURITY DEFINER RPCs and the service role.
select c.relname as table_name, 'RLS on, 0 policies - deny all' as note
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  and (select count(*) from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname) = 0
order by c.relname;
