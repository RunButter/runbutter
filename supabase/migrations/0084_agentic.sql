-- ============================================================================
-- RunButter — 0084_agentic.sql
-- Two things that turn "we have agents" into an agentic CRM: a place for an
-- agent to keep its notes, and permission to work without being asked.
--
-- THE GAP THIS CLOSES. The tool executor (lib/agents/tools.ts) has been
-- tenancy-safe and shared with /api/mcp since it was written, so capability was
-- never the problem. Two things were:
--   1. an agent could only act when a human opened a page and typed a task
--   2. anything it found out went into a run transcript nobody reads again
-- An agent that researches a company and then forgets is a chat window. An
-- agent that writes what it found onto the company, with a source, is a
-- colleague.
--
-- OBSERVED FACTS, WITH A SOURCE, AND NO CONFIDENCE SCORES. `source` is NOT NULL
-- and there is no `confidence` column, deliberately. A percentage next to a
-- guess is how a hallucination gets trusted — it converts "the model said so"
-- into something that looks measured. A URL or a tool name is checkable; 0.87
-- is not. If an agent cannot say where a claim came from, it does not get to
-- record the claim.
--
-- SCHEDULES ARE COARSE ON PURPOSE. hourly / daily / weekly plus an hour, not a
-- cron expression. A cron field means validating cron, explaining cron, and
-- debugging someone's `*/5 9-17 * * 1-5` — for a feature whose entire value is
-- "it ran without me". Autonomy is unchanged by this: a `suggest` agent still
-- only proposes, it just proposes unprompted.
--
-- Depends on 0043 (agents), 0068 (skills). Idempotent & prod-safe.
-- ============================================================================

-- ── What the agent found out ────────────────────────────────────────────────
create table if not exists record_notes (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- Free-text object name + id, matching how files, chat channels and
  -- automations already reference records across a schema where each object
  -- lives in its own table. A FK is impossible here for the same reason.
  object       text not null,
  record_id    uuid not null,

  -- Who wrote it. `agent_name` is snapshotted like `messages.author_name`: a
  -- note should still say who made it after the agent is renamed or deleted.
  agent_id     uuid references agents(id) on delete set null,
  agent_name   text not null default '',
  run_id       uuid references agent_runs(id) on delete set null,

  -- 'observation' — something found out. 'action' — something done.
  -- Kept apart because "I emailed them" and "they raised $4M" are different
  -- kinds of claim and a reader needs to tell them apart at a glance.
  kind         text not null default 'observation',
  body         text not null,

  -- NOT NULL, and there is no confidence column. See the header.
  source       text not null,
  source_url   text,
  -- When the FACT was true, which is not when we wrote it down: a funding
  -- round from March recorded today is March's news.
  observed_at  timestamptz,
  created_at   timestamptz not null default now()
);

do $$ begin
  alter table record_notes add constraint record_notes_kind_check
    check (kind in ('observation', 'action'));
exception when duplicate_object then null; end $$;

do $$ begin
  -- An empty string would defeat NOT NULL, which is the entire point of the
  -- column. Cheap to enforce, impossible to retrofit once rows exist.
  alter table record_notes add constraint record_notes_source_not_blank
    check (length(btrim(source)) > 0);
exception when duplicate_object then null; end $$;

create index if not exists idx_record_notes_rec
  on record_notes(workspace_id, object, record_id, created_at desc);

alter table record_notes enable row level security;
revoke all on table record_notes from anon, authenticated;

create or replace function get_record_notes(p_privy text, p_object text, p_record uuid, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select n.id, n.object, n.record_id, n.agent_id, n.agent_name, n.run_id,
           n.kind, n.body, n.source, n.source_url, n.observed_at, n.created_at
      from record_notes n
     where n.object = p_object and n.record_id = p_record and n.workspace_id = any(my)
     order by n.created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x), '[]'::jsonb);
end $$;
grant execute on function get_record_notes(text, text, uuid, int) to authenticated, anon;

/**
 * Write a note.
 *
 * Reachable by an agent through the tool executor and by a person through
 * /api/rpc — the same function either way, because a note a human cannot
 * correct is a note nobody will trust. `p_agent` is scoped to the workspace in
 * SQL, so an agent id from another tenant resolves to null rather than
 * attributing the note to a stranger's agent.
 */
