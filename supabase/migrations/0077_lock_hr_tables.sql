-- ============================================================================
-- RunButter — 0077_lock_hr_tables.sql
-- Closes the anon read/write policies on the legacy ATS tables.
--
-- ⚠️ RUN ORDER — THIS ONE BREAKS THINGS IF RUN EARLY.
--   Run 0076 FIRST, and deploy the app carrying its client changes BEFORE
--   running this. Until that deploy is live, the browser still reads
--   `company_users` directly on the login, register, plans and team screens,
--   and this migration makes every one of those return nothing:
--     • login sends existing customers back through onboarding
--     • register cannot check a subdomain or create a company
--     • plans and team render empty
--   0076 is safe on its own and can sit in production indefinitely. This one is
--   the point of no return.
--
-- WHAT IT CLOSES. `company_users` was anon-WRITABLE. hr_company_id() resolved
-- from it alone, so inserting one row with your own Privy DID and someone
-- else's company id handed you their candidates, CVs, assessment results and
-- messages. `companies` being anon-readable supplied the ids. The anon key
-- ships in the browser bundle, so the whole chain needed nothing but a fetch.
--
-- 0076 already hardened hr_company_id to cross-check `accounts`, so the bypass
-- is dead either way. This removes the write primitive as well — defence in
-- depth, because a resolver is code and a policy is configuration, and the two
-- fail independently.
--
-- Same shape as 0042, which did this for the other legacy tables.
--
-- Rollback if something breaks:
--   create policy "tmp_anon_read" on public.<table> for select to anon using (true);
-- …then fix forward. Do not leave that policy in place.
-- ============================================================================

do $$
declare
  t text;
  p record;
  n_dropped int := 0;
  -- Every table the audit found with anon read+write. `positions` is included:
  -- the public job page reads it, but through get_careers_position /
  -- hr_list_positions_min server-side, never from the browser.
  targets text[] := array[
    'companies',
    'company_users',
    'assessment_templates',
    'candidate_messages',
    'consent_logs',
    'contact_messages',
    'message_templates',
    'positions',
    'tracking_links'
  ];
begin
  foreach t in array targets loop
    if to_regclass('public.' || t) is null then
      raise notice 'skip % (table not present)', t;
      continue;
    end if;

    -- Drop policies by iteration rather than by name: these were created across
    -- several migrations and by hand in the dashboard, so no fixed list of
    -- names is trustworthy.
    for p in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
      n_dropped := n_dropped + 1;
    end loop;

    -- RLS on with zero policies = nothing reaches it except service_role, which
    -- bypasses RLS entirely. That is what every other table in this schema does.
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);

    raise notice 'locked %', t;
  end loop;

  raise notice '--- dropped % policy(ies) across % table(s)', n_dropped, array_length(targets, 1);
end $$;

notify pgrst, 'reload schema';
