-- ============================================================================
-- HireBTR Platform Core — 0030_site_management.sql
-- Remove a tracked website (owner/admin only). site_events cascade-delete via
-- the FK. Additive & prod-safe. Depends on 0027. Run AFTER it.
-- ============================================================================

create or replace function delete_site(p_privy text, p_site uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from sites where id = p_site;
  if v_ws is null then return; end if;
  if not is_workspace_member(v_ws, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if workspace_role(p_privy, v_ws) not in ('owner', 'admin') then raise exception 'FORBIDDEN: delete requires admin'; end if;
  delete from sites where id = p_site and workspace_id = v_ws; -- site_events cascade
end $$;
grant execute on function delete_site(text, uuid) to authenticated, anon;

notify pgrst, 'reload schema';
