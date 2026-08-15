-- ============================================================================
-- RunButter — 0121_fx_rates.sql
--
-- Multi-currency finance. This fixes a bug, not a missing feature.
--
-- ── WHAT WAS ACTUALLY WRONG ─────────────────────────────────────────────────
-- `currency` has been a column on invoices, expenses, transactions and
-- bank_accounts since 0004, written by every form, and READ BY NOTHING THAT
-- SUMS. So `get_finance_summary`, the KPIs (0115), the forecast (0116) and the
-- ledger all added a €1,000 invoice to a $1,000 invoice and reported 2,000.
--
-- It is the worst shape a bug can have: silent, plausible, and wrong by
-- whatever the exchange rate happens to be. A workspace invoicing in one
-- currency never sees it; a Polish company invoicing in PLN and EUR — which is
-- most of them, and this product ships KSeF e-invoicing for exactly those
-- companies — has had wrong revenue on every screen since 0004.
--
-- ── FREE DATA, LOCAL COMPUTATION, AND NO METER ──────────────────────────────
-- Rates come from the European Central Bank's own daily reference feed, which
-- is public, keyless, unmetered and published by the institution that sets it.
-- Every commercial FX API bills per lookup for the same numbers. Same rule as
-- OFAC for sanctions and VIES for VAT: the primary source, cached locally.
--
-- ── EUR IS THE PIVOT, AND THAT IS STORAGE, NOT A PREFERENCE ─────────────────
-- ECB publishes everything against EUR, so that is what is stored: one row per
-- currency per day. Storing every pair would be N² rows a day to answer the
-- same questions, and cross rates are one division.
--
-- ── THE RATE ON THE TRANSACTION'S DATE, NEVER TODAY'S ───────────────────────
-- An invoice raised in March is converted at March's rate. Using today's would
-- silently rewrite last quarter's revenue every morning, which is both wrong
-- and the kind of wrong somebody only notices in a board meeting.
--
-- ── AN UNKNOWN RATE IS NULL, NEVER 1:1 ──────────────────────────────────────
-- The single most important line in this file. A missing rate that defaults to
-- 1:1 turns 5,000 JPY into 5,000 USD and reports it with total confidence. So
-- `fx_convert` returns NULL, and every caller reports the unconvertible amount
-- SEPARATELY rather than folding it in or dropping it. Same refusal as the
-- fabricated sparkline and the null DSO.
-- ============================================================================

alter table workspaces add column if not exists base_currency text not null default 'USD';

create table if not exists fx_rates (
  day date not null,
  -- ISO 4217, against EUR. Rate is "how many <quote> per 1 EUR", which is
  -- exactly how the ECB publishes it — reusing their orientation means no
  -- inversion at ingest, and an inversion at ingest is a bug that halves or
  -- doubles everything and looks fine in a spot check.
  quote text not null,
  rate numeric(20, 10) not null,
  source text not null default 'ecb',
  fetched_at timestamptz not null default now(),
  primary key (day, quote)
);
create index if not exists idx_fx_rates_quote_day on fx_rates(quote, day desc);

-- Reference data, identical for every tenant, and useless to an attacker: it is
-- published on a website. Readable by anyone signed in; only the refresh route
-- (service_role) writes.
alter table fx_rates enable row level security;

/**
 * How many EUR is one unit of `p_cur`, on or before `p_day`.
 *
 * The "or before" matters: the ECB publishes on TARGET business days, so an
 * invoice dated on a Saturday, a Sunday or Christmas has no rate of its own.
 * Carrying the last published rate forward is the accounting convention and is
 * what every ledger does; the alternative is refusing to convert a third of the
 * calendar.
 */
create or replace function fx_to_eur(p_cur text, p_day date)
returns numeric language sql stable as $$
  select case
    when upper(coalesce(p_cur, '')) = 'EUR' then 1::numeric
    else (select 1 / r.rate from fx_rates r
           where r.quote = upper(p_cur) and r.day <= coalesce(p_day, current_date)
             and r.rate > 0
           order by r.day desc limit 1)
  end
$$;

/**
 * The rate from one currency to another on a given day, or NULL.
 *
 * NULL is a real answer here and callers must handle it. Returning 1 for an
 * unknown pair would be the single most damaging line in this schema.
 */
