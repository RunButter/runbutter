-- 0104: a workspace's own model prices
--
-- `lib/ai/pricing.ts` ships list prices with a date on them, and says in its own
-- header that a shipped table cannot be the final answer. This is the other
-- half: the numbers a workspace is ACTUALLY billed.
--
-- Three cases the shipped table can never get right, all of them common:
--   • A negotiated rate. Anyone spending real money has one.
--   • OpenRouter, whose price for the same model varies by which upstream served
--     it — there is no single number to ship.
--   • A self-hosted model, which costs nothing per token and appears in the
--     shipped table as "unknown" forever.
--
-- WORKSPACE-SCOPED, NOT GLOBAL. A price is a fact about somebody's contract, not
-- about the model, so one workspace's negotiated rate must never become another
-- workspace's estimate.
--
-- USD per MILLION tokens, matching both how providers publish and how the
-- shipped table stores them. Per-token would be six leading zeros and a typo
-- nobody catches in review.

create table if not exists model_prices (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- Stored lowercase so matching cannot depend on how somebody typed it; the
  -- client matches exact-then-prefix, exactly as `priceFor` does.
  model text not null,
  input_usd  numeric(12,6) not null default 0,
  output_usd numeric(12,6) not null default 0,
  -- NULL means "billed as input", which is what most providers do. NOT zero:
  -- zero claims cache reads are free, which under-reports precisely the agent
  -- loops that cache the most.
  cached_usd numeric(12,6),
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (workspace_id, model)
);

alter table model_prices enable row level security;
-- No policies: everything goes through the SECURITY DEFINER functions below.

create or replace function get_model_prices(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_object_agg(model, jsonb_build_object(
      'input', input_usd, 'output', output_usd, 'cached', cached_usd, 'note', note
    ))
    from model_prices where workspace_id = p_workspace
  ), '{}'::jsonb);
end $$;
grant execute on function get_model_prices(text, uuid) to authenticated, anon;

-- Owner/admin only. A price changes what every cost figure in the workspace
-- says, which is the same class of change as branding or the plan — not
-- something one member should do to everyone else's numbers.
create or replace function save_model_price(
  p_privy text, p_workspace uuid, p_model text,
  p_input numeric, p_output numeric, p_cached numeric, p_note text
) returns void language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from accounts
   where workspace_id = p_workspace and privy_user_id = p_privy;
  if v_role is null or v_role not in ('owner','admin') then raise exception 'NOT_ALLOWED'; end if;
  if coalesce(trim(p_model), '') = '' then raise exception 'MODEL_REQUIRED'; end if;
  -- A negative price is not a discount, it is a typo that makes spend shrink as
  -- usage grows.
  if p_input < 0 or p_output < 0 or coalesce(p_cached, 0) < 0 then raise exception 'NEGATIVE_PRICE'; end if;

  insert into model_prices (workspace_id, model, input_usd, output_usd, cached_usd, note)
  values (p_workspace, lower(trim(p_model)), p_input, p_output, p_cached, coalesce(p_note, ''))
  on conflict (workspace_id, model) do update set
    input_usd = excluded.input_usd, output_usd = excluded.output_usd,
    cached_usd = excluded.cached_usd, note = excluded.note, updated_at = now();
end $$;
grant execute on function save_model_price(text, uuid, text, numeric, numeric, numeric, text) to authenticated, anon;

create or replace function delete_model_price(p_privy text, p_workspace uuid, p_model text)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from accounts
   where workspace_id = p_workspace and privy_user_id = p_privy;
  if v_role is null or v_role not in ('owner','admin') then raise exception 'NOT_ALLOWED'; end if;
  -- Deleting an override falls BACK to the shipped list price. It does not make
  -- the model unpriced — that is what makes an override an override.
  delete from model_prices where workspace_id = p_workspace and model = lower(trim(p_model));
end $$;
grant execute on function delete_model_price(text, uuid, text) to authenticated, anon;

notify pgrst, 'reload schema';
