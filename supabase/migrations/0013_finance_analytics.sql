-- ============================================================================
-- RunButter Platform Core — 0013_finance_analytics.sql
-- Finance analytics: money-in (paid invoices) vs money-out (approved/paid
-- expenses) over a rolling window, with a per-month time series for charting.
-- Additive & prod-safe. Depends on 0001–0004. Run AFTER them.
-- ============================================================================

-- get_finance_analytics — totals over the last p_months (incl. current) plus a
-- month-by-month revenue/costs series for the dashboard chart.
--   revenue     = sum(paid invoices)            in window
--   costs       = sum(approved|paid expenses)   in window
--   net         = revenue - costs
--   margin      = net / revenue * 100 (rounded)
--   outstanding = sum(sent|overdue invoices)    (all-time, money owed to you)
--   series      = [{ month:'YYYY-MM', label:'Jun', revenue, costs }, ...]
create or replace function get_finance_analytics(p_privy text, p_workspace uuid, p_months int default 12)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_months int := greatest(1, least(coalesce(p_months, 12), 36));
  v_start  date := (date_trunc('month', now()) - ((v_months - 1) || ' months')::interval)::date;
  v_series jsonb;
  v_revenue numeric;
  v_costs   numeric;
  v_outstanding numeric;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  with months as (
    select generate_series(date_trunc('month', v_start), date_trunc('month', now()), interval '1 month') as m
  ),
  rev as (
    select date_trunc('month', coalesce(issued_at, created_at::date)) as m, sum(amount) as total
    from invoices
    where workspace_id = p_workspace and status = 'paid'
      and coalesce(issued_at, created_at::date) >= v_start
    group by 1
  ),
  cost as (
    select date_trunc('month', coalesce(spent_at, created_at::date)) as m, sum(amount) as total
    from expenses
    where workspace_id = p_workspace and status in ('approved','paid')
      and coalesce(spent_at, created_at::date) >= v_start
    group by 1
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
      and coalesce(issued_at, created_at::date) >= v_start;

  select coalesce(sum(amount), 0) into v_costs from expenses
    where workspace_id = p_workspace and status in ('approved','paid')
      and coalesce(spent_at, created_at::date) >= v_start;

  select coalesce(sum(amount), 0) into v_outstanding from invoices
    where workspace_id = p_workspace and status in ('sent','overdue');

  return jsonb_build_object(
    'months',      v_months,
    'revenue',     v_revenue,
    'costs',       v_costs,
    'net',         v_revenue - v_costs,
    'outstanding', v_outstanding,
    'margin',      case when v_revenue > 0 then round(((v_revenue - v_costs) / v_revenue) * 100) else 0 end,
    'series',      coalesce(v_series, '[]'::jsonb)
  );
end $$;
grant execute on function get_finance_analytics(text, uuid, int) to authenticated, anon;

notify pgrst, 'reload schema';
