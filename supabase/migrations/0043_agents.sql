-- ============================================================================
-- RunButter Platform Core — 0043_agents.sql
-- AI Agents: users define agents (role + instructions + which BYO model +
-- which tools they may use + an autonomy level), then run them on a task. The
-- runner (server-side, /api/agents/run) executes a tool-use loop over the SAME
-- workspace tools the MCP server exposes, on the user's own AI key. Two safety
-- layers: (1) tools are scoped per agent, (2) 'suggest' agents only PROPOSE
-- writes — a human approves before anything is created/updated. 'auto' agents
-- write directly, bounded by a per-run step cap + the scoped tool list + a full
-- audit log. Agents always act inside the owner's workspace tenancy.
--
-- Additive, idempotent & prod-safe. Depends on 0001–0034. Run AFTER them.
-- ============================================================================

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null default 'New agent',
  role text not null default '',                    -- short label, e.g. "Collections assistant"
  instructions text not null default '',            -- system prompt
  provider text not null default '',                -- '' = use workspace default AI key
  model text not null default '',
  allowed_tools text[] not null default '{list_objects,list_records,search_records,get_record}',
  allowed_objects text[] not null default '{}',     -- empty = all objects; else restrict
  autonomy text not null default 'suggest' check (autonomy in ('suggest','auto')),
  max_steps int not null default 12 check (max_steps between 1 and 40),
  enabled boolean not null default true,
  created_by_privy text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_agents_ws on agents(workspace_id, updated_at desc);
drop trigger if exists trg_agents_upd on agents;
create trigger trg_agents_upd before update on agents for each row execute function set_updated_at();
alter table agents enable row level security;

-- One run of an agent against a task. `steps` is the audit log (each AI turn +
-- tool call + result). `proposed` holds writes awaiting approval (suggest mode).
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  agent_name text not null default '',
  task text not null default '',
  status text not null default 'running'
    check (status in ('running','done','error','awaiting_approval')),
  steps jsonb not null default '[]'::jsonb,
  proposed jsonb not null default '[]'::jsonb,
  result text not null default '',
  created_by_privy text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists idx_agent_runs_ws on agent_runs(workspace_id, created_at desc);
alter table agent_runs enable row level security;

-- ── Agent CRUD (client-facing, via /api/rpc verified proxy) ────────────────────
create or replace function get_agents(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.updated_at desc) from (
    select id, name, role, instructions, provider, model, allowed_tools, allowed_objects,
           autonomy, max_steps, enabled, updated_at
    from agents where workspace_id = p_workspace
  ) a), '[]'::jsonb);
end $$;
grant execute on function get_agents(text, uuid) to authenticated, anon;

create or replace function save_agent(
  p_privy text, p_workspace uuid, p_id uuid, p_name text, p_role text, p_instructions text,
  p_provider text, p_model text, p_allowed_tools text[], p_allowed_objects text[],
  p_autonomy text, p_max_steps int
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if p_id is null then
    insert into agents (workspace_id, name, role, instructions, provider, model,
      allowed_tools, allowed_objects, autonomy, max_steps, created_by_privy)
    values (p_workspace, coalesce(nullif(p_name,''),'New agent'), p_role, p_instructions,
      coalesce(p_provider,''), coalesce(p_model,''),
      coalesce(p_allowed_tools, '{list_objects,list_records,search_records,get_record}'),
      coalesce(p_allowed_objects, '{}'),
      coalesce(nullif(p_autonomy,''),'suggest'), coalesce(p_max_steps,12), p_privy)
    returning id into v_id;
  else
    update agents set name = p_name, role = p_role, instructions = p_instructions,
      provider = coalesce(p_provider,''), model = coalesce(p_model,''),
      allowed_tools = coalesce(p_allowed_tools, allowed_tools),
      allowed_objects = coalesce(p_allowed_objects, allowed_objects),
      autonomy = coalesce(nullif(p_autonomy,''), autonomy), max_steps = coalesce(p_max_steps, max_steps)
    where id = p_id and workspace_id = p_workspace
    returning id into v_id;
  end if;
  return v_id;
end $$;
grant execute on function save_agent(text, uuid, uuid, text, text, text, text, text, text[], text[], text, int) to authenticated, anon;

create or replace function set_agent_enabled(p_privy text, p_workspace uuid, p_id uuid, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  update agents set enabled = p_enabled where id = p_id and workspace_id = p_workspace;
  return found;
end $$;
grant execute on function set_agent_enabled(text, uuid, uuid, boolean) to authenticated, anon;

create or replace function delete_agent(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  delete from agents where id = p_id and workspace_id = p_workspace;
  return found;
end $$;
grant execute on function delete_agent(text, uuid, uuid) to authenticated, anon;

create or replace function get_agent_runs(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (
    select id, agent_id, agent_name, task, status, steps, proposed, result, created_at, finished_at
    from agent_runs where workspace_id = p_workspace order by created_at desc limit 50
  ) r), '[]'::jsonb);
end $$;
grant execute on function get_agent_runs(text, uuid) to authenticated, anon;

-- ── Runner-side writers (service_role only; the /api/agents routes call these) ─
-- get one agent's full definition (incl. its resolved run config).
create or replace function get_agent_full(p_workspace uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return (select to_jsonb(a) from agents a where a.id = p_id and a.workspace_id = p_workspace);
end $$;
revoke all on function get_agent_full(uuid, uuid) from public, authenticated, anon;
grant execute on function get_agent_full(uuid, uuid) to service_role;

create or replace function create_agent_run(p_workspace uuid, p_agent_id uuid, p_agent_name text, p_task text, p_privy text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into agent_runs (workspace_id, agent_id, agent_name, task, created_by_privy)
  values (p_workspace, p_agent_id, p_agent_name, p_task, p_privy) returning id into v_id;
  return v_id;
end $$;
revoke all on function create_agent_run(uuid, uuid, text, text, text) from public, authenticated, anon;
grant execute on function create_agent_run(uuid, uuid, text, text, text) to service_role;

create or replace function finish_agent_run(p_id uuid, p_status text, p_steps jsonb, p_proposed jsonb, p_result text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update agent_runs set status = p_status, steps = coalesce(p_steps,'[]'::jsonb),
    proposed = coalesce(p_proposed,'[]'::jsonb), result = coalesce(p_result,''),
    finished_at = case when p_status in ('done','error') then now() else finished_at end
  where id = p_id;
end $$;
revoke all on function finish_agent_run(uuid, text, jsonb, jsonb, text) from public, authenticated, anon;
grant execute on function finish_agent_run(uuid, text, jsonb, jsonb, text) to service_role;

-- fetch a run for the approval step (service_role; approve route resolves tenancy).
create or replace function get_agent_run_row(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return (select to_jsonb(r) from agent_runs r where r.id = p_id);
end $$;
revoke all on function get_agent_run_row(uuid) from public, authenticated, anon;
grant execute on function get_agent_run_row(uuid) to service_role;

notify pgrst, 'reload schema';
