-- ============================================================================
-- RunButter Platform Core — 0034_docs_ai.sql
-- Docs module + BYO-AI. Users store their OWN provider keys (Claude/OpenAI/
-- Gemini/OpenRouter) encrypted at rest; RunButter proxies calls, so there is no
-- platform token cost — the user funds their own AI. The key ciphertext is
-- written/read only by service-role RPCs (the API routes); user RPCs only ever
-- see a masked hint.
--
-- Additive, idempotent & prod-safe. Depends on 0001–0033. Run AFTER them.
-- ============================================================================

-- 1. DOCS — freeform documents (markdown body), workspace-scoped.
create table if not exists docs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null default 'Untitled',
  body text not null default '',
  created_by_privy text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_docs_ws on docs(workspace_id, updated_at desc);
drop trigger if exists trg_docs_upd on docs;
create trigger trg_docs_upd before update on docs for each row execute function set_updated_at();
alter table docs enable row level security;

-- 2. AI_PROVIDERS — one BYO key per provider per workspace (AES-GCM ciphertext).
create table if not exists ai_providers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null,                 -- claude | openai | gemini | openrouter
  model text not null default '',
  key_cipher text not null,
  key_iv text not null,
  key_tag text not null,
  key_hint text not null default '',      -- e.g. …a1b2
  is_default boolean not null default false,
  enabled boolean not null default true,
  created_by_privy text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_ai_providers_uniq on ai_providers(workspace_id, provider);
drop trigger if exists trg_ai_providers_upd on ai_providers;
create trigger trg_ai_providers_upd before update on ai_providers for each row execute function set_updated_at();
alter table ai_providers enable row level security;

-- ── Docs RPCs ─────────────────────────────────────────────────────────────────
create or replace function get_docs(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', d.id, 'title', d.title, 'snippet', left(d.body, 140), 'updated_at', d.updated_at
  ) order by d.updated_at desc) from docs d where d.workspace_id = p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_docs(text, uuid) to authenticated, anon;

create or replace function get_doc(p_privy text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  return (select to_jsonb(t) from (select id, title, body, updated_at from docs where id = p_id and workspace_id = any(my)) t);
end $$;
grant execute on function get_doc(text, uuid) to authenticated, anon;

create or replace function save_doc(p_privy text, p_workspace uuid, p_id uuid, p_title text, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if p_id is null then
    insert into docs (workspace_id, title, body, created_by_privy)
    values (p_workspace, coalesce(nullif(p_title,''),'Untitled'), coalesce(p_body,''), p_privy) returning id into v_id;
  else
    update docs set title = coalesce(nullif(p_title,''), title), body = coalesce(p_body, body)
    where id = p_id and workspace_id = p_workspace returning id into v_id;
  end if;
  return v_id;
end $$;
grant execute on function save_doc(text, uuid, uuid, text, text) to authenticated, anon;

create or replace function delete_doc(p_privy text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  delete from docs where id = p_id and workspace_id = any(my);
end $$;
grant execute on function delete_doc(text, uuid) to authenticated, anon;

-- ── AI provider RPCs (user: masked only) ──────────────────────────────────────
create or replace function get_ai_providers(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', a.id, 'provider', a.provider, 'model', a.model, 'key_hint', a.key_hint, 'is_default', a.is_default, 'enabled', a.enabled
  ) order by a.created_at) from ai_providers a where a.workspace_id = p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_ai_providers(text, uuid) to authenticated, anon;

create or replace function set_ai_provider_meta(p_privy text, p_id uuid, p_model text, p_default boolean, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
declare v_ws uuid;
begin
  select workspace_id into v_ws from ai_providers where id = p_id and workspace_id = any(my);
  if v_ws is null then return; end if;
  if p_default then update ai_providers set is_default = false where workspace_id = v_ws; end if;
  update ai_providers set model = coalesce(p_model, model), is_default = coalesce(p_default, is_default), enabled = coalesce(p_enabled, enabled) where id = p_id;
end $$;
grant execute on function set_ai_provider_meta(text, uuid, text, boolean, boolean) to authenticated, anon;

create or replace function delete_ai_provider(p_privy text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  delete from ai_providers where id = p_id and workspace_id = any(my);
end $$;
grant execute on function delete_ai_provider(text, uuid) to authenticated, anon;

-- ── AI provider secrets (service_role only) ───────────────────────────────────
-- Store/replace an encrypted key (called by /api/ai/keys after sealing it).
create or replace function store_ai_provider(p_privy text, p_workspace uuid, p_provider text, p_model text, p_cipher text, p_iv text, p_tag text, p_hint text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_has_default boolean;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select exists(select 1 from ai_providers where workspace_id = p_workspace and is_default) into v_has_default;
  insert into ai_providers (workspace_id, provider, model, key_cipher, key_iv, key_tag, key_hint, is_default, created_by_privy)
  values (p_workspace, p_provider, coalesce(p_model,''), p_cipher, p_iv, p_tag, coalesce(p_hint,''), not v_has_default, p_privy)
  on conflict (workspace_id, provider) do update set
    model = coalesce(nullif(excluded.model,''), ai_providers.model),
    key_cipher = excluded.key_cipher, key_iv = excluded.key_iv, key_tag = excluded.key_tag, key_hint = excluded.key_hint, enabled = true
  returning id into v_id;
  return v_id;
end $$;
revoke all on function store_ai_provider(text, uuid, text, text, text, text, text, text) from public, authenticated, anon;
grant execute on function store_ai_provider(text, uuid, text, text, text, text, text, text) to service_role;

-- Return the default (or any enabled) provider's ciphertext, member-checked.
create or replace function get_ai_secret(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a ai_providers;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select * into a from ai_providers where workspace_id = p_workspace and enabled order by is_default desc, created_at limit 1;
  if a.id is null then return null; end if;
  return jsonb_build_object('provider', a.provider, 'model', a.model, 'cipher', a.key_cipher, 'iv', a.key_iv, 'tag', a.key_tag);
end $$;
revoke all on function get_ai_secret(text, uuid) from public, authenticated, anon;
grant execute on function get_ai_secret(text, uuid) to service_role;

notify pgrst, 'reload schema';
