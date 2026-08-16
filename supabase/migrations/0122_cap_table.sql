-- ============================================================================
-- RunButter — 0122_cap_table.sql
--
-- Who owns the company, and what a round would do to that.
--
-- ── WHY THIS BELONGS HERE ───────────────────────────────────────────────────
-- Every founder keeps a cap table in a spreadsheet, it is wrong within two
-- months, and the version sent to an investor is a screenshot of the wrong one.
-- Carta and Pulley solve it and cost more than this whole product; a startup
-- with four people and two SAFEs is not buying either.
--
-- It also sits next to the things that make it useful: runway (0116), the
-- investor update, and the finance KPIs. "18 months of runway, 12% diluted by
-- the next round" is one screen here and two products anywhere else.
--
-- ── ONE TABLE WITH A KIND, NOT FOUR ─────────────────────────────────────────
-- Shares, options, SAFEs and convertible notes are all `cap_securities` rows
-- distinguished by `kind`, the same call `docs` makes for its four kinds. They
-- share a holder, a date and a workspace, they are always read together, and
-- four tables would mean four joins to answer the only question anybody asks.
--
-- ── A SAFE HAS NO OWNERSHIP PERCENTAGE, AND THIS REFUSES TO INVENT ONE ──────
-- The single most common lie in a homemade cap table. A SAFE is a promise of
-- future equity whose amount depends on a valuation that has not happened; any
-- percentage shown against it today is a guess dressed as a holding. So SAFEs
-- are returned in their OWN list with their cap and discount, excluded from
-- every percentage, and counted only inside `simulate_round`, where a real
-- pre-money number exists to convert them at.
--
-- ── FULLY DILUTED INCLUDES THE UNISSUED POOL, AND SAYS SO ───────────────────
-- Investors mean "including everything you could still grant" and founders
-- usually mean "what I hold today". Both numbers are returned, separately
-- named, so nobody has to guess which one a screen is showing.
--
-- ── VESTING IS COMPUTED, NEVER STORED ───────────────────────────────────────
-- Stored vested counts go stale silently every single day. `cap_vested` derives
-- it from the schedule and a date, ROUNDING DOWN — nobody has ever vested a
-- fraction of a share, and rounding up hands out equity that was not earned.
-- ============================================================================

create table if not exists cap_holders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  email text,
  -- founder | investor | employee | advisor | entity
  kind text not null default 'investor',
  -- Optional link to the CRM. A cap table can hold names that are not people
  -- in this workspace (a fund, an estate), so it is nullable and never required.
  person_id uuid references people(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_cap_holders_ws on cap_holders(workspace_id);

create table if not exists cap_securities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  holder_id uuid not null references cap_holders(id) on delete cascade,
  -- shares | option | safe | note
  kind text not null default 'shares',
  -- Free text: 'Common', 'Seed Preferred', 'Series A'. A class TABLE would be
  -- right for a company with liquidation preferences to model, and this does
  -- not model preferences — pretending otherwise with a schema would imply a
  -- waterfall calculation that is not here.
  class text default 'Common',

  quantity numeric(20, 4),          -- shares or options
  price_per_share numeric(20, 8),   -- what was paid
  strike numeric(20, 8),            -- options only

  amount numeric(20, 2),            -- safe / note principal
  valuation_cap numeric(20, 2),
  discount_pct numeric(6, 3),       -- 20 = 20% off the round price
  converted boolean not null default false,

  issued_on date,
  -- Vesting, in months, with a cliff. Coarse on purpose, exactly as agent
  -- schedules are: monthly is how every grant anybody signs actually vests, and
  -- a day-level schedule is a field people get wrong rather than a feature.
  vest_start date,
  vest_months int,
  cliff_months int,

  currency text not null default 'USD',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cap_securities_kind_check check (kind in ('shares', 'option', 'safe', 'note'))
);
create index if not exists idx_cap_sec_ws on cap_securities(workspace_id);
create index if not exists idx_cap_sec_holder on cap_securities(holder_id);

/**
 * The option pool, and anything else that is a property of the company rather
 * than of one holder.
 *
 * `pool_shares` is the AUTHORISED pool. Granted options come out of it; the
 * remainder is the unissued pool that fully-diluted ownership includes.
 */
create table if not exists cap_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  pool_shares numeric(20, 4) not null default 0,
  currency text not null default 'USD',
  updated_at timestamptz not null default now()
);

alter table cap_holders    enable row level security;
alter table cap_securities enable row level security;
alter table cap_settings   enable row level security;

