-- ============================================================================
-- RunButter — 0051_active_workspace.sql
-- Gives a person an *active* workspace, so belonging to more than one stops
-- being ambiguous.
--
-- The two resolvers disagreed. get_my_workspace (0012) took
--     order by a.created_at limit 1     -> always your OLDEST workspace
-- while hr_company_id (0041) took
--     limit 1                           -> no ORDER BY, so genuinely arbitrary
--
-- Accept an invite while already owning a workspace and you kept landing back
-- in your original one; worse, the CRM could resolve to workspace A in the same
-- session that HR resolved to workspace B, because nothing tied the two
-- together. Data looked wrong long before anyone suspected why.
--
-- Both now read one stored choice, falling back to the oldest membership (and
-- self-healing if the stored workspace is one you have since left).
--
-- Additive & idempotent.
-- ============================================================================

create table if not exists user_settings (
  privy_user_id    text primary key,
  active_workspace uuid references workspaces(id) on delete set null,
  updated_at       timestamptz default now()
);
alter table user_settings enable row level security;   -- definer RPCs only
revoke all on table user_settings from anon, authenticated;

-- ── Which workspaces can I see? (drives the switcher) ───────────────────────
create or replace function list_my_workspaces(p_privy text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_active uuid;
begin
  select active_workspace into v_active from user_settings where privy_user_id = p_privy;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', ws.id, 'name', ws.name, 'slug', ws.slug, 'plan', ws.plan,
      'role', a.role, 'active', (ws.id = v_active)
    ) order by a.created_at)
    from accounts a join workspaces ws on ws.id = a.workspace_id
    where a.privy_user_id = p_privy
  ), '[]'::jsonb);
end $$;

-- ── Switch ──────────────────────────────────────────────────────────────────
create or replace function set_active_workspace(p_privy text, p_workspace uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  -- You can only make active a workspace you actually belong to.
  if not exists (select 1 from accounts
                  where privy_user_id = p_privy and workspace_id = p_workspace) then
    return false;
  end if;
  insert into user_settings (privy_user_id, active_workspace, updated_at)
  values (p_privy, p_workspace, now())
  on conflict (privy_user_id)
    do update set active_workspace = excluded.active_workspace, updated_at = now();
  return true;
end $$;

-- ── Single source of truth for "which workspace am I in" ────────────────────
-- Stored choice when it is still a live membership, else the oldest. Used by
-- both resolvers below so they can never disagree again.
create or replace function effective_workspace(p_privy text)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select us.active_workspace
       from user_settings us
       join accounts a on a.privy_user_id = us.privy_user_id
                      and a.workspace_id = us.active_workspace
      where us.privy_user_id = p_privy),
    (select a.workspace_id from accounts a
      where a.privy_user_id = p_privy
      order by a.created_at limit 1)
  );
$$;

create or replace function get_my_workspace(p_privy text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec record; v_ws uuid;
begin
  v_ws := effective_workspace(p_privy);
  if v_ws is null then return null; end if;
  select ws.id, ws.name, ws.slug, ws.plan, a.role into rec
  from accounts a join workspaces ws on ws.id = a.workspace_id
  where a.privy_user_id = p_privy and ws.id = v_ws;
  if rec.id is null then return null; end if;
  return jsonb_build_object('id', rec.id, 'name', rec.name, 'slug', rec.slug,
                            'plan', rec.plan, 'role', rec.role);
end $$;

-- The ATS half. workspace_id and company_id are the same uuid (see the 0005
-- sync trigger), so the same choice applies. Falls back to the oldest
-- membership — deterministically, unlike the bare `limit 1` it replaces.
create or replace function hr_company_id(p_privy text)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select cu.company_id from company_users cu
      where cu.privy_user_id = p_privy
        and cu.company_id = effective_workspace(p_privy)),
    (select cu.company_id from company_users cu
      where cu.privy_user_id = p_privy
      order by cu.created_at limit 1)
  );
$$;

-- ── Accepting an invite should land you in the workspace you just joined ────
create or replace function redeem_invite(p_token uuid, p_privy text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_company uuid; v_role text; v_name text;
begin
  if p_token is null or coalesce(trim(p_privy),'') = '' then
    return jsonb_build_object('ok', false, 'reason', 'missing_token');
  end if;

  select cu.id, cu.company_id, cu.role into v_id, v_company, v_role
  from company_users cu
  where cu.invite_token = p_token and cu.privy_user_id is null
  for update;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_used');
  end if;

  if exists (select 1 from company_users
              where company_id = v_company and privy_user_id = p_privy) then
    update company_users set invite_token = null where id = v_id;
    perform set_active_workspace(p_privy, v_company);   -- take them there anyway
    return jsonb_build_object('ok', true, 'already_member', true);
  end if;

  update company_users
     set privy_user_id = p_privy, invite_token = null
   where id = v_id;

  -- Make the newly joined workspace active, so someone who already had their
  -- own does not get dropped back into it and wonder where the invite went.
  perform set_active_workspace(p_privy, v_company);

  select name into v_name from companies where id = v_company;
  return jsonb_build_object('ok', true, 'company_id', v_company,
                            'company_name', v_name, 'role', v_role);
end $$;

-- ── Grants (0046 posture) ───────────────────────────────────────────────────
revoke all on function list_my_workspaces(text)          from public, anon, authenticated;
revoke all on function set_active_workspace(text, uuid)  from public, anon, authenticated;
revoke all on function effective_workspace(text)         from public, anon, authenticated;
revoke all on function get_my_workspace(text)            from public, anon, authenticated;
revoke all on function hr_company_id(text)               from public, anon, authenticated;
revoke all on function redeem_invite(uuid, text)         from public, anon, authenticated;
grant execute on function list_my_workspaces(text)         to service_role;
grant execute on function set_active_workspace(text, uuid) to service_role;
grant execute on function get_my_workspace(text)           to service_role;
grant execute on function redeem_invite(uuid, text)        to service_role;
-- effective_workspace / hr_company_id are internal helpers: no role needs
-- EXECUTE, the DEFINER functions that call them run as the owner.

notify pgrst, 'reload schema';
