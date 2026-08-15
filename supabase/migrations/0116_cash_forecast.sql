-- ============================================================================
-- RunButter — 0116_cash_forecast.sql
--
-- The spreadsheet every founder keeps, built from the ledger instead.
--
-- "What happens to our cash if we hire two people, the biggest client leaves,
-- and everyone pays us three weeks late?" is the question finance software is
-- for, and it is currently answered in a private Excel file that nobody else
-- can see and that goes stale the day it is made.
--
-- ── THIS RETURNS FACTS, NOT A FORECAST ──────────────────────────────────────
-- The projection itself is arithmetic in the browser (lib/finance/forecast.ts),
-- and that split is the whole design:
--
--   · A scenario slider must move the chart in the same frame. A round trip per
--     drag makes the tool feel like a report, and a report is the thing this is
--     replacing.
--   · Every assumption stays visible and editable. A number computed in SQL
--     arrives as an authority; a number computed from inputs on screen arrives
--     as a model somebody can argue with — which is what a forecast IS.
--   · Same shape as /api/workspace/build and the insight charts: the server
--     supplies the facts, the client does the maths, and nothing invents data.
--
-- ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
-- No confidence interval, no Monte Carlo, no "87% likely". The inputs are a
-- handful of averages over a few months of one company's history; a probability
-- computed from that is decoration on a guess, and decoration on a guess is how
-- somebody ends up defending it to a board. The forecast says what follows from
-- the assumptions on screen, and the assumptions are all visible.
--
-- ── COLLECTION LAG IS THE PART THAT MAKES IT TRUE ───────────────────────────
-- A naive forecast lands every invoice on its due date, which no client has
-- ever done. `collection_lag_days` is measured from history — how many days
-- after due an invoice actually got paid — and it is allowed to be NEGATIVE
-- (clients who pay early exist) and NULL (0115 does not backfill paid_at, so a
-- workspace with no observed payments has no lag). Null means the client
-- assumes on-time and says so, rather than defaulting to a made-up 30.
-- ============================================================================

/**
 * Everything the projection needs, in one read.
 *
 * Receivables and payables come back bucketed BY DATE rather than by month, so
 * a "get paid two weeks sooner" lever can shift them by days and land some of
 * them in an earlier month. Aggregating to months here would have quietly made
 * that slider a no-op for anything under 30 days.
 */
