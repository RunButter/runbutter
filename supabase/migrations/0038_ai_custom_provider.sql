-- ============================================================================
-- RunButter Platform Core — 0038_ai_custom_provider.sql
-- "Every model": adds a custom OpenAI-compatible provider to BYO-AI. Users can
-- point Docs AI at ANY endpoint speaking the OpenAI chat format (Groq, Mistral,
-- DeepSeek, Together, xAI, Ollama, LM Studio, LiteLLM proxies, …) by storing a
-- base URL alongside their key.
--
-- Additive, idempotent & prod-safe. Depends on 0034. Run AFTER it.
-- ============================================================================

alter table ai_providers add column if not exists base_url text;

-- get_ai_providers — include base_url for display (masked key hint only).
create or replace function get_ai_providers(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', a.id, 'provider', a.provider, 'model', a.model, 'key_hint', a.key_hint,
    'is_default', a.is_default, 'enabled', a.enabled, 'base_url', a.base_url
  ) order by a.created_at) from ai_providers a where a.workspace_id = p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_ai_providers(text, uuid) to authenticated, anon;

-- store_ai_provider — new signature with p_base_url. Drop the old 8-arg
-- overload first so PostgREST never sees an ambiguous pair.
drop function if exists store_ai_provider(text, uuid, text, text, text, text, text, text);
create or replace function store_ai_provider(p_privy text, p_workspace uuid, p_provider text, p_model text, p_cipher text, p_iv text, p_tag text, p_hint text, p_base_url text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_has_default boolean;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
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
revoke all on function store_ai_provider(text, uuid, text, text, text, text, text, text, text) from public, authenticated, anon;
grant execute on function store_ai_provider(text, uuid, text, text, text, text, text, text, text) to service_role;

-- get_ai_secret — return base_url so the proxy can reach custom endpoints.
create or replace function get_ai_secret(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a ai_providers;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select * into a from ai_providers where workspace_id = p_workspace and enabled order by is_default desc, created_at limit 1;
  if a.id is null then return null; end if;
  return jsonb_build_object('provider', a.provider, 'model', a.model, 'base_url', a.base_url, 'cipher', a.key_cipher, 'iv', a.key_iv, 'tag', a.key_tag);
end $$;
revoke all on function get_ai_secret(text, uuid) from public, authenticated, anon;
grant execute on function get_ai_secret(text, uuid) to service_role;

notify pgrst, 'reload schema';
