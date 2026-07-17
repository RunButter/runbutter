-- ============================================================================
-- RunButter Platform Core — 0032_automations.sql
-- Automations engine + open integration layer, workspace-scoped.
--
--  • connections       — outgoing webhook targets (BYO URL: Zapier/Make/n8n/Slack)
--  • automations       — rules: trigger (object + event + conditions) → actions
--  • automation_events — outbox filled by AFTER-triggers, drained by the dispatcher
--  • automation_runs   — execution log
--  • api_keys          — incoming REST/MCP auth (sha256 hash stored; key shown once)
--
-- Table triggers only enqueue an event when the workspace actually has an enabled
-- rule for that object, so the outbox stays empty until automations exist. The
-- dispatcher (/api/automations/dispatch) and the incoming API (/api/v1/*) call the
-- service-role-only RPCs at the bottom. No LLM / no platform API cost — users
-- bring their own webhook URL and their own API key.
--
-- Additive, idempotent & prod-safe. Depends on 0001–0031. Run AFTER them.
-- ============================================================================

create extension if not exists pgcrypto;

-- 1. CONNECTIONS — outgoing webhook endpoints the user owns.
create table if not exists connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  label text not null default '',
  kind text not null default 'generic',   -- generic | slack | discord | zapier | make | n8n
  url text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_connections_ws on connections(workspace_id);
drop trigger if exists trg_connections_upd on connections;
create trigger trg_connections_upd before update on connections for each row execute function set_updated_at();
alter table connections enable row level security;

-- 2. AUTOMATIONS — the rules. actions run as owner_privy (a workspace member).
create table if not exists automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  owner_privy text not null,
  name text not null default 'Untitled automation',
  enabled boolean not null default true,
  object text not null,                    -- companies | people | invoices | expenses | transactions | products | campaigns | projects | issues
  event text not null default 'created',   -- created | updated
  conditions jsonb not null default '[]'::jsonb,   -- [{ field, op, value }]
  actions jsonb not null default '[]'::jsonb,      -- [{ type, config }]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_automations_ws on automations(workspace_id);
create index if not exists idx_automations_lookup on automations(workspace_id, object, enabled);
drop trigger if exists trg_automations_upd on automations;
create trigger trg_automations_upd before update on automations for each row execute function set_updated_at();
alter table automations enable row level security;

-- 3. AUTOMATION_EVENTS — the outbox.
create table if not exists automation_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  object text not null,
  event text not null,
  record_id uuid,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',  -- pending | processing | done | error
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists idx_autoevents_pending on automation_events(status, created_at) where status = 'pending';
alter table automation_events enable row level security;

-- 4. AUTOMATION_RUNS — execution log.
create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  automation_id uuid references automations(id) on delete set null,
  automation_name text,
  action_type text,
  status text not null default 'ok',       -- ok | error
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists idx_autoruns_ws on automation_runs(workspace_id, created_at desc);
alter table automation_runs enable row level security;

-- 5. API_KEYS — incoming REST / MCP auth. Only the hash is stored.
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null default 'API key',
  prefix text not null,                    -- e.g. hb_1a2b3c (for display)
  key_hash text not null,                  -- sha256 hex of the full key
  created_by_privy text,
  last_used_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_apikeys_ws on api_keys(workspace_id);
create index if not exists idx_apikeys_hash on api_keys(key_hash) where revoked = false;
alter table api_keys enable row level security;

-- ============================================================================
-- 6. Event emitter — one function, attached to every generic object table.
--    Only enqueues when the workspace has an enabled rule for that object slug,
--    so tables without automations pay ~nothing.
-- ============================================================================
create or replace function emit_automation_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ws uuid := NEW.workspace_id;
begin
  if exists (select 1 from automations a where a.workspace_id = v_ws and a.enabled and a.object = TG_ARGV[0]) then
    insert into automation_events (workspace_id, object, event, record_id, payload)
    values (v_ws, TG_ARGV[0], case when TG_OP = 'INSERT' then 'created' else 'updated' end, NEW.id, to_jsonb(NEW));
  end if;
  return NEW;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('organizations','companies'), ('people','people'), ('invoices','invoices'),
    ('expenses','expenses'), ('transactions','transactions'), ('products','products'),
    ('campaigns','campaigns'), ('projects','projects'), ('issues','issues')
  ) as x(tbl, slug) loop
    execute format('drop trigger if exists trg_autoevt_%1$s on %1$s;', r.tbl);
    execute format('create trigger trg_autoevt_%1$s after insert or update on %1$s for each row execute function emit_automation_event(%2$L);', r.tbl, r.slug);
  end loop;
end $$;

-- ============================================================================
-- 7. User-facing RPCs (Privy pattern, membership-checked).
-- ============================================================================

-- Automations CRUD
create or replace function get_automations(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', a.name, 'enabled', a.enabled, 'object', a.object, 'event', a.event,
    'conditions', a.conditions, 'actions', a.actions, 'updated_at', a.updated_at
  ) order by a.created_at desc) from automations a where a.workspace_id = p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_automations(text, uuid) to authenticated, anon;

create or replace function save_automation(p_privy text, p_workspace uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if p_id is null then
    insert into automations (workspace_id, owner_privy, name, enabled, object, event, conditions, actions)
    values (p_workspace, p_privy, coalesce(nullif(p_data->>'name',''),'Untitled automation'),
            coalesce((p_data->>'enabled')::boolean, true), p_data->>'object',
            coalesce(nullif(p_data->>'event',''),'created'),
            coalesce(p_data->'conditions','[]'::jsonb), coalesce(p_data->'actions','[]'::jsonb))
    returning id into v_id;
  else
    update automations set
      name = coalesce(nullif(p_data->>'name',''), name),
      enabled = coalesce((p_data->>'enabled')::boolean, enabled),
      object = coalesce(nullif(p_data->>'object',''), object),
      event = coalesce(nullif(p_data->>'event',''), event),
      conditions = coalesce(p_data->'conditions', conditions),
      actions = coalesce(p_data->'actions', actions)
    where id = p_id and workspace_id = p_workspace
    returning id into v_id;
  end if;
  return v_id;
end $$;
grant execute on function save_automation(text, uuid, uuid, jsonb) to authenticated, anon;

create or replace function set_automation_enabled(p_privy text, p_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  update automations set enabled = p_enabled where id = p_id and workspace_id = any(my);
end $$;
grant execute on function set_automation_enabled(text, uuid, boolean) to authenticated, anon;

create or replace function delete_automation(p_privy text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  delete from automations where id = p_id and workspace_id = any(my);
end $$;
grant execute on function delete_automation(text, uuid) to authenticated, anon;

create or replace function get_automation_runs(p_privy text, p_workspace uuid, p_limit int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', r.id, 'automation_name', r.automation_name, 'action_type', r.action_type,
    'status', r.status, 'detail', r.detail, 'created_at', r.created_at
  ) order by r.created_at desc) from (
    select * from automation_runs where workspace_id = p_workspace order by created_at desc limit greatest(1, least(coalesce(p_limit,30), 100))
  ) r), '[]'::jsonb);
end $$;
grant execute on function get_automation_runs(text, uuid, int) to authenticated, anon;

-- Connections CRUD
create or replace function get_connections(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', c.id, 'label', c.label, 'kind', c.kind, 'url', c.url, 'is_active', c.is_active
  ) order by c.created_at) from connections c where c.workspace_id = p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_connections(text, uuid) to authenticated, anon;

create or replace function save_connection(p_privy text, p_workspace uuid, p_id uuid, p_label text, p_kind text, p_url text, p_active boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if p_url is null or p_url = '' then raise exception 'URL_REQUIRED'; end if;
  if p_id is null then
    insert into connections (workspace_id, label, kind, url, is_active)
    values (p_workspace, coalesce(p_label,''), coalesce(nullif(p_kind,''),'generic'), p_url, coalesce(p_active, true))
    returning id into v_id;
  else
    update connections set label = coalesce(p_label, label), kind = coalesce(nullif(p_kind,''), kind),
      url = p_url, is_active = coalesce(p_active, is_active)
    where id = p_id and workspace_id = p_workspace returning id into v_id;
  end if;
  return v_id;
end $$;
grant execute on function save_connection(text, uuid, uuid, text, text, text, boolean) to authenticated, anon;

create or replace function delete_connection(p_privy text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  delete from connections where id = p_id and workspace_id = any(my);
end $$;
grant execute on function delete_connection(text, uuid) to authenticated, anon;

-- API keys — create returns the full key ONCE; list never returns it.
create or replace function get_api_keys(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', k.id, 'name', k.name, 'prefix', k.prefix, 'last_used_at', k.last_used_at, 'revoked', k.revoked, 'created_at', k.created_at
  ) order by k.created_at desc) from api_keys k where k.workspace_id = p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_api_keys(text, uuid) to authenticated, anon;

create or replace function create_api_key(p_privy text, p_workspace uuid, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare v_key text; v_prefix text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  v_key := 'hb_' || encode(gen_random_bytes(24), 'hex');
  v_prefix := left(v_key, 11);
  insert into api_keys (workspace_id, name, prefix, key_hash, created_by_privy)
  values (p_workspace, coalesce(nullif(p_name,''),'API key'), v_prefix, encode(digest(v_key, 'sha256'), 'hex'), p_privy);
  return v_key;   -- shown once, never stored in plaintext
end $$;
grant execute on function create_api_key(text, uuid, text) to authenticated, anon;

create or replace function revoke_api_key(p_privy text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  update api_keys set revoked = true where id = p_id and workspace_id = any(my);
end $$;
grant execute on function revoke_api_key(text, uuid) to authenticated, anon;

-- ============================================================================
-- 8. System RPCs — service_role ONLY (called by the dispatcher + incoming API).
--    NOT granted to authenticated/anon: they cross workspace boundaries.
-- ============================================================================
create or replace function claim_automation_events(p_max int default 25)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with picked as (
    select id from automation_events where status = 'pending' order by created_at limit greatest(1, least(coalesce(p_max,25), 100)) for update skip locked
  ), upd as (
    update automation_events e set status = 'processing', attempts = e.attempts + 1
    from picked where e.id = picked.id returning e.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'workspace_id', workspace_id, 'object', object, 'event', event, 'record_id', record_id, 'payload', payload
  )), '[]'::jsonb) into v from upd;
  return v;
end $$;
revoke all on function claim_automation_events(int) from public, authenticated, anon;
grant execute on function claim_automation_events(int) to service_role;

create or replace function get_event_automations(p_workspace uuid, p_object text, p_event text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', a.name, 'owner_privy', a.owner_privy, 'conditions', a.conditions, 'actions', a.actions
  )) from automations a where a.workspace_id = p_workspace and a.enabled and a.object = p_object and a.event = p_event), '[]'::jsonb);
end $$;
revoke all on function get_event_automations(uuid, text, text) from public, authenticated, anon;
grant execute on function get_event_automations(uuid, text, text) to service_role;

create or replace function complete_automation_event(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update automation_events set status = p_status, processed_at = now() where id = p_id;
end $$;
revoke all on function complete_automation_event(uuid, text) from public, authenticated, anon;
grant execute on function complete_automation_event(uuid, text) to service_role;

create or replace function log_automation_run(p_workspace uuid, p_automation uuid, p_name text, p_action text, p_status text, p_detail text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into automation_runs (workspace_id, automation_id, automation_name, action_type, status, detail)
  values (p_workspace, p_automation, p_name, p_action, coalesce(nullif(p_status,''),'ok'), p_detail);
end $$;
revoke all on function log_automation_run(uuid, uuid, text, text, text, text) from public, authenticated, anon;
grant execute on function log_automation_run(uuid, uuid, text, text, text, text) to service_role;

create or replace function get_connection_url(p_workspace uuid, p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  return (select url from connections where id = p_id and workspace_id = p_workspace and is_active);
end $$;
revoke all on function get_connection_url(uuid, uuid) from public, authenticated, anon;
grant execute on function get_connection_url(uuid, uuid) to service_role;

-- Incoming API/MCP: resolve a presented key hash → workspace + acting identity.
create or replace function resolve_api_key(p_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row api_keys;
begin
  select * into v_row from api_keys where key_hash = p_hash and revoked = false limit 1;
  if v_row.id is null then return null; end if;
  update api_keys set last_used_at = now() where id = v_row.id;
  return jsonb_build_object('id', v_row.id, 'workspace_id', v_row.workspace_id, 'owner_privy', v_row.created_by_privy);
end $$;
revoke all on function resolve_api_key(text) from public, authenticated, anon;
grant execute on function resolve_api_key(text) to service_role;

notify pgrst, 'reload schema';
