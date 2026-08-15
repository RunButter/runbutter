-- ============================================================================
-- RunButter — 0115_finance_kpis.sql
--
-- The finance numbers a person running a company actually gets asked for:
-- what is owed to us and how late, what we owe, how concentrated the revenue
-- is, and how long it takes to get paid.
--
-- ── WHAT THIS DELIBERATELY DOES NOT COMPUTE ─────────────────────────────────
-- MRR, ARR, churn, LTV and CAC. Every one of them needs data this product does
-- not hold: there is no subscription model, and no path from a campaign to the
-- revenue it produced. They could all be approximated, and every approximation
-- would be a confident number somebody puts in a board deck. That is the same
-- refusal as the fabricated sparkline and the fake cognitive score — the rule
-- this codebase already follows, applied to the numbers people most want.
--
-- Marketing ROI is the sharpest case: `campaigns` has budget, spend AND leads,
-- so COST PER LEAD is real arithmetic and is reported. Return on investment is
-- not, because nothing links a campaign to an invoice — reporting it would mean
-- inventing the attribution, and the number would look authoritative.
--
-- ── invoices.paid_at, BECAUSE DSO NEEDS A DATE THAT DID NOT EXIST ───────────
-- Days Sales Outstanding is the headline collections metric and the table had
-- nowhere to record when an invoice was actually paid. `updated_at` is not a
-- substitute: editing a note bumps it, so DSO would silently improve every time
-- somebody tidied a record.
--
-- The column is stamped by a trigger on the transition INTO 'paid', and is NOT
-- backfilled. Historical invoices have an unknown payment date and say so, which
-- is why the function reports how many invoices the average is based on. An
-- invented backfill from updated_at would poison the metric permanently and
-- nobody could tell afterwards.
-- ============================================================================

alter table invoices add column if not exists paid_at timestamptz;

create or replace function stamp_invoice_paid() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Only the transition into paid, and only the first one. Re-saving a paid
  -- invoice must not move the date, or DSO drifts every time somebody opens it.
  if new.status = 'paid' and coalesce(old.status, '') <> 'paid' and new.paid_at is null then
    new.paid_at := now();
  end if;
  -- Reopening clears it: an invoice that is no longer paid has no payment date,
  -- and leaving a stale one would count it as collected forever.
  if new.status <> 'paid' and coalesce(old.status, '') = 'paid' then
    new.paid_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_invoice_paid on invoices;
create trigger trg_stamp_invoice_paid before update on invoices
  for each row execute function stamp_invoice_paid();

/**
 * Everything on one screen, in one query.
 *
 * Receivables and payables are the same table read two ways: direction='income'
 * is what a client owes YOU, direction='cost' is what you owe a supplier. That
 * is the distinction the client portal also turns on, and getting it backwards
 * would report your own bills as revenue.
 *
 * Ageing buckets are measured from DUE date, not issue date — an invoice is not
 * late until it is due, and bucketing from issue makes every 90-day-terms
 * invoice look overdue on arrival.
 */
