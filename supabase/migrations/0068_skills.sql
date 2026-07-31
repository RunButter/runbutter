-- ============================================================================
-- RunButter Platform Core — 0068_skills.sql
-- SKILLS: reusable instruction packs that can be attached to any agent.
--
-- An agent's `instructions` answer "who are you". A skill answers "how does
-- this company do X" — the invoice numbering scheme, the tone of a reminder,
-- which categories map to which cost centre. That knowledge is per-company,
-- outlives any one agent, and belongs to more than one of them, so it cannot
-- live inside a single agent's prompt.
--
-- Skills can be written in the app or imported from a public GitHub repository
-- (SKILL.md files with YAML frontmatter — the Anthropic skill format). An
-- imported skill is THIRD-PARTY TEXT that ends up in a system prompt, so:
--   • import writes nothing on its own — /api/skills/import returns a preview
--     and a human saves what they chose;
--   • `source`/`source_url` are kept so an imported skill stays identifiable;
--   • suggested_tools is a HINT for the builder UI, never a grant. The runner
--     intersects it with the agent's allowed_tools, so attaching a skill can
--     never widen what an agent may touch. See lib/agents/runner.ts.
--
-- Additive, idempotent & prod-safe. Depends on 0043 (agents). Run AFTER it.
-- ============================================================================

create table if not exists skills (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null default 'New skill',
  description text not null default '',          -- one line, shown in the picker
  instructions text not null default '',         -- the pack itself
  suggested_tools text[] not null default '{}',  -- a hint, never a grant
  source text not null default 'local' check (source in ('local', 'github')),
  source_url text not null default '',
  created_by_privy text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_skills_ws on skills(workspace_id, updated_at desc);
drop trigger if exists trg_skills_upd on skills;
create trigger trg_skills_upd before update on skills for each row execute function set_updated_at();
alter table skills enable row level security;

-- Which skills an agent carries. An array rather than a join table: the list is
-- short, always read in full with the agent, and never queried from the skill
-- side. `on delete cascade` cannot reach into an array, so deleting a skill
-- prunes the references explicitly (see delete_skill below).
alter table agents add column if not exists skill_ids uuid[] not null default '{}';

-- ── Skill CRUD (client-facing, via the /api/rpc verified proxy) ───────────────
create or replace function get_skills(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(to_jsonb(s) order by s.updated_at desc) from (
    select id, name, description, instructions, suggested_tools, source, source_url, updated_at
    from skills where workspace_id = p_workspace
  ) s), '[]'::jsonb);
end $$;
grant execute on function get_skills(text, uuid) to authenticated, anon;