create or replace function add_record_note(
  p_privy text, p_workspace uuid, p_object text, p_record uuid,
  p_body text, p_source text, p_kind text default 'observation',
  p_source_url text default null, p_observed_at timestamptz default null,
  p_agent uuid default null, p_agent_name text default '', p_run uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_agent uuid; v_source text; v_body text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  v_body   := left(btrim(coalesce(p_body, '')), 4000);
  v_source := left(btrim(coalesce(p_source, '')), 200);
  if v_body = ''   then raise exception 'EMPTY_NOTE'; end if;
  -- Refused rather than defaulted. "unknown" as a source is worse than no note:
  -- it looks like provenance and carries none.
  if v_source = '' then raise exception 'SOURCE_REQUIRED'; end if;

  select a.id into v_agent from agents a where a.id = p_agent and a.workspace_id = p_workspace;

  insert into record_notes (workspace_id, object, record_id, agent_id, agent_name, run_id,
                            kind, body, source, source_url, observed_at)
  values (p_workspace, p_object, p_record, v_agent, left(coalesce(p_agent_name, ''), 80), p_run,
          case when p_kind in ('observation', 'action') then p_kind else 'observation' end,
          v_body, v_source, p_source_url, p_observed_at)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function add_record_note(text, uuid, text, uuid, text, text, text, text, timestamptz, uuid, text, uuid)
  to authenticated, anon;

create or replace function delete_record_note(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  delete from record_notes where id = p_id and workspace_id = p_workspace;
  return found;
end $$;
grant execute on function delete_record_note(text, uuid, uuid) to authenticated, anon;

-- ── Agents that run without being asked ─────────────────────────────────────
alter table agents add column if not exists schedule text not null default 'off';
alter table agents add column if not exists schedule_hour int not null default 9;
alter table agents add column if not exists schedule_task text not null default '';
alter table agents add column if not exists last_run_at timestamptz;

do $$ begin
  alter table agents add constraint agents_schedule_check
    check (schedule in ('off', 'hourly', 'daily', 'weekly'));
exception when duplicate_object then null; end $$;

do $$ begin
  -- UTC, because a workspace has no timezone and guessing one silently is worse
  -- than an explicit hour that the UI can label.
  alter table agents add constraint agents_schedule_hour_check
    check (schedule_hour between 0 and 23);
exception when duplicate_object then null; end $$;

create index if not exists idx_agents_scheduled on agents(schedule, last_run_at)
  where schedule <> 'off' and enabled;

-- Adding parameters creates an OVERLOAD rather than replacing, so the
-- thirteen-argument version from 0068 is dropped first — same reasoning, and
-- anon EXECUTE is revoked so every caller comes through /api/rpc.
drop function if exists save_agent(text, uuid, uuid, text, text, text, text, text, text[], text[], text, int, uuid[]);

create or replace function save_agent(
  p_privy text, p_workspace uuid, p_id uuid, p_name text, p_role text, p_instructions text,
  p_provider text, p_model text, p_allowed_tools text[], p_allowed_objects text[],
  p_autonomy text, p_max_steps int, p_skill_ids uuid[] default '{}',
  p_schedule text default 'off', p_schedule_hour int default 9, p_schedule_task text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_skills uuid[]; v_schedule text; v_hour int;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select coalesce(array_agg(s.id), '{}') into v_skills
    from skills s where s.workspace_id = p_workspace and s.id = any(coalesce(p_skill_ids, '{}'));

  -- Unknown values fall back to 'off' rather than raising: a bad schedule must
  -- never mean an agent runs on a cadence nobody chose.
  v_schedule := case when p_schedule in ('off','hourly','daily','weekly') then p_schedule else 'off' end;
  v_hour     := least(23, greatest(0, coalesce(p_schedule_hour, 9)));

  -- A schedule with no task is 'off'. There is nothing for an unattended run to
  -- do, and storing it as scheduled would show a cadence in the UI that never
  -- produces a run.
  if coalesce(btrim(p_schedule_task), '') = '' then v_schedule := 'off'; end if;

  if p_id is null then
    insert into agents (workspace_id, name, role, instructions, provider, model,
      allowed_tools, allowed_objects, autonomy, max_steps, skill_ids, created_by_privy,
      schedule, schedule_hour, schedule_task)
    values (p_workspace, coalesce(nullif(p_name,''),'New agent'), p_role, p_instructions,
      coalesce(p_provider,''), coalesce(p_model,''),
      coalesce(p_allowed_tools, '{list_objects,list_records,search_records,get_record}'),
      coalesce(p_allowed_objects, '{}'),
      coalesce(nullif(p_autonomy,''),'suggest'), coalesce(p_max_steps,12), v_skills, p_privy,
      v_schedule, v_hour, left(coalesce(p_schedule_task, ''), 2000))
    returning id into v_id;
  else
    update agents set name = p_name, role = p_role, instructions = p_instructions,
      provider = coalesce(p_provider,''), model = coalesce(p_model,''),
      allowed_tools = coalesce(p_allowed_tools, allowed_tools),
      allowed_objects = coalesce(p_allowed_objects, allowed_objects),
      autonomy = coalesce(nullif(p_autonomy,''), autonomy), max_steps = coalesce(p_max_steps, max_steps),
      skill_ids = v_skills,
      schedule = v_schedule, schedule_hour = v_hour,
      schedule_task = left(coalesce(p_schedule_task, ''), 2000)
    where id = p_id and workspace_id = p_workspace
    returning id into v_id;
  end if;
  return v_id;
end $$;
grant execute on function save_agent(text, uuid, uuid, text, text, text, text, text, text[], text[], text, int, uuid[], text, int, text)
  to authenticated, anon;

-- Must return the new columns, or the editor reopens with the schedule blank
-- and the next save silently turns it off — the same failure 0068 called out
-- for skill_ids.
create or replace function get_agents(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.updated_at desc) from (
    select id, name, role, instructions, provider, model, allowed_tools, allowed_objects,
           autonomy, max_steps, skill_ids, enabled,
           schedule, schedule_hour, schedule_task, last_run_at, updated_at
    from agents where workspace_id = p_workspace
  ) a), '[]'::jsonb);
end $$;
grant execute on function get_agents(text, uuid) to authenticated, anon;

/**
 * Claim the agents that are due, marking them run in the same statement.
 *
 * FOR UPDATE SKIP LOCKED and a claim-before-work shape, for the reason every
 * other dispatcher in this codebase uses it: two overlapping cron ticks must
 * never be handed the same agent. Here a double-claim would mean two unattended
 * runs spending the customer's own AI credit twice on the same task.
 *
 * `last_run_at` is stamped at CLAIM time, not on completion. A run that crashes
 * must not become a hot loop that retries every minute for the rest of the day
 * — waiting for the next slot is the correct recovery for a scheduled job.
 *
 * Due-ness is deliberately loose (a full interval since the last run, and for
 * daily/weekly the hour must match). An agent that misses its 09:00 slot
 * because the cron was down runs at 10:00 the same day rather than being
 * skipped until tomorrow.
 */
create or replace function claim_due_agents(p_limit int default 5)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb;
begin
  with candidate as (
    select a.id
      from agents a
     where a.enabled
       and a.schedule <> 'off'
       and btrim(a.schedule_task) <> ''
       and case a.schedule
             when 'hourly' then a.last_run_at is null or a.last_run_at < now() - interval '1 hour'
             when 'daily'  then (a.last_run_at is null or a.last_run_at < now() - interval '23 hours')
                                and extract(hour from now() at time zone 'UTC') >= a.schedule_hour
             when 'weekly' then (a.last_run_at is null or a.last_run_at < now() - interval '6 days 23 hours')
                                and extract(hour from now() at time zone 'UTC') >= a.schedule_hour
             else false
           end
     order by a.last_run_at nulls first
     limit greatest(1, least(coalesce(p_limit, 5), 25))
     for update skip locked
  ), claimed as (
    update agents a set last_run_at = now()
      from candidate c
     where a.id = c.id
    returning a.id, a.workspace_id, a.name, a.schedule_task
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', cl.id, 'workspace_id', cl.workspace_id,
           'name', cl.name, 'task', cl.schedule_task)), '[]'::jsonb)
    into v_rows
    from claimed cl;

  return v_rows;
