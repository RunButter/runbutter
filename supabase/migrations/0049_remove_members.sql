-- ============================================================================
-- RunButter — 0049_remove_members.sql
-- Adds member removal, and makes pending invites visible so they can be revoked.
--
-- Two gaps this closes:
--
--  1. get_members read only from `accounts`. The 0005 trigger copies a
--     company_users row into accounts ONLY when privy_user_id is set, and an
--     invite starts life with that null — so an invited-but-not-yet-joined
--     person appeared nowhere in the UI. You could not see who you had invited,
--     let alone cancel it. Pending invites are now returned alongside members
--     with pending=true.
--
--  2. There was no removal RPC at all. The legacy /dashboard/team page deleted
--     straight from company_users with the browser's key, which is exactly the
--     direct-table access 0040–0046 spent their time closing, and it only
--     touched company_users — leaving the `accounts` row behind, so the person
--     kept workspace access.
--
-- remove_member deletes BOTH rows. Membership lives in two tables (accounts for
-- the workspace, company_users for the legacy ATS side, sharing one id), and
-- removing only one leaves the person with half their access — HR data in
-- particular resolves through company_users.
--
-- Guards: owner/admin only; nobody can remove themselves (use a second admin,
-- so a workspace cannot be orphaned by accident); only an owner can remove
-- another owner; the last owner can never be removed.
--
-- Additive & idempotent. Depends on 0012 (workspace_role) and 0048.
-- ============================================================================

-- ── Members list now includes pending invites ───────────────────────────────
create or replace function get_members(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_agg(r order by sort, created_at)
    from (
      -- joined members
      select jsonb_build_object(
               'id', a.id,
               'name', coalesce(nullif(a.full_name,''), a.email),
               'email', a.email,
               'role', a.role,
               'privy_user_id', a.privy_user_id,
               'pending', false
             ) as r,
             case a.role when 'owner' then 0 when 'admin' then 1 else 2 end as sort,
             a.created_at
      from accounts a
      where a.workspace_id = p_workspace

      union all

      -- invited, not yet accepted (never reaches `accounts` until redeemed)
      select jsonb_build_object(
               'id', cu.id,
               'name', coalesce(nullif(cu.full_name,''), cu.email),
               'email', cu.email,
               'role', cu.role,
               'privy_user_id', null,
               'pending', true,
               'invited_at', cu.invited_at
             ) as r,
             3 as sort,
             cu.created_at
      from company_users cu
      where cu.company_id = p_workspace and cu.privy_user_id is null
    ) s
  ), '[]'::jsonb);
end $$;

-- ── Remove a member, or revoke a pending invite ─────────────────────────────
create or replace function remove_member(p_privy text, p_workspace uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  my_role      text;
  v_privy      text;
  v_role       text;
  v_is_member  boolean;
  v_n          int;
begin
  my_role := workspace_role(p_privy, p_workspace);
  if my_role is null or my_role not in ('owner','admin') then
    raise exception 'FORBIDDEN';
  end if;

  -- p_id may be an accounts.id (the CRM members screen) or a company_users.id
  -- (the legacy HR team screen). Resolve either to the same person rather than
  -- forcing both callers onto one table's ids.
  select a.privy_user_id, a.role, true
    into v_privy, v_role, v_is_member
  from accounts a
  where a.id = p_id and a.workspace_id = p_workspace;

  if not coalesce(v_is_member, false) then
    select cu.privy_user_id, cu.role, cu.privy_user_id is not null
      into v_privy, v_role, v_is_member
    from company_users cu
    where cu.id = p_id and cu.company_id = p_workspace;
  end if;

  if coalesce(v_is_member, false) then
    -- Removing yourself is blocked: an admin who does it by accident locks the
    -- workspace's own team screen away from them. Have another admin do it.
    if v_privy = p_privy then raise exception 'CANNOT_REMOVE_SELF'; end if;

    if v_role = 'owner' then
      if my_role <> 'owner' then raise exception 'ONLY_OWNER_CAN_REMOVE_OWNER'; end if;
      if (select count(*) from accounts
           where workspace_id = p_workspace and role = 'owner') <= 1 then
        raise exception 'CANNOT_REMOVE_LAST_OWNER';
      end if;
    end if;

    -- Delete by privy id, not by p_id, so both halves go regardless of which
    -- table the caller identified them from.
    delete from accounts
     where workspace_id = p_workspace and privy_user_id = v_privy;
    -- The legacy half. Without this they keep HR/ATS access, which resolves
    -- through company_users rather than accounts.
    delete from company_users
     where company_id = p_workspace and privy_user_id = v_privy;

    return jsonb_build_object('ok', true, 'kind', 'member');
  end if;

  -- Otherwise: a pending invite, identified by its company_users id.
  delete from company_users
   where id = p_id and company_id = p_workspace and privy_user_id is null;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    return jsonb_build_object('ok', true, 'kind', 'invite');
  end if;

  return jsonb_build_object('ok', false, 'reason', 'not_found');
end $$;

-- ── Grants (0046 posture: reachable only through the verified proxy) ────────
revoke all on function get_members(text, uuid)           from public, anon, authenticated;
revoke all on function remove_member(text, uuid, uuid)   from public, anon, authenticated;
grant execute on function get_members(text, uuid)         to service_role;
grant execute on function remove_member(text, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
