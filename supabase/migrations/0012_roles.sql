-- ============================================================================
-- RunButter Platform Core — 0012_roles.sql
-- Roles & permissions per workspace member (owner | admin | member).
-- - owner/admin: full access incl. delete + manage members
-- - member: create/edit, but cannot delete records or manage members
-- Additive & prod-safe. Depends on 0001–0011.
-- ============================================================================

create or replace function workspace_role(p_privy text, p_workspace uuid)
returns text language sql stable as $$
  select role from accounts where workspace_id = p_workspace and privy_user_id = p_privy limit 1;
$$;

-- include the caller's role in the workspace bootstrap
create or replace function get_my_workspace(p_privy text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec record;
begin
  select ws.id, ws.name, ws.slug, ws.plan, a.role into rec
  from accounts a join workspaces ws on ws.id = a.workspace_id
  where a.privy_user_id = p_privy order by a.created_at limit 1;
  if rec.id is null then return null; end if;
  return jsonb_build_object('id', rec.id, 'name', rec.name, 'slug', rec.slug, 'plan', rec.plan, 'role', rec.role);
end $$;
grant execute on function get_my_workspace(text) to authenticated, anon;

create or replace function get_members(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', coalesce(nullif(a.full_name,''), a.email), 'email', a.email,
    'role', a.role, 'privy_user_id', a.privy_user_id
  ) order by case a.role when 'owner' then 0 when 'admin' then 1 else 2 end, a.created_at)
  from accounts a where a.workspace_id = p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_members(text, uuid) to authenticated, anon;

create or replace function set_member_role(p_privy text, p_workspace uuid, p_account uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare my_role text;
begin
  if p_role not in ('owner', 'admin', 'member') then raise exception 'INVALID_ROLE'; end if;
  my_role := workspace_role(p_privy, p_workspace);
  if my_role is null or my_role not in ('owner', 'admin') then raise exception 'FORBIDDEN'; end if;
  if p_role = 'owner' and my_role <> 'owner' then raise exception 'ONLY_OWNER_CAN_GRANT_OWNER'; end if;
  -- never demote the last remaining owner
  if exists (select 1 from accounts where id = p_account and workspace_id = p_workspace and role = 'owner')
     and p_role <> 'owner'
     and (select count(*) from accounts where workspace_id = p_workspace and role = 'owner') <= 1 then
    raise exception 'CANNOT_REMOVE_LAST_OWNER';
  end if;
  update accounts set role = p_role where id = p_account and workspace_id = p_workspace;
end $$;
grant execute on function set_member_role(text, uuid, uuid, text) to authenticated, anon;

-- delete now requires owner/admin (members can create/edit, not delete)
create or replace function delete_record(p_privy text, p_object text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tbl text; v_ws uuid;
begin
  tbl := case p_object
    when 'companies' then 'organizations' when 'organizations' then 'organizations'
    when 'people' then 'people' when 'invoices' then 'invoices' when 'expenses' then 'expenses'
    when 'products' then 'products'
    when 'projects' then 'projects' when 'issues' then 'issues' when 'assets' then 'assets'
    else null end;
  if tbl is null then raise exception 'UNKNOWN_OBJECT: %', p_object; end if;
  execute format('select workspace_id from %I where id = $1', tbl) into v_ws using p_id;
  if v_ws is null then return; end if;
  if not is_workspace_member(v_ws, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if workspace_role(p_privy, v_ws) not in ('owner', 'admin') then raise exception 'FORBIDDEN: delete requires admin'; end if;
  execute format('delete from %I where id = $1 and workspace_id = $2', tbl) using p_id, v_ws;
end $$;
grant execute on function delete_record(text, text, uuid) to authenticated, anon;

notify pgrst, 'reload schema';
