-- ============================================================================
-- 0128_nav_prefs.sql — switch modules and screens off.
--
-- 0097 let a workspace hide a built-in OBJECT (Companies, Invoices…). Nothing
-- could hide a SCREEN that is not an object (Finance → Forecast, Marketing →
-- Newsletters) or a whole pillar (HR, for a company that does not hire), so a
-- five-person agency saw recruiting, cap tables and web analytics on every
-- page whether it used them or not.
--
-- Two lists, because they are two different decisions:
--   workspaces.hidden_nav — an owner/admin turns a module off for EVERYONE.
--   accounts.hidden_nav   — a person tidies THEIR OWN sidebar.
-- A key is 'g:<section>' for a whole section or 'i:<item slug>' for one entry.
--
-- PRESENTATION ONLY, and the client says so: a hidden screen is still reachable
-- by URL and by the Copilot. Hiding is not a permission — access control lives
-- in the RPCs, and a sidebar preference must never be mistaken for it.
-- ============================================================================

alter table workspaces add column if not exists hidden_nav text[] not null default '{}';
alter table accounts   add column if not exists hidden_nav text[] not null default '{}';

-- Keys are short slugs. Anything else is dropped rather than stored, so a
-- crafted payload cannot turn this column into a free-text store.
create or replace function clean_nav_keys(p_keys text[])
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct k order by k), '{}')
    from (select lower(btrim(x)) as k from unnest(coalesce(p_keys, '{}')) x) s
   where k ~ '^[gi]:[a-z0-9][a-z0-9 _&.-]{0,62}$'
   limit 1;
$$;

create or replace function get_nav_prefs(p_privy text, p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ws text[]; v_me text[];
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select hidden_nav into v_ws from workspaces where id = p_workspace;
  select hidden_nav into v_me from accounts
   where workspace_id = p_workspace and privy_user_id = p_privy
   order by created_at limit 1;
  return jsonb_build_object(
    'workspace', to_jsonb(coalesce(v_ws, '{}')),
    'mine',      to_jsonb(coalesce(v_me, '{}')),
    'can_edit_workspace', coalesce(workspace_role(p_privy, p_workspace) in ('owner','admin'), false)
  );
end $$;

create or replace function set_workspace_nav(p_privy text, p_workspace uuid, p_hidden text[])
returns text[] language plpgsql security definer set search_path = public as $$
declare v text[] := clean_nav_keys(p_hidden);
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if workspace_role(p_privy, p_workspace) not in ('owner','admin') then
    raise exception 'FORBIDDEN: only an owner or admin can change modules for everyone';
  end if;
  if coalesce(array_length(v, 1), 0) > 200 then raise exception 'TOO_MANY'; end if;
  update workspaces set hidden_nav = v where id = p_workspace;
  return v;
end $$;

create or replace function set_my_nav(p_privy text, p_workspace uuid, p_hidden text[])
returns text[] language plpgsql security definer set search_path = public as $$
declare v text[] := clean_nav_keys(p_hidden);
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(array_length(v, 1), 0) > 200 then raise exception 'TOO_MANY'; end if;
  update accounts set hidden_nav = v
   where workspace_id = p_workspace and privy_user_id = p_privy;
  return v;
end $$;

-- 0105's rule: a SECURITY DEFINER function is callable by service_role only.
-- The browser reaches these through /api/rpc, which verifies the Privy token.
revoke all on function clean_nav_keys(text[])                  from public, anon, authenticated;
revoke all on function get_nav_prefs(text, uuid)               from public, anon, authenticated;
revoke all on function set_workspace_nav(text, uuid, text[])   from public, anon, authenticated;
revoke all on function set_my_nav(text, uuid, text[])          from public, anon, authenticated;
grant execute on function clean_nav_keys(text[])                to service_role;
grant execute on function get_nav_prefs(text, uuid)             to service_role;
grant execute on function set_workspace_nav(text, uuid, text[]) to service_role;
grant execute on function set_my_nav(text, uuid, text[])        to service_role;

notify pgrst, 'reload schema';
