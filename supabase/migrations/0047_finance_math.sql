-- ============================================================================
-- RunButter — 0047_finance_math.sql
-- Fixes the finance totals. Two independent bugs made Overview and Finance
-- disagree with each other and with reality.
--
-- BUG 1 — get_finance_summary never learned about `direction`.
--   It was written in 0004. 0015 then added invoices.direction ('income' |
--   'cost') so that supplier bills live in the same table as sales invoices.
--   The summary was never updated, so it did:
--       revenue     = sum(all paid invoices)      -> supplier bills counted AS INCOME
--       outstanding = sum(all sent/overdue)       -> money you OWE shown as money owed TO you
--       expenses    = sum(expenses table only)    -> cost invoices missed entirely
--   Net effect: revenue overstated, costs understated, and the same bill
--   inflating both sides. get_finance_analytics (0015) got this right, which is
--   why the dashboard and the finance page never matched.
--
-- BUG 2 — neither function excluded offers/quotes.
--   0016 added invoices.kind ('invoice' | 'offer'); offers share the table and
--   use statuses draft/sent/accepted/declined. Since `outstanding` matches
--   status in ('sent','overdue'), every quote you had merely SENT was being
--   counted as outstanding revenue. Both functions now require kind='invoice'.
--
-- Money only counts once here: revenue = paid income invoices; costs = the
-- expenses table PLUS paid cost invoices; nothing is summed from both sides.
--
-- Additive & idempotent — pure function redefinitions, no schema change.
-- ============================================================================

-- ── Summary (Finance overview cards) ────────────────────────────────────────
-- Keys revenue/outstanding/expenses/invoices are load-bearing for the UI
-- (lib/crm/data.ts loadFinance); net/payable are additive extras.
create or replace function get_finance_summary(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_revenue numeric; v_expenses numeric;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  select coalesce(sum(amount), 0) into v_revenue
    from invoices
   where workspace_id = p_workspace and status = 'paid'
     and direction = 'income' and kind = 'invoice';

  -- Costs come from two places and must not double-count: standalone expenses,
  -- plus invoices you received (direction='cost') that have been paid.
  select coalesce(sum(amount), 0) into v_expenses from (
    select amount from expenses
      where workspace_id = p_workspace and status in ('approved','paid')
    union all
    select amount from invoices
      where workspace_id = p_workspace and status = 'paid'
        and direction = 'cost' and kind = 'invoice'
  ) c;

  return jsonb_build_object(
    'revenue',     v_revenue,
    'expenses',    v_expenses,
    'net',         v_revenue - v_expenses,
    'outstanding', coalesce((select sum(amount) from invoices
                              where workspace_id = p_workspace
                                and status in ('sent','overdue')
                                and direction = 'income' and kind = 'invoice'), 0),
    'payable',     coalesce((select sum(amount) from invoices
                              where workspace_id = p_workspace
                                and status in ('sent','overdue')
                                and direction = 'cost' and kind = 'invoice'), 0),
    'invoices',    coalesce((select count(*) from invoices
                              where workspace_id = p_workspace and kind = 'invoice'), 0)
  );
end $$;

-- ── Analytics (dashboard chart + KPIs) ──────────────────────────────────────
-- Full redefinition of the 0015 version with kind='invoice' added to every
-- invoice predicate, so quotes stop inflating revenue and outstanding.
create or replace function get_finance_analytics(p_privy text, p_workspace uuid, p_months int default 12)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_months int := greatest(1, least(coalesce(p_months, 12), 36));
  v_start  date := (date_trunc('month', now()) - ((v_months - 1) || ' months')::interval)::date;
  v_series jsonb;
  v_revenue numeric;
  v_costs   numeric;
  v_outstanding numeric;
  v_payable numeric;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  with months as (
    select generate_series(date_trunc('month', v_start), date_trunc('month', now()), interval '1 month') as m
  ),
  rev as (
    select date_trunc('month', coalesce(issued_at, created_at::date)) as m, sum(amount) as total
    from invoices
    where workspace_id = p_workspace and status = 'paid'
      and direction = 'income' and kind = 'invoice'
      and coalesce(issued_at, created_at::date) >= v_start
    group by 1
  ),
  cost as (
    select m, sum(total) as total from (
      select date_trunc('month', coalesce(spent_at, created_at::date)) as m, sum(amount) as total
      from expenses
      where workspace_id = p_workspace and status in ('approved','paid')
        and coalesce(spent_at, created_at::date) >= v_start
      group by 1
      union all
      select date_trunc('month', coalesce(issued_at, created_at::date)) as m, sum(amount) as total
      from invoices
      where workspace_id = p_workspace and status = 'paid'
        and direction = 'cost' and kind = 'invoice'
        and coalesce(issued_at, created_at::date) >= v_start
      group by 1
    ) u group by m
  )
  select jsonb_agg(jsonb_build_object(
    'month',   to_char(months.m, 'YYYY-MM'),
    'label',   to_char(months.m, 'Mon'),
    'revenue', coalesce(rev.total, 0),
    'costs',   coalesce(cost.total, 0)
  ) order by months.m)
  into v_series
  from months
  left join rev  on rev.m  = months.m
  left join cost on cost.m = months.m;

  select coalesce(sum(amount), 0) into v_revenue from invoices
    where workspace_id = p_workspace and status = 'paid'
      and direction = 'income' and kind = 'invoice'
      and coalesce(issued_at, created_at::date) >= v_start;

  select coalesce(sum(amount), 0) into v_costs from (
    select amount from expenses
      where workspace_id = p_workspace and status in ('approved','paid')
        and coalesce(spent_at, created_at::date) >= v_start
    union all
    select amount from invoices
      where workspace_id = p_workspace and status = 'paid'
        and direction = 'cost' and kind = 'invoice'
        and coalesce(issued_at, created_at::date) >= v_start
  ) c;

  select coalesce(sum(amount), 0) into v_outstanding from invoices
    where workspace_id = p_workspace and status in ('sent','overdue')
      and direction = 'income' and kind = 'invoice';
  select coalesce(sum(amount), 0) into v_payable from invoices
    where workspace_id = p_workspace and status in ('sent','overdue')
      and direction = 'cost' and kind = 'invoice';

  return jsonb_build_object(
    'months',      v_months,
    'revenue',     v_revenue,
    'costs',       v_costs,
    'net',         v_revenue - v_costs,
    'outstanding', v_outstanding,
    'payable',     v_payable,
    'margin',      case when v_revenue > 0 then round(((v_revenue - v_costs) / v_revenue) * 100) else 0 end,
    'series',      coalesce(v_series, '[]'::jsonb)
  );
end $$;

-- Reachable only through the verified /api/rpc proxy (0040/0046 posture).
revoke all on function get_finance_summary(text, uuid)        from public, anon, authenticated;
revoke all on function get_finance_analytics(text, uuid, int) from public, anon, authenticated;
grant execute on function get_finance_summary(text, uuid)        to service_role;
grant execute on function get_finance_analytics(text, uuid, int) to service_role;

notify pgrst, 'reload schema';
