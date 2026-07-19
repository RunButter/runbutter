-- ============================================================================
-- RunButter — 0046_revoke_public_execute.sql
--
-- Closes the hole audit-security.sql surfaced: 29 SECURITY DEFINER functions
-- were executable by `anon`, including hr_overview_data(p_privy),
-- hr_update_candidate_status(p_privy, …), search_people(p_privy, …) and the
-- whole agents CRUD. DEFINER bypasses RLS, so anyone holding the public anon
-- key could call them straight against the Supabase REST endpoint with someone
-- else's Privy DID and read or modify that tenant's data — routing around the
-- /api/rpc proxy entirely. The proxy only ever protected the browser path.
--
-- Root cause: Postgres grants EXECUTE to PUBLIC on every new function. 0041 and
-- 0043 granted to service_role but never revoked that default, so the grant
-- stayed. 0044/0045 did revoke, which is why none of their functions were
-- exposed — this migration applies that same treatment retroactively, and by
-- iteration rather than by name so nothing is missed.
--
-- ⚠️ RUN ORDER — CHECK THIS FIRST OR THE APP GOES DOWN:
--   /api/rpc must be talking to Postgres as `service_role`. It falls back to the
--   anon key when SUPABASE_SERVICE_ROLE_KEY is unset (see app/api/rpc/route.ts),
--   and after this migration the anon key can no longer execute these functions
--   — every dashboard read would start failing. Confirm the env var is present
--   in Render (and locally) BEFORE running this. Same caveat 0042 carried.
--
-- Rollback if something breaks:
--   grant execute on function public.<name>(<args>) to anon, authenticated;
--
-- Idempotent and safe to re-run. Verify with supabase/audit-security.sql:
-- section B should afterwards list ONLY the keep_public functions below.
-- ============================================================================

do $$
declare
  r record;
  -- Genuinely public surfaces. Candidates and invoice/post recipients have no
  -- Privy session, so these must stay anon-callable. Each is either token-gated
  -- (a uuid/text secret the caller must already hold) or writes only its own row.
  keep_public text[] := array[
    'apply_to_position',            -- public job application
    'set_candidate_cv',             -- CV upload during apply (token-gated)
    'get_assessment_init_data',     -- assessment load (token-gated)
    'submit_assessment',            -- assessment submit (token-gated)
    'log_consent',                  -- GDPR consent during apply
    'register_link_click',          -- tracking-link click counter
    'company_can_accept_candidate', -- plan cap check in the apply flow
    'get_invoice_document_public',  -- shared invoice view (token-gated)
    'get_post_public',              -- shared post review (token-gated)
    'add_post_comment_public'       -- comment on a shared post (token-gated)
  ];
  n_revoked int := 0;
begin
  for r in
    select p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prosecdef                       -- DEFINER only: these bypass RLS
      and not (p.proname = any(keep_public))
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute'))
  loop
    -- Trigger functions are included deliberately. PostgreSQL does not check
    -- EXECUTE on a trigger function when the trigger fires, so revoking here
    -- hardens them without breaking the triggers that call them.
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated',
                   r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to service_role',
                   r.proname, r.args);
    n_revoked := n_revoked + 1;
  end loop;
  raise notice 'revoked public EXECUTE on % SECURITY DEFINER function(s)', n_revoked;
end $$;

-- ── Table grants: second layer behind RLS ───────────────────────────────────
-- Most tables sit at "RLS on, 0 policies", which already denies anon everything.
-- But the GRANT is still there, so the day someone adds a permissive policy or
-- flips RLS off, the data is immediately public. Drop the grant too, but ONLY
-- where there are no policies — tables that intentionally serve anon through a
-- policy (positions, contact_messages, consent_logs, tracking_links,
-- assessment_templates …) need to keep theirs or the public flows break.
do $$
declare r record; n int := 0;
begin
  for r in
    select c.oid, c.relname
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity
      and (select count(*) from pg_policies p
            where p.schemaname = 'public' and p.tablename = c.relname) = 0
      and (has_table_privilege('anon', c.oid, 'select')
        or has_table_privilege('authenticated', c.oid, 'select'))
  loop
    execute format('revoke all on table public.%I from anon, authenticated', r.relname);
    n := n + 1;
  end loop;
  raise notice 'revoked anon/authenticated grants on % zero-policy table(s)', n;
end $$;

notify pgrst, 'reload schema';