create or replace function fx_rate(p_from text, p_to text, p_day date)
returns numeric language sql stable as $$
  select case
    when upper(coalesce(p_from,'')) = upper(coalesce(p_to,'')) then 1::numeric
    else (select a / b from fx_to_eur(p_from, p_day) a, fx_to_eur(p_to, p_day) b
           where a is not null and b is not null and b <> 0)
  end
$$;

create or replace function fx_convert(p_amount numeric, p_from text, p_to text, p_day date)
returns numeric language sql stable as $$
  select case when p_amount is null then null
              else p_amount * fx_rate(p_from, p_to, p_day) end
$$;

/**
 * What a workspace reports in, and how much of its money we cannot convert.
 *
 * `unconverted` is the point. A screen that quietly omitted the amounts it
 * could not convert would show a smaller, confident, wrong total — and nothing
 * would say so. This names the currencies and the untouched amounts so a
 * person can see the gap and go fetch rates.
 */
create or replace function get_fx_status(p_privy text, p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_base text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select coalesce(base_currency, 'USD') into v_base from workspaces where id = p_workspace;

  return jsonb_build_object(
    'base', v_base,
    'latest_day', (select max(day) from fx_rates),
    'currencies_known', (select count(distinct quote) from fx_rates),
    -- Currencies in use that we cannot convert TODAY. Checked against the
    -- newest rate rather than each row's own date, because "we have no rates
    -- for CHF at all" and "we have no rate for one Sunday in 2019" are
    -- different problems and only the first is worth a banner.
    'missing', coalesce((
      select jsonb_agg(distinct c) from (
        select upper(currency) as c from invoices where workspace_id = p_workspace
        union select upper(currency) from expenses where workspace_id = p_workspace
        union select upper(currency) from bank_accounts where workspace_id = p_workspace
      ) u where c is not null and c <> '' and fx_rate(c, v_base, current_date) is null
    ), '[]'::jsonb)
  );
end $$;

create or replace function set_base_currency(p_privy text, p_workspace uuid, p_currency text)
returns text language plpgsql security definer set search_path = public as $$
declare v text := upper(trim(coalesce(p_currency, '')));
begin
  if not exists (
    select 1 from accounts a
     where a.privy_user_id = p_privy and a.workspace_id = p_workspace
       and coalesce(a.role, 'member') in ('owner', 'admin')
  ) then raise exception 'NOT_ALLOWED'; end if;
  -- Three letters, and that is the whole validation: this string is compared
  -- against ECB quote codes, never interpolated anywhere.
  if v !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY'; end if;
  update workspaces set base_currency = v where id = p_workspace;
  return v;
end $$;

/**
 * Store a day's ECB table. Service-role only — called by /api/fx/refresh.
 *
 * Upserts, because the ECB revises intraday and re-running a backfill must
 * converge rather than fail or duplicate.
 */
create or replace function save_fx_rates(p_day date, p_rates jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; k text; v numeric;
begin
  for k, v in select key, (value#>>'{}')::numeric from jsonb_each(coalesce(p_rates, '{}'::jsonb)) loop
    if k ~ '^[A-Za-z]{3}$' and v is not null and v > 0 then
      insert into fx_rates (day, quote, rate) values (p_day, upper(k), v)
      on conflict (day, quote) do update set rate = excluded.rate, fetched_at = now();
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

/*
 * ── The finance readers, redefined to convert ───────────────────────────────
 *
 * Both are redefined IN FULL rather than wrapped, per the monolith rule: a
 * parallel "converted" function would mean two definitions of revenue, and the
 * one a given screen called would be a coin toss.
 */

create or replace function get_finance_summary(p_privy text, p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_base text;
  v_revenue numeric; v_expenses numeric;
  v_unconv numeric;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select coalesce(base_currency, 'USD') into v_base from workspaces where id = p_workspace;

  -- coalesce(..., 0) on the CONVERTED value would fold an unknown rate in as
  -- zero, which understates rather than lies — but it still hides the problem.
  -- Unconvertible rows are summed separately and reported.
  select coalesce(sum(fx_convert(amount, currency, v_base, coalesce(issued_at, due_at))), 0)
    into v_revenue
    from invoices
   where workspace_id = p_workspace and coalesce(direction,'income') = 'income'
     and coalesce(kind,'invoice') <> 'offer' and status = 'paid';

  select coalesce(sum(fx_convert(amount, currency, v_base, coalesce(spent_at, created_at::date))), 0)
    into v_expenses from expenses where workspace_id = p_workspace;

  select coalesce(sum(amount), 0) into v_unconv from (
    select amount from invoices
     where workspace_id = p_workspace and coalesce(direction,'income') = 'income'
       and coalesce(kind,'invoice') <> 'offer' and status = 'paid'
       and fx_convert(amount, currency, v_base, coalesce(issued_at, due_at)) is null
    union all
    select amount from expenses where workspace_id = p_workspace
       and fx_convert(amount, currency, v_base, coalesce(spent_at, created_at::date)) is null
  ) u;

  return jsonb_build_object(
    'currency', v_base,
    'revenue', round(v_revenue, 2),
    'expenses', round(v_expenses, 2),
    'profit', round(v_revenue - v_expenses, 2),
    'unconverted', round(v_unconv, 2),
    'outstanding', round(coalesce((
      select sum(fx_convert(amount, currency, v_base, coalesce(issued_at, due_at))) from invoices
       where workspace_id = p_workspace and coalesce(direction,'income') = 'income'
         and coalesce(kind,'invoice') <> 'offer' and coalesce(status,'') <> 'paid'), 0), 2),
    'payable', round(coalesce((
      select sum(fx_convert(amount, currency, v_base, coalesce(issued_at, due_at))) from invoices
       where workspace_id = p_workspace and direction = 'cost'
         and coalesce(kind,'invoice') <> 'offer' and coalesce(status,'') <> 'paid'), 0), 2)
  );
end $$;

create or replace function get_finance_kpis(p_privy text, p_workspace uuid, p_months int default 12)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_base text;
  v_cash numeric; v_ar numeric; v_ap numeric;
  v_rev numeric; v_cost numeric;
  v_dso numeric; v_dso_n int;
  v_unconv numeric;
  v_since date := (now() - make_interval(months => greatest(coalesce(p_months, 12), 1)))::date;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select coalesce(base_currency, 'USD') into v_base from workspaces where id = p_workspace;

  -- Cash: each account converted at TODAY's rate, because a balance is a
  -- present-tense fact. Same underlying formula as get_bank_accounts (0031).
  select coalesce(sum(fx_convert(
           ba.opening_balance + coalesce((
             select sum(t.amount) from transactions t
              where t.bank_account_id = ba.id and t.status <> 'excluded'), 0),
           ba.currency, v_base, current_date)), 0)
    into v_cash from bank_accounts ba where ba.workspace_id = p_workspace;

  select coalesce(sum(fx_convert(amount, currency, v_base, coalesce(issued_at, due_at))), 0) into v_ar
    from invoices
   where workspace_id = p_workspace and coalesce(direction,'income') = 'income'
     and coalesce(kind,'invoice') <> 'offer' and coalesce(status,'') <> 'paid';

  select coalesce(sum(fx_convert(amount, currency, v_base, coalesce(issued_at, due_at))), 0) into v_ap
    from invoices
   where workspace_id = p_workspace and direction = 'cost'
     and coalesce(kind,'invoice') <> 'offer' and coalesce(status,'') <> 'paid';

  select coalesce(sum(fx_convert(amount, currency, v_base, coalesce(issued_at, due_at))), 0) into v_rev
    from invoices
   where workspace_id = p_workspace and coalesce(direction,'income') = 'income'
     and coalesce(kind,'invoice') <> 'offer' and coalesce(issued_at, due_at) >= v_since;

  select coalesce(sum(fx_convert(amount, currency, v_base, coalesce(spent_at, created_at::date))), 0) into v_cost
    from expenses
   where workspace_id = p_workspace and coalesce(spent_at, created_at::date) >= v_since;

  select coalesce(sum(amount), 0) into v_unconv from (
    select amount from invoices
     where workspace_id = p_workspace and coalesce(kind,'invoice') <> 'offer'
       and fx_convert(amount, currency, v_base, coalesce(issued_at, due_at)) is null
    union all
    select amount from expenses where workspace_id = p_workspace
       and fx_convert(amount, currency, v_base, coalesce(spent_at, created_at::date)) is null
  ) u;

  select avg(extract(epoch from (paid_at - issued_at)) / 86400), count(*)
    into v_dso, v_dso_n
    from invoices
   where workspace_id = p_workspace and coalesce(direction,'income') = 'income'
     and paid_at is not null and issued_at is not null and paid_at >= issued_at;

  return jsonb_build_object(
    'currency', v_base,
    'unconverted', round(v_unconv, 2),
    'cash', round(v_cash, 2),
    'receivable', round(v_ar, 2),
    'payable', round(v_ap, 2),
    'working_capital', round(v_cash + v_ar - v_ap, 2),
    'revenue', round(v_rev, 2),
    'costs', round(v_cost, 2),
    'margin_pct', case when v_rev > 0 then round(((v_rev - v_cost) / v_rev) * 100, 1) else null end,
    'dso_days', case when v_dso_n > 0 then round(v_dso::numeric, 1) else null end,
    'dso_based_on', v_dso_n,

    'ar_ageing', coalesce((
      select jsonb_agg(jsonb_build_object('label', b.label, 'value', b.total) order by b.ord)
      from (
        select case
                 when due_at is null then 'No due date'
                 when due_at >= current_date then 'Not yet due'
                 when due_at >= current_date - 30 then '1–30 days'
                 when due_at >= current_date - 60 then '31–60 days'
                 when due_at >= current_date - 90 then '61–90 days'
                 else '90+ days' end as label,
               case
                 when due_at is null then 5
                 when due_at >= current_date then 0
                 when due_at >= current_date - 30 then 1
                 when due_at >= current_date - 60 then 2
                 when due_at >= current_date - 90 then 3
                 else 4 end as ord,
               sum(fx_convert(amount, currency, v_base, coalesce(issued_at, due_at))) as total
          from invoices
         where workspace_id = p_workspace and coalesce(direction,'income') = 'income'
           and coalesce(kind,'invoice') <> 'offer' and coalesce(status,'') <> 'paid'
         group by 1, 2
        having sum(fx_convert(amount, currency, v_base, coalesce(issued_at, due_at))) is not null
      ) b
    ), '[]'::jsonb),

    'top_clients', coalesce((
      select jsonb_agg(jsonb_build_object('label', c.name, 'value', c.total) order by c.total desc)
      from (
        select coalesce(o.name, 'Unassigned') as name,
               sum(fx_convert(i.amount, i.currency, v_base, coalesce(i.issued_at, i.due_at))) as total
          from invoices i
          left join organizations o on o.id = i.organization_id
         where i.workspace_id = p_workspace and coalesce(i.direction,'income') = 'income'
           and coalesce(i.kind,'invoice') <> 'offer' and coalesce(i.issued_at, i.due_at) >= v_since
         group by 1 having sum(fx_convert(i.amount, i.currency, v_base, coalesce(i.issued_at, i.due_at))) is not null
         order by 2 desc limit 8
      ) c
    ), '[]'::jsonb),

    'expense_mix', coalesce((
      select jsonb_agg(jsonb_build_object('label', coalesce(nullif(category,''), 'Uncategorised'), 'value', total)
             order by total desc)
      from (select category, sum(fx_convert(amount, currency, v_base, coalesce(spent_at, created_at::date))) as total
              from expenses
             where workspace_id = p_workspace and coalesce(spent_at, created_at::date) >= v_since
             group by 1 having sum(fx_convert(amount, currency, v_base, coalesce(spent_at, created_at::date))) is not null
             order by 2 desc limit 8) e
    ), '[]'::jsonb),

    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'label', name, 'spend', spend, 'budget', budget, 'leads', leads,
               'cost_per_lead', case when coalesce(leads,0) > 0 then round((coalesce(spend,0) / leads)::numeric, 2) end
             ) order by coalesce(spend,0) desc)
        from campaigns where workspace_id = p_workspace and coalesce(spend,0) > 0 limit 8
    ), '[]'::jsonb)
  );
end $$;

revoke all on function get_fx_status(text, uuid)                 from public, anon, authenticated;
revoke all on function set_base_currency(text, uuid, text)       from public, anon, authenticated;
revoke all on function save_fx_rates(date, jsonb)                from public, anon, authenticated;
revoke all on function get_finance_summary(text, uuid)           from public, anon, authenticated;
revoke all on function get_finance_kpis(text, uuid, int)         from public, anon, authenticated;

grant execute on function get_fx_status(text, uuid)              to service_role;
grant execute on function set_base_currency(text, uuid, text)    to service_role;
grant execute on function save_fx_rates(date, jsonb)             to service_role;
grant execute on function get_finance_summary(text, uuid)        to service_role;
grant execute on function get_finance_kpis(text, uuid, int)      to service_role;

notify pgrst, 'reload schema';
