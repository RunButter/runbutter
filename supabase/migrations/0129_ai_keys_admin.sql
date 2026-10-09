-- ============================================================================
-- 0129_ai_keys_admin.sql — only an owner or admin may change the AI key.
--
-- The AI key is the WORKSPACE's (ai_providers.workspace_id): every agent run,
-- every Copilot turn and every writing-assistant call in the workspace reads it
-- through get_ai_secret. Since 0034 the three writes checked membership and
-- nothing else, and the screen sat under "Account — yours alone", so it looked
-- personal while being shared.
--
-- That made it the cheapest exfiltration path in the product. Any member, a
-- `viewer` included, could store a `custom` provider pointing at a server they
-- control and mark it default; from then on every prompt — record data, file
-- text, the Copilot's whole conversation — went to them, while the screens kept
-- working. Deleting the key was the same check, so a viewer could also switch
-- AI off for everyone.
--
-- Reading stays member-level: get_ai_providers returns a masked hint, never a
-- key, and members need to see which provider is in use.
-- ============================================================================

create or replace function ai_keys_admin(p_privy text, p_workspace uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(workspace_role(p_privy, p_workspace), '') not in ('owner','admin') then
    raise exception 'FORBIDDEN: only an owner or admin can change the AI key';
  end if;
end $$;

create or replace function store_ai_provider(p_privy text, p_workspace uuid, p_provider text, p_model text, p_cipher text, p_iv text, p_tag text, p_hint text, p_base_url text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_has_default boolean;
begin
  perform ai_keys_admin(p_privy, p_workspace);
  select exists(select 1 from ai_providers where workspace_id = p_workspace and is_default) into v_has_default;
  insert into ai_providers (workspace_id, provider, model, key_cipher, key_iv, key_tag, key_hint, base_url, is_default, created_by_privy)
  values (p_workspace, p_provider, coalesce(p_model,''), p_cipher, p_iv, p_tag, coalesce(p_hint,''), nullif(p_base_url,''), not v_has_default, p_privy)
  on conflict (workspace_id, provider) do update set
    model = coalesce(nullif(excluded.model,''), ai_providers.model),
    key_cipher = excluded.key_cipher, key_iv = excluded.key_iv, key_tag = excluded.key_tag, key_hint = excluded.key_hint,
    base_url = coalesce(excluded.base_url, ai_providers.base_url), enabled = true
  returning id into v_id;
  return v_id;
end $$;

-- The two by-id functions resolve the workspace from the ROW, then check the
-- caller's role there. A row in a workspace the caller is not in is a silent
-- no-op, as before, so an id cannot be probed for existence.
create or replace function set_ai_provider_meta(p_privy text, p_id uuid, p_model text, p_default boolean, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
declare v_ws uuid;
begin
  select workspace_id into v_ws from ai_providers where id = p_id and workspace_id = any(my);
  if v_ws is null then return; end if;
  perform ai_keys_admin(p_privy, v_ws);
  if p_default then update ai_providers set is_default = false where workspace_id = v_ws; end if;
  update ai_providers set model = coalesce(p_model, model), is_default = coalesce(p_default, is_default), enabled = coalesce(p_enabled, enabled) where id = p_id;
end $$;

create or replace function delete_ai_provider(p_privy text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
declare v_ws uuid;
begin
  select workspace_id into v_ws from ai_providers where id = p_id and workspace_id = any(my);
  if v_ws is null then return; end if;
  perform ai_keys_admin(p_privy, v_ws);
  delete from ai_providers where id = p_id;
end $$;

revoke all on function ai_keys_admin(text, uuid)                                                   from public, anon, authenticated;
revoke all on function store_ai_provider(text, uuid, text, text, text, text, text, text, text)     from public, anon, authenticated;
revoke all on function set_ai_provider_meta(text, uuid, text, boolean, boolean)                    from public, anon, authenticated;
revoke all on function delete_ai_provider(text, uuid)                                              from public, anon, authenticated;
grant execute on function ai_keys_admin(text, uuid)                                                to service_role;
grant execute on function store_ai_provider(text, uuid, text, text, text, text, text, text, text)  to service_role;
grant execute on function set_ai_provider_meta(text, uuid, text, boolean, boolean)                 to service_role;
grant execute on function delete_ai_provider(text, uuid)                                           to service_role;

notify pgrst, 'reload schema';
