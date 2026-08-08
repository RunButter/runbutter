-- 0096: what did that agent cost?
--
-- WHY THIS EXISTS. Every provider returns a token count on every response and
-- RunButter dropped it on the floor. So the one question a BYO-key customer
-- actually has — "which agent is spending my money" — had no answer anywhere in
-- the product, and the only place to look was the provider's own billing page,
-- which knows nothing about agents.
--
-- COUNTED, NEVER ESTIMATED. These columns hold what the provider reported.
-- Nothing here derives tokens from character counts: a number that looks
-- authoritative and is guessed is worse than no number, and the UI says "not
-- reported" rather than "0" when a gateway omits usage.
--
-- `cached_tokens` IS A SUBSET OF `input_tokens`, not an addition. Adding the two
-- together double-counts the cheap half of the bill, so the column comment says
-- so and every reader has to honour it. Anthropic reports cache reads outside
-- `input_tokens`; the client folds them in before they reach this table, so the
-- meaning is the same on every provider.

alter table agent_runs add column if not exists input_tokens  bigint not null default 0;
alter table agent_runs add column if not exists output_tokens bigint not null default 0;
alter table agent_runs add column if not exists cached_tokens bigint not null default 0;
alter table agent_runs add column if not exists model text not null default '';

comment on column agent_runs.cached_tokens is
  'Part of input_tokens served from a prompt cache. A SUBSET of input_tokens — never add the two.';

-- `finish_agent_run` gains the counts. Signature change, so the old definition
-- is dropped first: adding a parameter to a Postgres function creates an
-- OVERLOAD rather than replacing it, and PostgREST would then pick between two
-- live definitions by argument name.
drop function if exists finish_agent_run(uuid, text, jsonb, jsonb, text);
create or replace function finish_agent_run(
  p_id uuid, p_status text, p_steps jsonb, p_proposed jsonb, p_result text,
  -- NULL means "leave the column alone", exactly as `update_record` reads an
  -- absent key (0088). This is not a style choice: `/api/agents/approve` calls
  -- this function a second time to close an approved run, and it has no usage
  -- to pass. With a `0` default that second call would silently ERASE the token
  -- count of every run anybody approved — the runs that matter most, wiped by
  -- the act of accepting them.
  p_input_tokens bigint default null, p_output_tokens bigint default null,
  p_cached_tokens bigint default null, p_model text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  update agent_runs set status = p_status, steps = coalesce(p_steps,'[]'::jsonb),
    proposed = coalesce(p_proposed,'[]'::jsonb), result = coalesce(p_result,''),
    input_tokens = greatest(coalesce(p_input_tokens, input_tokens), 0),
    output_tokens = greatest(coalesce(p_output_tokens, output_tokens), 0),
    cached_tokens = greatest(coalesce(p_cached_tokens, cached_tokens), 0),
    model = coalesce(nullif(p_model, ''), model),
    finished_at = case when p_status in ('done','error') then now() else finished_at end
  where id = p_id;
end $$;
revoke all on function finish_agent_run(uuid, text, jsonb, jsonb, text, bigint, bigint, bigint, text) from public, authenticated, anon;
grant execute on function finish_agent_run(uuid, text, jsonb, jsonb, text, bigint, bigint, bigint, text) to service_role;

-- Spend, by agent, over a window.
--
-- Aggregated in SQL rather than by reading fifty runs into the browser and
-- summing: `get_agent_runs` caps at fifty, so a busy workspace would silently
-- report a month's cost from whatever fitted in the last fifty rows — a wrong
-- number with no symptom.
--
-- `p_days` is clamped. An unbounded window on a table with no date predicate is
-- a sequential scan somebody triggers by typing a large number into a URL.
create or replace function get_agent_usage(p_privy text, p_workspace uuid, p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_days int := least(greatest(coalesce(p_days, 30), 1), 365);
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return jsonb_build_object(
    'days', v_days,
    'totals', (
      select jsonb_build_object(
        'runs', count(*),
        'input', coalesce(sum(input_tokens), 0),
        'output', coalesce(sum(output_tokens), 0),
        'cached', coalesce(sum(cached_tokens), 0),
        -- Runs that reported nothing at all. Without this the UI cannot tell
        -- "cheap" from "this gateway does not report usage", and would present
        -- a confident total that is missing an unknown share of the spend.
        'unreported', count(*) filter (where input_tokens = 0 and output_tokens = 0)
      )
      from agent_runs
      where workspace_id = p_workspace and created_at > now() - make_interval(days => v_days)
    ),
    -- GROUPED BY id OR NAME, not by id alone.
    --
    -- `agent_runs.agent_id` is `on delete set null` (0043), so every deleted
    -- agent's runs carry a null id — and grouping on that alone folds all of
    -- them into ONE row labelled with whichever name happened to sort highest.
    -- Three deleted agents then appear as one big spender that never existed.
    -- `agent_name` is snapshotted on the run, so it still identifies them.
    --
    -- Ordered by total, not by input: an agent that writes long summaries costs
    -- more per token than one that reads, and ranking on input alone would put
    -- the cheaper one at the top.
    'by_agent', coalesce((
      select jsonb_agg(a order by (a->>'input')::bigint + (a->>'output')::bigint desc) from (
        select jsonb_build_object(
          'agent_id', max(agent_id::text),
          'name', max(agent_name),
          'model', max(model),
          'runs', count(*),
          'input', coalesce(sum(input_tokens), 0),
          'output', coalesce(sum(output_tokens), 0),
          'cached', coalesce(sum(cached_tokens), 0)
        ) as a
        from agent_runs
        where workspace_id = p_workspace and created_at > now() - make_interval(days => v_days)
        group by coalesce(agent_id::text, 'deleted:' || agent_name)
      ) x
    ), '[]'::jsonb)
  );
end $$;
grant execute on function get_agent_usage(text, uuid, int) to authenticated, anon;

notify pgrst, 'reload schema';
