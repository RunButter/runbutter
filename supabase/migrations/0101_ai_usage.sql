-- 0101: what is AI costing this workspace, across ALL of it
--
-- WHY THIS EXISTS. 0096 answered "which agent is spending my money" and stopped
-- there, because `agent_runs` is the only place a token count had somewhere to
-- live. Every other AI call in the product went through `callAI`, which
-- returned a bare string and threw the provider's usage block away at the
-- source — so the writing assistant, the newsletter drafter, the workspace
-- builder, the skill generator and the AI step inside automations were all
-- invisible. Five features, one of them (automations) running unattended on a
-- cron, and the usage screen showed a confident total that excluded every one
-- of them.
--
-- COUNTED, NEVER ESTIMATED — the same rule as 0096. These columns hold what the
-- provider reported. Nothing derives tokens from character counts: a number
-- that looks authoritative and is guessed is worse than no number, which is why
-- `unreported` is its own bucket rather than being folded into zero.
--
-- `cached_tokens` IS A SUBSET OF `input_tokens`, not an addition. Anthropic
-- reports cache reads outside `input_tokens`; the client folds them in before
-- they get here so the meaning is identical on every provider.

create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- Who ran it. Kept as the privy id rather than a FK: the row survives the
  -- person leaving, and a cost report with a hole where a departed colleague
  -- used to be is the report nobody trusts.
  privy_user_id text,
  -- Which part of the product. A short stable slug, not a display name —
  -- renaming a screen must not split its history into two rows.
  feature text not null,
  provider text not null default '',
  model text not null default '',
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  cached_tokens bigint not null default 0,
  -- A failed call still costs. A model that spends its whole budget thinking
  -- and returns nothing is billed in full, and it is exactly the call somebody
  -- is trying to find when they ask why the bill is high.
  ok boolean not null default true,
  created_at timestamptz not null default now()
);

comment on column ai_usage.cached_tokens is
  'Part of input_tokens served from a prompt cache. A SUBSET of input_tokens — never add the two.';

-- The only query this table has: a workspace over a window. Ordering by
-- created_at inside the index means the window predicate is the index scan
-- rather than a filter over every row the workspace ever wrote.
create index if not exists idx_ai_usage_ws_time on ai_usage (workspace_id, created_at desc);

alter table ai_usage enable row level security;
-- No policy, deliberately: this table is written by service_role through
-- `record_ai_usage` and read through `get_ai_usage`, both SECURITY DEFINER.
-- A browser-reachable INSERT here would let anyone write numbers into their own
-- cost report, which is a strange thing to want and a worse thing to allow.

