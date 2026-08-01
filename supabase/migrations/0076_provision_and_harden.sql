-- ============================================================================
-- RunButter — 0076_provision_and_harden.sql
-- Closes the tenant-isolation bypass on the HR half, in the only order that
-- works: give the browser server-side replacements FIRST. The actual table lock
-- is 0077, run after the app carrying these changes is deployed.
--
-- THE BYPASS, precisely, because it is worth writing down:
--   1. `companies` is anon-readable  → anyone gets any company's id
--   2. `company_users` is anon-WRITABLE → insert (privy_user_id = mine,
--      company_id = theirs)
--   3. hr_company_id(p_privy) resolves PURELY from company_users (0051)
--   4. hr_overview_data / hr_analytics_data / candidate reads all call
--      hr_company_id() and then serve that company's candidates, CVs,
--      assessment results and messages
-- The anon key ships in the browser bundle by design, so steps 1-2 need nothing
-- but a fetch. The CRM half was never affected: is_workspace_member reads
-- `accounts`, which has always been locked.
--
-- This migration does three things:
--   A. ensure_workspace()   — server-side, Privy-verified provisioning, so
--      onboarding stops needing anon INSERT on companies/company_users.
--   B. get_my_hr_companies()— the read the browser needs for login/plans/team.
--   C. hr_company_id()      — hardened to cross-check `accounts`, so a stray
--      company_users row grants nothing even if one is ever written again.
--
-- C is the important one. A and B remove the *need* for the open policies; C
-- means the exploit fails even while they are still open, and keeps failing if
-- a policy is ever re-added by mistake. Defence in depth, not belt-and-braces:
-- 0077 is a policy change, and policies are exactly the thing that gets
-- reinstated by an unrelated migration a year from now.
--
-- Additive, idempotent & prod-safe. Safe to run BEFORE deploying the app.
-- ============================================================================

-- ── A. Server-side provisioning ──────────────────────────────────────────────
/**
 * Create a company + owner membership + default assessment template, atomically.
 *
 * Replaces three separate client-side anon INSERTs in app/auth/register. Beyond
 * closing the write path, this fixes the silent-failure mode that made
 * onboarding fragile: the old flow could create the company, fail on the
 * membership, and leave someone signed in with no workspace and no error worth
 * showing. One function in one transaction cannot half-succeed.
 *
 * Idempotent by design: if this Privy user already has a company, return it
 * rather than making a second one. A double-submitted registration form used to
 * produce two companies.
 */
create or replace function ensure_workspace(
  p_privy text, p_company_name text, p_subdomain text, p_email text, p_full_name text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_sub text; v_existing uuid;
begin
  if coalesce(trim(p_privy), '') = '' then raise exception 'NO_IDENTITY'; end if;

  -- Already provisioned? Hand back what they have. ORDER BY created_at, not
  -- limit(1) alone: someone in two companies must get a STABLE answer, and an
  -- unordered limit returns an arbitrary row (the bug 0051 documents).
  select cu.company_id into v_existing
    from company_users cu where cu.privy_user_id = p_privy
   order by cu.created_at limit 1;
  if v_existing is not null then
    return jsonb_build_object('company_id', v_existing, 'created', false);
  end if;

  v_sub := lower(regexp_replace(coalesce(p_subdomain, ''), '[^a-zA-Z0-9-]', '', 'g'));
  if length(v_sub) < 2 then raise exception 'BAD_SUBDOMAIN'; end if;
  if exists (select 1 from companies where subdomain = v_sub) then raise exception 'SUBDOMAIN_TAKEN'; end if;

  insert into companies (name, subdomain, plan)
  values (coalesce(nullif(trim(p_company_name), ''), 'My company'), v_sub, 'free')
  returning id into v_company;

  insert into company_users (company_id, email, full_name, role, privy_user_id)
  values (v_company, coalesce(p_email, ''), coalesce(nullif(trim(p_full_name), ''), 'User'), 'owner', p_privy);

  insert into assessment_templates (company_id, name, description, questions, is_default)
  values (v_company, 'Default Assessment',
          'Standard personality and work style assessment',
          '[{"id":"1","category":"personality","trait":"Extraversion","text":"I enjoy being the center of attention","type":"scale","options":["Strongly Disagree","Disagree","Neutral","Agree","Strongly Agree"]},
            {"id":"2","category":"work_style","text":"I prefer to:","type":"choice","options":["Work independently","Work in teams","Mix of both"]}]'::jsonb,
          true);

  -- The 0005 trigger mirrors companies -> workspaces and creates the accounts
  -- row. It is exception-safe, so verify rather than assume: without an accounts
  -- row the CRM half sees no workspace at all, which is the silent failure this
  -- function exists to end.
  if not exists (select 1 from accounts where workspace_id = v_company and privy_user_id = p_privy) then
    insert into accounts (workspace_id, privy_user_id, role)
    values (v_company, p_privy, 'owner')
    on conflict do nothing;
  end if;

  return jsonb_build_object('company_id', v_company, 'created', true);
