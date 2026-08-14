-- ============================================================================
-- RunButter — 0105_revoke_public_execute_again.sql
--
-- 0046 closed this hole. Every migration written since re-opened it, one
-- function at a time, and nothing noticed for fifty-nine migrations.
--
-- WHAT WENT WRONG
--   Postgres grants EXECUTE to PUBLIC on every new function. 0046 revoked that
--   from `public, anon, authenticated` and granted `service_role` instead —
--   correctly, and by iteration so nothing was missed. But it fixed the
--   FUNCTIONS THAT EXISTED IN 0046, not the convention. From 0047 onward the
--   house style became
--       grant execute on function <name>(...) to authenticated, anon;
--   which is what 0104 still does. That line is not merely redundant with the
--   PUBLIC default — it re-states it explicitly, so every function added after
--   0046 shipped anon-callable.
--
--   Measured against production on 2026-08-14: 69 SECURITY DEFINER functions
--   were executable by `anon`. DEFINER bypasses RLS, and the anon key is public
--   by construction (NEXT_PUBLIC_SUPABASE_ANON_KEY ships in the browser bundle),
--   so each one was reachable straight against the Supabase REST endpoint,
--   routing around /api/rpc exactly as 0046 describes.
--
--   Among them: the whole CRUD monolith (list/get/create/update/delete_record),
--   create_api_key, get_api_keys, rename_workspace, save_agent,
--   save_custom_object, oauth_revoke_grant, post_message, save_doc.
--   Most authorize on the p_privy the CALLER supplies, so the barrier is
--   knowing a member's Privy DID and a workspace uuid — identifiers, not
--   credentials. That is the same barrier 0046 judged insufficient.
--
--   THREE ARE WORSE, because they take no p_privy and authorize nothing:
--     • builtin_extras_write(p_workspace, p_object, p_id, p_data, p_partial)
--       trusts p_workspace from its caller and runs
--         update <table> set custom_fields = custom_fields || $1
--          where id = $2 and workspace_id = $3
--       That trust is correct for an INTERNAL helper — create_record validated
--       the workspace before calling it — and is a cross-tenant write primitive
--       the moment anon can call it directly.
--     • builtin_extras_add(p_object, p_id, p_row) reads workspace_id and
--       custom_fields off any row by id and returns the extras merged in, so it
--       reads another tenant's custom fields with no argument but the record id.
--     • builtin_extras_addmany, same shape in bulk.
--   These are gated only by uuid unguessability, which is not authorization:
--   record ids travel in URLs, CSV exports, agent transcripts and screenshots.
--
-- WHY A SWEEP RATHER THAN EDITING THE OFFENDING MIGRATIONS
--   0047–0104 have already run on production and on every self-hosted install.
--   Editing their grant lines would fix a fresh `npm run migrate` and leave
--   every existing database untouched. A sweep that runs LAST fixes both, and
--   re-running it is free — which is what makes it safe to keep re-applying as
--   the convention keeps slipping.
--
-- ⚠️ RUN ORDER — SAME CAVEAT 0046 CARRIED, CHECK IT FIRST:
--   /api/rpc must be talking to Postgres as `service_role`. It falls back to the
--   anon key when SUPABASE_SERVICE_ROLE_KEY is unset (app/api/rpc/route.ts), and
--   after this migration the anon key can no longer execute these functions —
--   every dashboard read would start failing. 0046 already shipped, so this is
--   true today; confirm it is still true before running.
--
-- Rollback for one function if a public flow turns out to need it:
--   grant execute on function public.<name>(<args>) to anon;
--   …and add it to keep_public below, or the next run takes it away again.
--
-- Idempotent. Verify with supabase/audit-security.sql — section B should list
-- ONLY the keep_public names afterwards.
-- ============================================================================

do $$
declare
  r record;
  -- Genuinely public surfaces: callers with no Privy session, talking to
  -- Postgres with the anon key through the direct supabase client rather than
  -- through /api/rpc. Each is token-gated (the caller must already hold a uuid
  -- or secret) or writes only its own row.
  --
  -- Verified against the repo by finding every `.rpc(` callsite that is NOT
  -- lib/rpc.ts (the proxy) and NOT a server route holding the admin client.
  keep_public text[] := array[
    -- 0046's original list, unchanged.
    'apply_to_position',            -- public job application
    'set_candidate_cv',             -- CV upload during apply (token-gated)
    'get_assessment_init_data',     -- assessment load (token-gated)
    'submit_assessment',            -- assessment submit (token-gated)
    'log_consent',                  -- GDPR consent during apply
    'register_link_click',          -- tracking-link click counter
    'company_can_accept_candidate', -- plan cap check in the apply flow
    'get_invoice_document_public',  -- shared invoice view (token-gated)
    'get_post_public',              -- shared post review (token-gated)
    'add_post_comment_public',      -- comment on a shared post (token-gated)

    -- ADDED HERE. app/apply/[positionId]/page.tsx and its assessment page call
    -- this on the direct supabase client, before anyone has signed in — it is
    -- what puts the employer's logo and colours on the application form. It
    -- postdates 0046, so 0046's list could not have known about it, and
    -- sweeping it away would break the apply flow for every candidate.
    'get_apply_branding',

    -- Also public, and listed so a future migration that makes one of them
    -- SECURITY DEFINER does not silently break the page. They are no-ops today:
    -- the loop below only touches functions that are DEFINER *and* currently
    -- granted, and these are neither.
    'get_careers_page',             -- /careers/<slug>
    'get_careers_position',         -- /careers/<slug>/<positionId>
    'get_public_form',              -- /f/<slug>
    'submit_form',                  -- /f/<slug> submit
    'get_sign_request',             -- /sign/<token>
    'get_invite_by_token',          -- /auth/accept
    'newsletter_confirm',           -- double opt-in link
    'newsletter_unsubscribe',       -- unsubscribe link
    'register_short_click'          -- /l/<code>
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

notify pgrst, 'reload schema';