create or replace function save_skill(
  p_privy text, p_workspace uuid, p_id uuid, p_name text, p_description text,
  p_instructions text, p_suggested_tools text[], p_source text, p_source_url text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- A skill body becomes part of a system prompt; an unbounded one would blow
  -- the context window of every agent carrying it, so it is capped here rather
  -- than only in the UI (the RPC is reachable without the UI).
  if length(coalesce(p_instructions, '')) > 20000 then raise exception 'SKILL_TOO_LARGE'; end if;
  if p_id is null then
    insert into skills (workspace_id, name, description, instructions, suggested_tools,
                        source, source_url, created_by_privy)
    values (p_workspace, coalesce(nullif(p_name, ''), 'New skill'), coalesce(p_description, ''),
            coalesce(p_instructions, ''), coalesce(p_suggested_tools, '{}'),
            case when p_source in ('local', 'github') then p_source else 'local' end,
            coalesce(p_source_url, ''), p_privy)
    returning id into v_id;
  else
    update skills set
      name = coalesce(nullif(p_name, ''), name),
      description = coalesce(p_description, description),
      instructions = coalesce(p_instructions, instructions),
      suggested_tools = coalesce(p_suggested_tools, suggested_tools)
    where id = p_id and workspace_id = p_workspace
    returning id into v_id;
  end if;
  return v_id;
end $$;
grant execute on function save_skill(text, uuid, uuid, text, text, text, text[], text, text) to authenticated, anon;

create or replace function delete_skill(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  delete from skills where id = p_id and workspace_id = p_workspace;
  if not found then return false; end if;
  -- Prune the dangling reference. Without this an agent keeps an id that
  -- resolves to nothing, and the runner would silently drop a skill the UI
  -- still shows as attached.
  update agents set skill_ids = array_remove(skill_ids, p_id)
   where workspace_id = p_workspace and p_id = any(skill_ids);
  return true;
end $$;
grant execute on function delete_skill(text, uuid, uuid) to authenticated, anon;

-- ── save_agent, extended with skill_ids ───────────────────────────────────────
-- Adding a parameter creates an OVERLOAD rather than replacing the function, so
-- the twelve-argument version is dropped first. Anon EXECUTE is revoked (0046)
-- and every caller goes through /api/rpc, so there is no third-party caller
-- pinned to the old signature.
drop function if exists save_agent(text, uuid, uuid, text, text, text, text, text, text[], text[], text, int);

create or replace function save_agent(
  p_privy text, p_workspace uuid, p_id uuid, p_name text, p_role text, p_instructions text,
  p_provider text, p_model text, p_allowed_tools text[], p_allowed_objects text[],
  p_autonomy text, p_max_steps int, p_skill_ids uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_skills uuid[];
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- Only ids that are real skills IN THIS WORKSPACE survive. Otherwise a caller
  -- could staple another tenant's skill id onto their agent and have the runner
  -- read it back by id.
  select coalesce(array_agg(s.id), '{}') into v_skills
    from skills s where s.workspace_id = p_workspace and s.id = any(coalesce(p_skill_ids, '{}'));

  if p_id is null then
    insert into agents (workspace_id, name, role, instructions, provider, model,
      allowed_tools, allowed_objects, autonomy, max_steps, skill_ids, created_by_privy)
    values (p_workspace, coalesce(nullif(p_name,''),'New agent'), p_role, p_instructions,
      coalesce(p_provider,''), coalesce(p_model,''),
      coalesce(p_allowed_tools, '{list_objects,list_records,search_records,get_record}'),
      coalesce(p_allowed_objects, '{}'),
      coalesce(nullif(p_autonomy,''),'suggest'), coalesce(p_max_steps,12), v_skills, p_privy)
    returning id into v_id;
  else
    update agents set name = p_name, role = p_role, instructions = p_instructions,
      provider = coalesce(p_provider,''), model = coalesce(p_model,''),
      allowed_tools = coalesce(p_allowed_tools, allowed_tools),
      allowed_objects = coalesce(p_allowed_objects, allowed_objects),
      autonomy = coalesce(nullif(p_autonomy,''), autonomy), max_steps = coalesce(p_max_steps, max_steps),
      skill_ids = v_skills
    where id = p_id and workspace_id = p_workspace
    returning id into v_id;
  end if;
  return v_id;
end $$;
grant execute on function save_agent(text, uuid, uuid, text, text, text, text, text, text[], text[], text, int, uuid[]) to authenticated, anon;

-- get_agents must return skill_ids or the editor reopens with the skills blank
-- and the next save silently detaches every one of them.
create or replace function get_agents(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.updated_at desc) from (
    select id, name, role, instructions, provider, model, allowed_tools, allowed_objects,
           autonomy, max_steps, skill_ids, enabled, updated_at
    from agents where workspace_id = p_workspace
  ) a), '[]'::jsonb);
end $$;
grant execute on function get_agents(text, uuid) to authenticated, anon;

-- ── Runner-side read (service_role; /api/agents/run composes the prompt) ──────
create or replace function get_agent_skills(p_workspace uuid, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce((select jsonb_agg(to_jsonb(s) order by s.name) from (
    select id, name, description, instructions, suggested_tools
    from skills where workspace_id = p_workspace and id = any(coalesce(p_ids, '{}'))
  ) s), '[]'::jsonb);
end $$;
revoke all on function get_agent_skills(uuid, uuid[]) from public, authenticated, anon;
grant execute on function get_agent_skills(uuid, uuid[]) to service_role;

notify pgrst, 'reload schema';