/**
 * Vested quantity for a grant, as of a date. Rounded DOWN.
 *
 * No schedule means fully vested — a founder's shares are not an unvested
 * grant, and defaulting the other way would show every share issued before
 * anybody thought about vesting as unearned.
 */
create or replace function cap_vested(p_qty numeric, p_start date, p_months int, p_cliff int, p_as_of date)
returns numeric language sql immutable as $$
  select case
    when p_qty is null then 0
    when p_start is null or coalesce(p_months, 0) <= 0 then p_qty
    when p_as_of < p_start then 0
    -- The cliff is all-or-nothing and that is the whole point of one: a day
    -- before it, nothing is vested, however many months have passed.
    when coalesce(p_cliff, 0) > 0
         and p_as_of < (p_start + make_interval(months => p_cliff))::date then 0
    else least(
      p_qty,
      floor(p_qty * least(
        (extract(year from age(p_as_of, p_start)) * 12 + extract(month from age(p_as_of, p_start)))::numeric
          / p_months, 1)
      )
    )
  end
$$;

/**
 * The whole cap table, as of a date.
 *
 * Two percentages per holder and they are NOT interchangeable:
 *   · `pct_outstanding` — of issued shares only. What a founder means.
 *   · `pct_diluted`     — including every option granted AND the unissued pool.
 *                         What an investor means.
 * Both are returned because a single "ownership %" is the number people argue
 * about after the fact.
 */
create or replace function get_cap_table(p_privy text, p_workspace uuid, p_as_of date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_as_of date := coalesce(p_as_of, current_date);
  v_outstanding numeric;
  v_granted numeric;
  v_pool numeric;
  v_unissued numeric;
  v_diluted numeric;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  select coalesce(sum(quantity), 0) into v_outstanding from cap_securities
   where workspace_id = p_workspace and kind = 'shares'
     and coalesce(issued_on, v_as_of) <= v_as_of;

  select coalesce(sum(quantity), 0) into v_granted from cap_securities
   where workspace_id = p_workspace and kind = 'option'
     and coalesce(issued_on, v_as_of) <= v_as_of;

  select coalesce(pool_shares, 0) into v_pool from cap_settings where workspace_id = p_workspace;
  -- Never negative: over-granting a pool is a real thing that happens, and
  -- reporting a negative unissued pool would silently reduce the diluted
  -- denominator and inflate everybody's percentage.
  v_unissued := greatest(coalesce(v_pool, 0) - v_granted, 0);
  v_diluted := v_outstanding + v_granted + v_unissued;

  return jsonb_build_object(
    'as_of', v_as_of,
    'outstanding', v_outstanding,
    'options_granted', v_granted,
    'pool_authorised', coalesce(v_pool, 0),
    'pool_unissued', v_unissued,
    'fully_diluted', v_diluted,
    'holders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'name', h.name, 'kind', h.kind, 'email', h.email,
               'shares', s.shares, 'options', s.options,
               'options_vested', s.vested,
               'pct_outstanding', case when v_outstanding > 0
                                       then round(100 * s.shares / v_outstanding, 2) end,
               'pct_diluted', case when v_diluted > 0
                                   then round(100 * (s.shares + s.options) / v_diluted, 2) end
             ) order by (s.shares + s.options) desc, h.name)
        from cap_holders h
        join lateral (
          select
            coalesce(sum(c.quantity) filter (where c.kind = 'shares'), 0) as shares,
            coalesce(sum(c.quantity) filter (where c.kind = 'option'), 0) as options,
            coalesce(sum(cap_vested(c.quantity, c.vest_start, c.vest_months, c.cliff_months, v_as_of))
                     filter (where c.kind = 'option'), 0) as vested
          from cap_securities c
         where c.holder_id = h.id and coalesce(c.issued_on, v_as_of) <= v_as_of
        ) s on true
       where h.workspace_id = p_workspace
         and (s.shares > 0 or s.options > 0)
    ), '[]'::jsonb),

    /*
     * SAFEs and notes, in their own list, WITH NO PERCENTAGE.
     *
     * They convert at a price that does not exist yet. A percentage here would
     * be the most confident wrong number on the screen — use simulate_round,
     * where there is a real pre-money to convert against.
     */
    'convertibles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'holder', h.name, 'kind', c.kind,
               'amount', c.amount, 'valuation_cap', c.valuation_cap,
               'discount_pct', c.discount_pct, 'issued_on', c.issued_on,
               'currency', c.currency
             ) order by c.issued_on nulls last)
        from cap_securities c join cap_holders h on h.id = c.holder_id
       where c.workspace_id = p_workspace and c.kind in ('safe', 'note')
         and c.converted = false
    ), '[]'::jsonb)
  );
