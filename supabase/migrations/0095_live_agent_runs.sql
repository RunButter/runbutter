-- 0095: watch an agent work.
--
-- WHY THIS EXISTS. `agent_runs.steps` has recorded every thought and tool call
-- since 0043 — and the runner built that array in memory and wrote it ONCE, in
-- `finish_agent_run`, after the whole loop had finished. So a run that takes
-- forty seconds and calls nine tools showed a spinner for forty seconds and
-- then a wall of text. The most interesting thing the product does was
-- invisible while it was happening.
--
-- Nothing here changes the schema. It adds the two functions that let the steps
-- be written as they happen and read while the run is still going:
--
--   append_agent_run_step  service_role, called by the runner once per step
--   get_agent_run          membership-checked, called by the browser to poll
--
-- WHY POLLING AND NOT REALTIME. Supabase Realtime needs anon-key RLS policies
-- on the table, which would undo the /api/rpc proxy that every other read goes
-- through — the same reason team chat (0075) polls. A run emits a step every
-- few seconds at most, so a 1.2s poll is well inside "live" and costs one
-- indexed primary-key read.
--
-- `finish_agent_run` STILL WRITES THE WHOLE ARRAY and remains the source of
-- truth. The appends are a progress feed: if one fails, the run is unaffected
-- and the complete transcript lands at the end anyway. That is why the runner
-- ignores errors from it, and why this is not a schema change.

-- Append one step to a run in progress, or replace the last one.
--
-- WHY REPLACE EXISTS. A tool call is announced BEFORE it runs — a lookup that
-- takes four seconds should read as one that is taking four seconds, not appear
-- retroactively once it is already done. So the runner writes the call with
-- `status: 'running'`, then writes it again with its result. Replacing the last
-- element keeps the stored transcript identical to the array the runner holds
-- in memory, which is what `finish_agent_run` writes at the end; without it the
-- live view and the final record would disagree about how many steps there were.
--
-- `jsonb - integer` deletes an array element by index, so dropping the last one
-- is a single expression. The alternative — sending the whole growing array on
-- every step — re-transmits every tool result already stored, and `list_records`
-- results are not small.
--
-- jsonb_build_array wraps the step at THIS level rather than at the call site so
-- a caller passing an array can never flatten two steps into the transcript.
create or replace function append_agent_run_step(p_id uuid, p_step jsonb, p_replace_last boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  update agent_runs
     set steps = case
                   when p_replace_last and jsonb_array_length(coalesce(steps, '[]'::jsonb)) > 0
                     then (steps - (jsonb_array_length(steps) - 1)) || jsonb_build_array(p_step)
                   else coalesce(steps, '[]'::jsonb) || jsonb_build_array(p_step)
                 end
   where id = p_id
     -- A finished run is closed. Without this, a late append from a crashed
     -- loop could reopen the transcript of a run somebody has already read.
     and status = 'running';
end $$;
revoke all on function append_agent_run_step(uuid, jsonb, boolean) from public, authenticated, anon;
grant execute on function append_agent_run_step(uuid, jsonb, boolean) to service_role;

-- The caller may now name the run.
--
-- WHY. `POST /api/agents/run` does not answer until the loop has finished, so
-- the id it returns arrives exactly when the live view stops being useful. The
-- browser therefore mints a uuid, sends it with the task, and starts polling
-- immediately — the ordinary idempotency-key shape.
--
-- A client-chosen id is only safe because it CANNOT TAKE OVER AN EXISTING ROW.
-- `on conflict do nothing` leaves a colliding insert with no returned id, and
-- the function then falls back to a server-generated one. So the worst a client
-- achieves by guessing another workspace's run id is getting a different id back
-- than it asked for — never a write into somebody else's run.
--
-- Signature change, so the old one is DROPPED first: adding a parameter to a
-- Postgres function creates an overload rather than replacing it, and both
-- definitions would then be live with PostgREST picking by argument names.
drop function if exists create_agent_run(uuid, uuid, text, text, text);
create or replace function create_agent_run(
  p_workspace uuid, p_agent_id uuid, p_agent_name text, p_task text, p_privy text,
  p_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_id is not null then
    insert into agent_runs (id, workspace_id, agent_id, agent_name, task, created_by_privy)
    values (p_id, p_workspace, p_agent_id, p_agent_name, p_task, p_privy)
    on conflict (id) do nothing
    returning id into v_id;
    if v_id is not null then return v_id; end if;
  end if;
  insert into agent_runs (workspace_id, agent_id, agent_name, task, created_by_privy)
  values (p_workspace, p_agent_id, p_agent_name, p_task, p_privy) returning id into v_id;
  return v_id;
end $$;
revoke all on function create_agent_run(uuid, uuid, text, text, text, uuid) from public, authenticated, anon;
grant execute on function create_agent_run(uuid, uuid, text, text, text, uuid) to service_role;

-- Read ONE run, for polling.
--
-- `get_agent_runs` (0043) returns the last fifty with their full step arrays,
-- which is the wrong shape to call every 1.2 seconds — it grows with the
-- workspace's history and re-sends every transcript to learn about one. This
-- reads a single row by primary key and checks membership on the run's OWN
-- workspace, so an id belonging to another tenant resolves to null rather than
-- to a permission error that confirms the id exists.
create or replace function get_agent_run(p_privy text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec record;
begin
  select r.id, r.agent_id, r.agent_name, r.task, r.status, r.steps, r.proposed,
         r.result, r.created_at, r.finished_at, r.workspace_id
    into rec
    from agent_runs r where r.id = p_id;
  if not found then return null; end if;
  if not is_workspace_member(rec.workspace_id, p_privy) then return null; end if;
  return to_jsonb(rec) - 'workspace_id';
end $$;
grant execute on function get_agent_run(text, uuid) to authenticated, anon;

notify pgrst, 'reload schema';