end $$;
revoke all on function claim_due_agents(int) from public, authenticated, anon;
grant execute on function claim_due_agents(int) to service_role;

/**
 * Who an unattended run acts as.
 *
 * There is no such thing as an unattributed actor here: every tool derives its
 * tenancy from `p_privy` in SQL, so a run with no identity would either see
 * nothing or need a bypass — and a bypass is exactly how one tenant's agent
 * ends up reading another's data.
 *
 * So the run is attributed to the member who added the AI key being spent. That
 * is the honest choice on both counts: it is their credit, and their
 * permissions are the ones the workspace already agreed the agent may use.
 * Falls back to the oldest workspace member when the key row predates
 * `created_by_privy`, and returns null when the workspace has no key at all —
 * which the dispatcher treats as "nothing to do", not as an error.
 */
create or replace function get_workspace_ai_owner(p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_privy text;
begin
  select nullif(a.created_by_privy, '') into v_privy
    from ai_providers a
   where a.workspace_id = p_workspace and a.enabled
   order by a.is_default desc, a.created_at
   limit 1;

  if v_privy is null then
    -- No key at all → no owner. Distinct from "key exists but has no author".
    if not exists (select 1 from ai_providers a where a.workspace_id = p_workspace and a.enabled) then
      return null;
    end if;
    select ac.privy_user_id into v_privy
      from accounts ac where ac.workspace_id = p_workspace
     order by ac.created_at nulls last limit 1;
  end if;

  -- The author may have left the workspace since. Acting as someone who is no
  -- longer a member would be a privilege that outlives their membership.
  if v_privy is null or not is_workspace_member(p_workspace, v_privy) then
    select ac.privy_user_id into v_privy
      from accounts ac where ac.workspace_id = p_workspace
     order by ac.created_at nulls last limit 1;
  end if;

  if v_privy is null then return null; end if;
  return jsonb_build_object('privy_user_id', v_privy);
end $$;
revoke all on function get_workspace_ai_owner(uuid) from public, authenticated, anon;
grant execute on function get_workspace_ai_owner(uuid) to service_role;

notify pgrst, 'reload schema';