end $$;
revoke all on function ensure_workspace(text, text, text, text, text) from public, anon, authenticated;
grant execute on function ensure_workspace(text, text, text, text, text) to service_role;

/** Is this subdomain free? Read-only, so the register form can check as you type. */
create or replace function subdomain_available(p_subdomain text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from companies
     where subdomain = lower(regexp_replace(coalesce(p_subdomain,''), '[^a-zA-Z0-9-]', '', 'g'))
  );
$$;
revoke all on function subdomain_available(text) from public, anon, authenticated;
grant execute on function subdomain_available(text) to service_role;

-- ── B. The read the browser still needs ──────────────────────────────────────
/**
 * Which HR companies does this user belong to? Replaces four direct
 * `.from('company_users')` reads in the browser (login, plans, team, register).
 *
 * Returns only the caller's OWN memberships — p_privy is overwritten by the
 * /api/rpc proxy from the verified token, so it cannot be used to enumerate
 * anyone else's.
 */
create or replace function get_my_hr_companies(p_privy text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_privy), '') = '' then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (
    select cu.company_id, cu.role, cu.full_name, cu.email, cu.created_at,
           c.name as company_name, c.plan, c.subdomain
      from company_users cu
      join companies c on c.id = cu.company_id
     where cu.privy_user_id = p_privy
  ) x), '[]'::jsonb);
end $$;
grant execute on function get_my_hr_companies(text) to authenticated, anon;

-- ── C. Harden the resolver ───────────────────────────────────────────────────
/**
 * hr_company_id, redefined IN FULL with an `accounts` cross-check.
 *
 * 0051's version trusted company_users alone. That is what turned an anon INSERT
 * into full read access over another tenant's candidates. Requiring a matching
 * `accounts` row — a table that has always been locked and is only written by
 * the 0005 trigger and ensure_workspace — means a forged company_users row
 * resolves to NULL and every HR RPC returns nothing.
 *
 * Same resolution ORDER as before, so behaviour is unchanged for real members:
 * the active workspace first, else the OLDEST membership.
 */
create or replace function hr_company_id(p_privy text)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select cu.company_id from company_users cu
      where cu.privy_user_id = p_privy
        and cu.company_id = effective_workspace(p_privy)
        and exists (select 1 from accounts a
                     where a.workspace_id = cu.company_id and a.privy_user_id = p_privy)),
    (select cu.company_id from company_users cu
      where cu.privy_user_id = p_privy
        and exists (select 1 from accounts a
                     where a.workspace_id = cu.company_id and a.privy_user_id = p_privy)
      order by cu.created_at limit 1)
  );
$$;