create or replace function get_finance_kpis(p_privy text, p_workspace uuid, p_months int default 12)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cash numeric;
  v_ar numeric; v_ap numeric;
  v_rev numeric; v_cost numeric;
  v_dso numeric; v_dso_n int;
  v_since date := (now() - make_interval(months => greatest(coalesce(p_months, 12), 1)))::date;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  -- Cash is opening_balance plus posted transactions, EXACTLY as
  -- get_bank_accounts (0031) computes it. There is no stored `balance` column,
  -- and a second definition here is how the Accounts screen and this one end up
  -- disagreeing about how much money the company has.
  select coalesce(sum(
           ba.opening_balance + coalesce((
             select sum(t.amount) from transactions t
              where t.bank_account_id = ba.id and t.status <> 'excluded'), 0)
         ), 0)
    into v_cash from bank_accounts ba where ba.workspace_id = p_workspace;

  select coalesce(sum(amount), 0) into v_ar from invoices
   where workspace_id = p_workspace and coalesce(direction,'income') = 'income'
     and coalesce(kind,'invoice') <> 'offer' and coalesce(status,'') <> 'paid';

  select coalesce(sum(amount), 0) into v_ap from invoices
   where workspace_id = p_workspace and direction = 'cost'
     and coalesce(kind,'invoice') <> 'offer' and coalesce(status,'') <> 'paid';

  select coalesce(sum(amount), 0) into v_rev from invoices
   where workspace_id = p_workspace and coalesce(direction,'income') = 'income'
     and coalesce(kind,'invoice') <> 'offer' and coalesce(issued_at, due_at) >= v_since;

  select coalesce(sum(amount), 0) into v_cost from expenses
   where workspace_id = p_workspace and coalesce(spent_at, created_at::date) >= v_since;

  -- Only invoices we actually watched get paid. Nulls are excluded rather than
  -- treated as zero days, which would report instant collection.
  select avg(extract(epoch from (paid_at - issued_at)) / 86400), count(*)
    into v_dso, v_dso_n
    from invoices
   where workspace_id = p_workspace and coalesce(direction,'income') = 'income'
     and paid_at is not null and issued_at is not null and paid_at >= issued_at;

  return jsonb_build_object(
    'cash', v_cash,
    'receivable', v_ar,
    'payable', v_ap,
    -- What is genuinely available to spend, which is the number a cash-flow
    -- conversation is actually about.
    'working_capital', v_cash + v_ar - v_ap,
    'revenue', v_rev,
    'costs', v_cost,
    'margin_pct', case when v_rev > 0 then round(((v_rev - v_cost) / v_rev) * 100, 1) else null end,

    -- NULL, not 0, when nothing has been observed. "0 days to get paid" is a
    -- lie; "not enough data yet" is the truth, and the count says how sure.
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
               sum(amount) as total
          from invoices
         where workspace_id = p_workspace and coalesce(direction,'income') = 'income'
           and coalesce(kind,'invoice') <> 'offer' and coalesce(status,'') <> 'paid'
         group by 1, 2
      ) b
    ), '[]'::jsonb),

    -- Concentration. The first question any investor or lender asks, and the
    -- one nobody computes until it is a problem.
    'top_clients', coalesce((
      select jsonb_agg(jsonb_build_object('label', c.name, 'value', c.total) order by c.total desc)
      from (
        select coalesce(o.name, 'Unassigned') as name, sum(i.amount) as total
          from invoices i
          left join organizations o on o.id = i.organization_id
         where i.workspace_id = p_workspace and coalesce(i.direction,'income') = 'income'
           and coalesce(i.kind,'invoice') <> 'offer' and coalesce(i.issued_at, i.due_at) >= v_since
         group by 1 order by 2 desc limit 8
      ) c
    ), '[]'::jsonb),

    'expense_mix', coalesce((
      select jsonb_agg(jsonb_build_object('label', coalesce(nullif(category,''), 'Uncategorised'), 'value', total)
             order by total desc)
      from (select category, sum(amount) as total from expenses
             where workspace_id = p_workspace and coalesce(spent_at, created_at::date) >= v_since
             group by 1 order by 2 desc limit 8) e
    ), '[]'::jsonb),

    -- Cost per lead is real. Return on investment is NOT reported: nothing links
    -- a campaign to an invoice, so it would be an invented attribution.
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'label', name, 'spend', spend, 'budget', budget, 'leads', leads,
               'cost_per_lead', case when coalesce(leads,0) > 0 then round((coalesce(spend,0) / leads)::numeric, 2) end
             ) order by coalesce(spend,0) desc)
        from campaigns where workspace_id = p_workspace and coalesce(spend,0) > 0 limit 8
    ), '[]'::jsonb)
  );
end $$;

revoke all on function get_finance_kpis(text, uuid, int) from public, anon, authenticated;
grant execute on function get_finance_kpis(text, uuid, int) to service_role;

notify pgrst, 'reload schema';