end $$;

/**
 * What a priced round does to everybody.
 *
 * ── THE CONVERSION RULE, WRITTEN DOWN ───────────────────────────────────────
 * A SAFE converts at the BETTER of its valuation cap and its discount, which is
 * what "better of" means in every standard document — the holder gets the lower
 * price per share, and therefore more shares. Getting this backwards is the
 * classic modelling error and it always favours the founder, which is why
 * nobody catches it until the lawyers do.
 *
 *   cap price      = valuation_cap / pre-money shares
 *   discount price = round price × (1 − discount)
 *   conversion     = the LOWER of whichever are set
 *
 * ── PRE-MONEY, AND THE POOL SHUFFLE ─────────────────────────────────────────
 * The round price is pre-money ÷ pre-money fully-diluted shares. If a pool
 * top-up is requested it is added to the PRE-money denominator, which is the
 * standard term and the one that dilutes existing holders rather than the new
 * investor. Stating it matters: the same words with the pool post-money is a
 * materially different deal and both are called "a 10% pool".
 *
 * ── IT IS A MODEL AND IT SAYS SO ────────────────────────────────────────────
 * No liquidation preferences, no participation, no anti-dilution, no pro-rata.
 * Those change an exit, not the ownership line, and half-modelling them would
 * produce a number that looks authoritative and is not. It writes nothing.
 */
create or replace function simulate_round(p_privy text, p_workspace uuid,
                                          p_premoney numeric, p_new_money numeric,
                                          p_pool_pct numeric default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_pre_shares numeric; v_pool_add numeric := 0;
  v_round_price numeric; v_new_shares numeric;
  v_conv_shares numeric := 0; v_conv jsonb := '[]'::jsonb;
  c record; v_cap_price numeric; v_disc_price numeric; v_price numeric; v_sh numeric;
  v_post_shares numeric; v_base jsonb;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(p_premoney, 0) <= 0 then raise exception 'PREMONEY_REQUIRED'; end if;

  v_base := get_cap_table(p_privy, p_workspace, current_date);
  v_pre_shares := (v_base->>'fully_diluted')::numeric;
  if v_pre_shares <= 0 then raise exception 'NO_SHARES'; end if;

  -- A pool top-up expressed as a share of the POST-money company, created out
  -- of the pre-money — the standard term, and the one that dilutes existing
  -- holders rather than the incoming investor.
  if coalesce(p_pool_pct, 0) > 0 then
    v_pool_add := v_pre_shares * (p_pool_pct / 100.0) / (1 - (p_pool_pct / 100.0));
    v_pre_shares := v_pre_shares + v_pool_add;
  end if;

  v_round_price := p_premoney / v_pre_shares;

  for c in
    select cs.id, cs.amount, cs.valuation_cap, cs.discount_pct, h.name
      from cap_securities cs join cap_holders h on h.id = cs.holder_id
     where cs.workspace_id = p_workspace and cs.kind in ('safe','note') and cs.converted = false
       and coalesce(cs.amount, 0) > 0
  loop
    v_cap_price := case when coalesce(c.valuation_cap, 0) > 0
                        then c.valuation_cap / v_pre_shares end;
    v_disc_price := case when coalesce(c.discount_pct, 0) > 0
                         then v_round_price * (1 - c.discount_pct / 100.0) end;
    -- least() ignores NULLs, so a SAFE with only a cap or only a discount works
    -- without a branch; one with neither converts at the round price, which is
    -- what an uncapped, undiscounted SAFE actually does.
    v_price := coalesce(least(v_cap_price, v_disc_price), v_round_price);
    if v_price <= 0 then continue; end if;

    v_sh := floor(c.amount / v_price);
    v_conv_shares := v_conv_shares + v_sh;
    v_conv := v_conv || jsonb_build_array(jsonb_build_object(
      'holder', c.name, 'amount', c.amount, 'price', round(v_price, 6), 'shares', v_sh,
      'converted_at', case when v_cap_price is not null and v_price = v_cap_price then 'cap'
                           when v_disc_price is not null and v_price = v_disc_price then 'discount'
                           else 'round price' end));
  end loop;

  v_new_shares := case when v_round_price > 0 then floor(coalesce(p_new_money, 0) / v_round_price) else 0 end;
  v_post_shares := v_pre_shares + v_conv_shares + v_new_shares;

  return jsonb_build_object(
    'premoney', p_premoney,
    'new_money', coalesce(p_new_money, 0),
    'postmoney', p_premoney + coalesce(p_new_money, 0),
    'round_price', round(v_round_price, 6),
    'pre_shares', v_pre_shares,
    'pool_added', v_pool_add,
    'converted_shares', v_conv_shares,
    'new_shares', v_new_shares,
    'post_shares', v_post_shares,
    'conversions', v_conv,
    -- Before and side by side, because the number anybody wants is the CHANGE.
    'holders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', h->>'name',
               'before_pct', (h->>'pct_diluted')::numeric,
               'after_pct', case when v_post_shares > 0 then
                 round(100 * (coalesce((h->>'shares')::numeric,0) + coalesce((h->>'options')::numeric,0))
                       / v_post_shares, 2) end
             ) order by (h->>'pct_diluted')::numeric desc nulls last)
        from jsonb_array_elements(v_base->'holders') h
    ), '[]'::jsonb),
    'new_investors_pct', case when v_post_shares > 0 then round(100 * v_new_shares / v_post_shares, 2) end,
    'safe_holders_pct', case when v_post_shares > 0 then round(100 * v_conv_shares / v_post_shares, 2) end,
    'note', 'Ownership only. No liquidation preferences, participation, anti-dilution or pro-rata are modelled.'
  );
