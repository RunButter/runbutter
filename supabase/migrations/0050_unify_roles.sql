-- ============================================================================
-- RunButter — 0050_unify_roles.sql
-- Reconciles the two role vocabularies that had drifted apart.
--
-- company_users (the ATS side, from the base schema) allowed:
--     owner | admin | recruiter | viewer
-- accounts / set_member_role (the workspace side, 0012) allowed:
--     owner | admin | member
--
-- Nothing translated between them. The 0005 sync trigger copies the role
-- verbatim, so a 'recruiter' became a 'recruiter' in accounts even though
-- set_member_role would refuse to set that value — and inviting someone as
-- 'member' failed outright with
--     violates check constraint "company_users_role_check"
-- because the ATS table had never heard of 'member'.
--
-- Rather than translate in both directions forever, both sides now accept the
-- union. Existing rows stay valid (it is a widening), the trigger's verbatim
-- copy becomes correct by construction, and either screen can manage anyone.
--
--   owner     — full control, including billing
--   admin     — manage members, settings and all records
--   member    — general access (the workspace default)
--   recruiter — ATS-focused member; kept for existing HR teams
--   viewer    — read-only
--
-- Additive & idempotent.
-- ============================================================================

do $$
begin
  alter table company_users drop constraint if exists company_users_role_check;
  alter table company_users add constraint company_users_role_check
    check (role in ('owner','admin','member','recruiter','viewer'));
exception when others then
  raise notice 'company_users role check not updated: %', sqlerrm;
end $$;

-- accounts has no check constraint, but keep the default sane for new rows.
alter table accounts alter column role set default 'member';

-- set_member_role must accept the same set, or a recruiter/viewer could be
-- listed but never re-assigned.
create or replace function set_member_role(p_privy text, p_workspace uuid, p_account uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare my_role text;
begin
  if p_role not in ('owner','admin','member','recruiter','viewer') then
    raise exception 'INVALID_ROLE';
  end if;
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

  -- Keep the ATS half in step, otherwise HR permissions silently diverge from
  -- what the members screen shows.
  update company_users cu
     set role = p_role
    from accounts a
   where a.id = p_account and a.workspace_id = p_workspace
     and cu.company_id = p_workspace and cu.privy_user_id = a.privy_user_id;
end $$;
revoke all on function set_member_role(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function set_member_role(text, uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