/**
 * redeem_invite, redefined IN FULL to also create the accounts row.
 *
 * This is a latent bug the hardening above exposed: 0051's version sets
 * company_users.privy_user_id and calls set_active_workspace (which writes
 * user_settings), but never touches `accounts`. So every INVITED team member
 * has had a company_users row with no accounts row — and the hardened resolver
 * would have locked all of them out.
 *
 * Fixing it here rather than only backfilling matters: a backfill closes the
 * gap for people who joined before today, and this closes it for everyone who
 * joins after.
 */
create or replace function redeem_invite(p_token uuid, p_privy text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_company uuid; v_role text; v_name text;
begin
  if p_token is null or coalesce(trim(p_privy),'') = '' then
    return jsonb_build_object('ok', false, 'reason', 'missing_token');
  end if;

  select cu.id, cu.company_id, cu.role into v_id, v_company, v_role
    from company_users cu
   where cu.invite_token = p_token
   limit 1;
  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_used');
  end if;

  if exists (select 1 from company_users
              where company_id = v_company and privy_user_id = p_privy) then
    update company_users set invite_token = null where id = v_id;
    perform set_active_workspace(p_privy, v_company);
    -- Even the already-a-member path repairs the accounts row, so an invite
    -- re-clicked by an existing member fixes them rather than doing nothing.
    insert into accounts (workspace_id, privy_user_id, role)
    values (v_company, p_privy, case when v_role in ('owner','admin') then v_role else 'member' end)
    on conflict do nothing;
    return jsonb_build_object('ok', true, 'already_member', true);
  end if;

  update company_users
     set privy_user_id = p_privy, invite_token = null
   where id = v_id;

  -- THE ADDITION. Without this the invitee has no accounts row, so the CRM half
  -- sees no workspace for them and the hardened hr_company_id returns null.
  insert into accounts (workspace_id, privy_user_id, role)
  values (v_company, p_privy, case when v_role in ('owner','admin') then v_role else 'member' end)
  on conflict do nothing;

  perform set_active_workspace(p_privy, v_company);

  select name into v_name from companies where id = v_company;
  return jsonb_build_object('ok', true, 'company_id', v_company,
                            'company_name', v_name, 'role', v_role);
end $$;
revoke all on function redeem_invite(uuid, text) from public, anon, authenticated;
grant execute on function redeem_invite(uuid, text) to service_role;

/**
 * Backfill, and REPORT what it did.
 *
 * Every legitimate member who predates the fix above needs an accounts row, or
 * the hardened resolver locks them out — a real customer losing access is a far
 * worse outcome than the bypass this migration closes.
 *
 * But there is no way to tell a legitimate historical row from a FORGED one:
 * company_users has been anon-writable for the life of the product, and a forged
 * row looks exactly like an invited one. Backfilling grants both.
 *
 * So this does not pretend to decide. It backfills (nobody is locked out) and
 * RAISES A NOTICE naming every workspace/user pair it touched. Read that list:
 * a privy_user_id you do not recognise against a company you own is an intruder
 * who was already inside, and the fix is to delete that company_users row —
 * which 0077 then makes impossible to recreate.
 */
do $$
declare r record; n int := 0;
begin
  for r in
    select cu.company_id, cu.privy_user_id, cu.email, cu.role, cu.created_at
      from company_users cu
      join workspaces w on w.id = cu.company_id
     where cu.privy_user_id is not null
       and not exists (select 1 from accounts a
                        where a.workspace_id = cu.company_id and a.privy_user_id = cu.privy_user_id)
     order by cu.company_id, cu.created_at
  loop
    insert into accounts (workspace_id, privy_user_id, role)
    values (r.company_id, r.privy_user_id,
            case when r.role in ('owner','admin') then r.role else 'member' end)
    on conflict do nothing;
    raise notice 'BACKFILLED workspace=% privy=% email=% role=% joined=%',
      r.company_id, r.privy_user_id, r.email, r.role, r.created_at;
    n := n + 1;
  end loop;
  raise notice '--- backfilled % account row(s). REVIEW the list above for identities you do not recognise.', n;
end $$;

notify pgrst, 'reload schema';