-- ── Writing ─────────────────────────────────────────────────────────────────
--
-- service_role only, and deliberately ABSENT from /api/rpc's ALLOWED list —
-- same rule as `claim_excel_links` and the social token functions. A client
-- that could write here could also hide its own spend.
create or replace function record_ai_usage(
  p_workspace uuid, p_privy text, p_feature text, p_provider text, p_model text,
  p_input bigint, p_output bigint, p_cached bigint, p_ok boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  -- A usage row is never worth failing the request that produced it. The caller
  -- already has the user's answer in hand; losing the accounting is a smaller
  -- harm than losing the work, so anything unusable is dropped quietly here
  -- rather than raised into a route that has nothing useful to do with it.
  if p_workspace is null or coalesce(p_feature,'') = '' then return; end if;
  insert into ai_usage (workspace_id, privy_user_id, feature, provider, model,
                        input_tokens, output_tokens, cached_tokens, ok)
  values (p_workspace, nullif(p_privy,''), p_feature, coalesce(p_provider,''), coalesce(p_model,''),
          greatest(coalesce(p_input,0),0), greatest(coalesce(p_output,0),0),
          greatest(coalesce(p_cached,0),0), coalesce(p_ok,true));
end $$;
revoke all on function record_ai_usage(uuid, text, text, text, text, bigint, bigint, bigint, boolean) from public, authenticated, anon;
grant execute on function record_ai_usage(uuid, text, text, text, text, bigint, bigint, bigint, boolean) to service_role;

-- ── Reading ─────────────────────────────────────────────────────────────────
--
-- ONE FUNCTION OVER BOTH TABLES, and that is the point of the migration rather
-- than an optimisation. Agent spend lives in `agent_runs` and everything else
-- lives in `ai_usage`; a screen that reads one of them is the same bug this
-- migration exists to fix, one level up. So the union happens here, in SQL,
-- where it cannot be forgotten by the next caller.
--
-- `p_days` is clamped: an unbounded window with no date predicate is a
-- sequential scan somebody triggers by typing a large number into a URL.
create or replace function get_ai_usage(p_privy text, p_workspace uuid, p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  v_since := now() - make_interval(days => v_days);

  return (
    with rows as (
      select feature, provider, model, input_tokens, output_tokens, cached_tokens, ok, created_at
      from ai_usage
      where workspace_id = p_workspace and created_at > v_since
      union all
      -- Agent runs, as one feature. `agent_runs` has no provider column, so it
      -- reports blank rather than a guess — the model is what identifies the
      -- spend anyway, and inventing a provider from a model name would be wrong
      -- for exactly the OpenRouter and custom-gateway rows that need it most.
      select 'agents', '', model, input_tokens, output_tokens, cached_tokens,
             status <> 'error', created_at
      from agent_runs
      where workspace_id = p_workspace and created_at > v_since
    )
    select jsonb_build_object(
      'days', v_days,
      'totals', (
        select jsonb_build_object(
          'calls', count(*),
          'input', coalesce(sum(input_tokens),0),
          'output', coalesce(sum(output_tokens),0),
          'cached', coalesce(sum(cached_tokens),0),
          'failed', count(*) filter (where not ok),
          -- Calls that reported nothing at all. Without this the screen cannot
          -- tell "cheap" from "this gateway does not report usage", and would
          -- present a total missing an unknown share of the spend.
          'unreported', count(*) filter (where input_tokens = 0 and output_tokens = 0)
        ) from rows
      ),
      'by_feature', coalesce((
        select jsonb_agg(x order by (x->>'input')::bigint + (x->>'output')::bigint desc) from (
          select jsonb_build_object(
            'feature', feature, 'calls', count(*),
            'input', coalesce(sum(input_tokens),0),
            'output', coalesce(sum(output_tokens),0),
            'cached', coalesce(sum(cached_tokens),0),
            'failed', count(*) filter (where not ok)
          ) as x
          from rows group by feature
        ) a
      ), '[]'::jsonb),
      'by_model', coalesce((
        select jsonb_agg(x order by (x->>'input')::bigint + (x->>'output')::bigint desc) from (
          select jsonb_build_object(
            'model', nullif(model,''), 'provider', max(provider), 'calls', count(*),
            'input', coalesce(sum(input_tokens),0),
            'output', coalesce(sum(output_tokens),0),
            'cached', coalesce(sum(cached_tokens),0)
          ) as x
          from rows group by model
        ) a
      ), '[]'::jsonb),
      -- A day series, so a spike has a date on it. Zero-filled from
      -- generate_series: a chart that silently omits quiet days compresses the
      -- x-axis and makes every gap look like activity.
      'daily', coalesce((
        select jsonb_agg(jsonb_build_object(
          'day', to_char(d.day, 'YYYY-MM-DD'),
          'input', coalesce(r.input, 0), 'output', coalesce(r.output, 0)
        ) order by d.day)
        from generate_series(date_trunc('day', v_since), date_trunc('day', now()), interval '1 day') as d(day)
        left join (
          select date_trunc('day', created_at) as day,
                 sum(input_tokens) as input, sum(output_tokens) as output
          from rows group by 1
        ) r on r.day = d.day
      ), '[]'::jsonb)
    )
  );
end $$;
grant execute on function get_ai_usage(text, uuid, int) to authenticated, anon;

notify pgrst, 'reload schema';