end $$;

-- ── Writes ──────────────────────────────────────────────────────────────────

create or replace function save_cap_holder(p_privy text, p_workspace uuid, p_id uuid,
                                           p_name text, p_kind text, p_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'NAME_REQUIRED'; end if;
  if coalesce(p_kind, 'investor') not in ('founder','investor','employee','advisor','entity') then
    raise exception 'INVALID_KIND';
  end if;

  if p_id is null then
    insert into cap_holders (workspace_id, name, kind, email)
    values (p_workspace, trim(p_name), coalesce(p_kind,'investor'), nullif(trim(coalesce(p_email,'')),''))
    returning id into v_id;
  else
    update cap_holders set name = trim(p_name), kind = coalesce(p_kind, kind),
           email = nullif(trim(coalesce(p_email,'')),'')
     where id = p_id and workspace_id = p_workspace returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  return v_id;
end $$;

create or replace function save_cap_security(p_privy text, p_workspace uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_holder uuid; v_kind text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  -- The holder is re-checked against the workspace rather than trusted, the
  -- same reason create_pipeline_record re-checks its company: an id from
  -- another tenant would otherwise attach a holding to a stranger's cap table.
  select id into v_holder from cap_holders
   where id = nullif(p_data->>'holder_id','')::uuid and workspace_id = p_workspace;
  if v_holder is null then raise exception 'HOLDER_NOT_FOUND'; end if;

  v_kind := coalesce(nullif(p_data->>'kind',''), 'shares');
  if v_kind not in ('shares','option','safe','note') then raise exception 'INVALID_KIND'; end if;

  if p_id is null then
    insert into cap_securities (workspace_id, holder_id, kind, class, quantity, price_per_share,
                                strike, amount, valuation_cap, discount_pct, issued_on,
                                vest_start, vest_months, cliff_months, currency, notes)
    values (p_workspace, v_holder, v_kind,
            coalesce(nullif(p_data->>'class',''), 'Common'),
            nullif(p_data->>'quantity','')::numeric,
            nullif(p_data->>'price_per_share','')::numeric,
            nullif(p_data->>'strike','')::numeric,
            nullif(p_data->>'amount','')::numeric,
            nullif(p_data->>'valuation_cap','')::numeric,
            nullif(p_data->>'discount_pct','')::numeric,
            nullif(p_data->>'issued_on','')::date,
            nullif(p_data->>'vest_start','')::date,
            nullif(p_data->>'vest_months','')::int,
            nullif(p_data->>'cliff_months','')::int,
            coalesce(nullif(p_data->>'currency',''), 'USD'),
            nullif(p_data->>'notes',''))
    returning id into v_id;
  else
    -- Partial-update semantics, exactly as update_record has since 0088: key
    -- ABSENT leaves the column alone, key PRESENT writes it including null.
    update cap_securities set
      kind            = v_kind,
      holder_id       = v_holder,
      class           = case when p_data ? 'class' then coalesce(nullif(p_data->>'class',''),'Common') else class end,
      quantity        = case when p_data ? 'quantity' then nullif(p_data->>'quantity','')::numeric else quantity end,
      price_per_share = case when p_data ? 'price_per_share' then nullif(p_data->>'price_per_share','')::numeric else price_per_share end,
      strike          = case when p_data ? 'strike' then nullif(p_data->>'strike','')::numeric else strike end,
      amount          = case when p_data ? 'amount' then nullif(p_data->>'amount','')::numeric else amount end,
      valuation_cap   = case when p_data ? 'valuation_cap' then nullif(p_data->>'valuation_cap','')::numeric else valuation_cap end,
      discount_pct    = case when p_data ? 'discount_pct' then nullif(p_data->>'discount_pct','')::numeric else discount_pct end,
      converted       = case when p_data ? 'converted' then (p_data->>'converted')::boolean else converted end,
      issued_on       = case when p_data ? 'issued_on' then nullif(p_data->>'issued_on','')::date else issued_on end,
      vest_start      = case when p_data ? 'vest_start' then nullif(p_data->>'vest_start','')::date else vest_start end,
      vest_months     = case when p_data ? 'vest_months' then nullif(p_data->>'vest_months','')::int else vest_months end,
      cliff_months    = case when p_data ? 'cliff_months' then nullif(p_data->>'cliff_months','')::int else cliff_months end,
      notes           = case when p_data ? 'notes' then nullif(p_data->>'notes','') else notes end,
      updated_at      = now()
     where id = p_id and workspace_id = p_workspace returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  return v_id;
end $$;

create or replace function delete_cap_security(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  delete from cap_securities where id = p_id and workspace_id = p_workspace;
  get diagnostics n = row_count; return n > 0;
end $$;

create or replace function delete_cap_holder(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- Cascades to their securities. Deleting a holder while leaving orphaned
  -- holdings would silently change everybody else's percentage.
  delete from cap_holders where id = p_id and workspace_id = p_workspace;
  get diagnostics n = row_count; return n > 0;
end $$;

create or replace function set_option_pool(p_privy text, p_workspace uuid, p_shares numeric)
returns numeric language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  insert into cap_settings (workspace_id, pool_shares) values (p_workspace, greatest(coalesce(p_shares,0), 0))
  on conflict (workspace_id) do update set pool_shares = excluded.pool_shares, updated_at = now();
  return greatest(coalesce(p_shares,0), 0);
end $$;

create or replace function list_cap_holders(p_privy text, p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'name', h.name, 'kind', h.kind, 'email', h.email,
             'securities', coalesce((
               select jsonb_agg(to_jsonb(c) order by c.issued_on nulls last)
                 from cap_securities c where c.holder_id = h.id), '[]'::jsonb)
           ) order by h.name)
      from cap_holders h where h.workspace_id = p_workspace
  ), '[]'::jsonb);
end $$;

revoke all on function cap_vested(numeric, date, int, int, date)                    from public, anon, authenticated;
revoke all on function get_cap_table(text, uuid, date)                              from public, anon, authenticated;
revoke all on function simulate_round(text, uuid, numeric, numeric, numeric)        from public, anon, authenticated;
revoke all on function save_cap_holder(text, uuid, uuid, text, text, text)          from public, anon, authenticated;
revoke all on function save_cap_security(text, uuid, uuid, jsonb)                   from public, anon, authenticated;
revoke all on function delete_cap_security(text, uuid, uuid)                        from public, anon, authenticated;
revoke all on function delete_cap_holder(text, uuid, uuid)                          from public, anon, authenticated;
revoke all on function set_option_pool(text, uuid, numeric)                         from public, anon, authenticated;
revoke all on function list_cap_holders(text, uuid)                                 from public, anon, authenticated;

grant execute on function cap_vested(numeric, date, int, int, date)                 to service_role;
grant execute on function get_cap_table(text, uuid, date)                           to service_role;
grant execute on function simulate_round(text, uuid, numeric, numeric, numeric)     to service_role;
grant execute on function save_cap_holder(text, uuid, uuid, text, text, text)       to service_role;
grant execute on function save_cap_security(text, uuid, uuid, jsonb)                to service_role;
grant execute on function delete_cap_security(text, uuid, uuid)                     to service_role;
grant execute on function delete_cap_holder(text, uuid, uuid)                       to service_role;
grant execute on function set_option_pool(text, uuid, numeric)                      to service_role;
grant execute on function list_cap_holders(text, uuid)                              to service_role;

notify pgrst, 'reload schema';