create or replace function get_cash_forecast_basis(p_privy text, p_workspace uuid, p_months int default 6)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cash numeric;
  v_win int := greatest(coalesce(p_months, 6), 2);
  v_since date := (now() - make_interval(months => v_win))::date;
  v_this  text := to_char(now(), 'YYYY-MM');
  v_lag numeric; v_lag_n int;
  v_months_seen int;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  -- Same formula as get_bank_accounts (0031) and get_finance_kpis (0115).
  -- There is no stored balance column and a third definition would be a third
  -- opportunity for this screen to disagree with the other two.
  select coalesce(sum(
           ba.opening_balance + coalesce((
             select sum(t.amount) from transactions t
              where t.bank_account_id = ba.id and t.status <> 'excluded'), 0)
         ), 0)
    into v_cash from bank_accounts ba where ba.workspace_id = p_workspace;

  -- Negative = paid before due. Kept signed, because a workspace whose clients
  -- pay early should see an earlier forecast, not a flat zero.
  select avg(paid_at::date - due_at), count(*) into v_lag, v_lag_n
    from invoices
   where workspace_id = p_workspace and coalesce(direction,'income') = 'income'
     and paid_at is not null and due_at is not null;

  -- How many COMPLETE months of history exist. The run-rate averages below are
  -- divided by this rather than by the window, or a workspace two months old
  -- has its burn divided by six and reads as four times safer than it is.
  select count(distinct m) into v_months_seen from (
    select to_char(coalesce(issued_at, due_at), 'YYYY-MM') as m from invoices
     where workspace_id = p_workspace and coalesce(issued_at, due_at) >= v_since
       and to_char(coalesce(issued_at, due_at), 'YYYY-MM') < v_this
    union
    select to_char(coalesce(spent_at, created_at::date), 'YYYY-MM') from expenses
     where workspace_id = p_workspace and coalesce(spent_at, created_at::date) >= v_since
       and to_char(coalesce(spent_at, created_at::date), 'YYYY-MM') < v_this
  ) s where m is not null;

  return jsonb_build_object(
    'cash', v_cash,
    'window_months', v_win,
    'months_of_history', coalesce(v_months_seen, 0),

    -- NULL, not 0. "Everyone pays exactly on time" is a claim, and 0115 does
    -- not backfill paid_at, so a workspace that has never marked an invoice
    -- paid genuinely does not know.
    'collection_lag_days', case when v_lag_n > 0 then round(v_lag::numeric, 1) end,
    'collection_lag_based_on', v_lag_n,

    /*
     * THE PARTIAL MONTH IS EXCLUDED EVERYWHERE BELOW, the same rule
     * lib/finance/runway.ts and monthlyMomentum already apply. On the 2nd of
     * the month the ledger holds two days of spend; averaged in, it halves the
     * apparent burn and doubles the forecast — wrong at the start of every
     * month, cheerful, and quietly correct again by the 28th.
     */
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('month', m, 'revenue', rev, 'costs', cost) order by m)
      from (
        select m,
               sum(case when src = 'rev' then amt else 0 end) as rev,
               sum(case when src = 'cost' then amt else 0 end) as cost
        from (
          select to_char(coalesce(issued_at, due_at), 'YYYY-MM') as m, 'rev' as src, amount as amt
            from invoices
           where workspace_id = p_workspace and coalesce(direction,'income') = 'income'
             and coalesce(kind,'invoice') <> 'offer' and coalesce(issued_at, due_at) >= v_since
          union all
          select to_char(coalesce(spent_at, created_at::date), 'YYYY-MM'), 'cost', amount
            from expenses
           where workspace_id = p_workspace and coalesce(spent_at, created_at::date) >= v_since
        ) x where m is not null and m < v_this
        group by m
      ) h
    ), '[]'::jsonb),

    -- Money already invoiced and not yet in. An invoice with no due date is
    -- given today's date rather than dropped: it is owed now, and dropping it
    -- would silently shrink the forecast by however much it is worth.
    'receivables', coalesce((
      select jsonb_agg(jsonb_build_object('d', d, 'v', v) order by d)
      from (select coalesce(due_at, current_date) as d, sum(amount) as v
              from invoices
             where workspace_id = p_workspace and coalesce(direction,'income') = 'income'
               and coalesce(kind,'invoice') <> 'offer' and coalesce(status,'') <> 'paid'
             group by 1) r
    ), '[]'::jsonb),

    'payables', coalesce((
      select jsonb_agg(jsonb_build_object('d', d, 'v', v) order by d)
      from (select coalesce(due_at, current_date) as d, sum(amount) as v
              from invoices
             where workspace_id = p_workspace and direction = 'cost'
               and coalesce(kind,'invoice') <> 'offer' and coalesce(status,'') <> 'paid'
             group by 1) p
    ), '[]'::jsonb),

    /*
     * RECURRING REVENUE, INFERRED RATHER THAN DECLARED.
     *
     * A client who has invoiced in three or more distinct months is treated as
     * ongoing: their average month is expected to keep arriving after the
     * invoiced pipeline runs out. Three is the threshold because two could be
     * one project split in half, and this number becomes the flat part of the
     * forecast — the part somebody plans hiring against.
     *
     * It is labelled "inferred" on screen and editable. A subscription field
     * would be more honest still, and nothing in this product has one.
     */
    'recurring_clients', coalesce((
      select jsonb_agg(jsonb_build_object('label', name, 'monthly', monthly, 'months', n) order by monthly desc)
      from (
        select coalesce(o.name, 'Unassigned') as name,
               count(distinct to_char(coalesce(i.issued_at, i.due_at), 'YYYY-MM')) as n,
               round(sum(i.amount) / greatest(count(distinct to_char(coalesce(i.issued_at, i.due_at), 'YYYY-MM')), 1), 2) as monthly
          from invoices i
          left join organizations o on o.id = i.organization_id
         where i.workspace_id = p_workspace and coalesce(i.direction,'income') = 'income'
           and coalesce(i.kind,'invoice') <> 'offer'
           and coalesce(i.issued_at, i.due_at) >= v_since
           and to_char(coalesce(i.issued_at, i.due_at), 'YYYY-MM') < v_this
         group by 1
        having count(distinct to_char(coalesce(i.issued_at, i.due_at), 'YYYY-MM')) >= 3
         order by 3 desc limit 12
      ) rc
    ), '[]'::jsonb),

    /*
     * Costs split by how sticky they are, because the two behave completely
     * differently under a scenario: payroll does not fall when revenue does,
     * and a "cut costs 20%" lever that shaves payroll is describing layoffs
     * without saying so.
     *
     * FIXED = a category billed in at least three distinct months. Same
     * threshold and same reasoning as recurring revenue.
     */
    'cost_mix', coalesce((
      select jsonb_agg(jsonb_build_object(
               'label', cat, 'monthly', monthly, 'months', n,
               'fixed', n >= 3) order by monthly desc)
      from (
        select coalesce(nullif(category,''), 'other') as cat,
               count(distinct to_char(coalesce(spent_at, created_at::date), 'YYYY-MM')) as n,
               round(sum(amount) / greatest(count(distinct to_char(coalesce(spent_at, created_at::date), 'YYYY-MM')), 1), 2) as monthly
          from expenses
         where workspace_id = p_workspace
           and coalesce(spent_at, created_at::date) >= v_since
           and to_char(coalesce(spent_at, created_at::date), 'YYYY-MM') < v_this
         group by 1 order by 3 desc limit 12
      ) cm
    ), '[]'::jsonb)
  );
end $$;

revoke all on function get_cash_forecast_basis(text, uuid, int) from public, anon, authenticated;
grant execute on function get_cash_forecast_basis(text, uuid, int) to service_role;

notify pgrst, 'reload schema';
