'use client';

import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import PageHeader from '@/components/dashboard/PageHeader';
import AppLoading from '@/components/ui/AppLoading';
import InsightChart from '@/components/crm/InsightChart';
import { getWorkspace } from '@/lib/crm/data';
import { rpc } from '@/lib/rpc';

/**
 * The finance questions somebody is actually asked: what are we owed and how
 * late, what do we owe, how concentrated is the revenue, how long do we wait to
 * get paid.
 *
 * ── EVERY NUMBER HERE IS ARITHMETIC OVER THE LEDGER ─────────────────────────
 * There is no MRR, ARR, churn, LTV or CAC, and their absence is deliberate:
 * this product holds no subscription model and no path from a campaign to the
 * revenue it produced, so each of them would be an approximation that reads as
 * a fact. Cost per lead IS shown, because campaigns carry spend and leads and
 * that division is real. Marketing ROI is not, because the attribution does not
 * exist.
 *
 * A metric with nothing behind it shows "—" and says why, rather than 0.
 */
/**
 * Money in the workspace's reporting currency (0121).
 *
 * The symbol used to be a hardcoded `$`, which was correct for exactly one
 * workspace and quietly wrong for every other — and it was the visible half of
 * a deeper bug: nothing converted, so a EUR invoice and a USD invoice were
 * added together and the sum was labelled dollars.
 */
const fmtMoney = (n: any, cur: string) => {
  if (n === null || n === undefined) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: cur, maximumFractionDigits: 0,
    }).format(Number(n));
  } catch {
    // An unknown code must not blank the number. Intl throws on anything that
    // is not ISO 4217, and a workspace can set its own.
    return `${Math.round(Number(n)).toLocaleString()} ${cur}`;
  }
};

interface Kpis {
  currency: string;
  unconverted: number;
  cash: number; receivable: number; payable: number; working_capital: number;
  revenue: number; costs: number; margin_pct: number | null;
  dso_days: number | null; dso_based_on: number;
  ar_ageing: { label: string; value: number }[];
  top_clients: { label: string; value: number }[];
  expense_mix: { label: string; value: number }[];
  campaigns: { label: string; spend: number; budget: number; leads: number; cost_per_lead: number | null }[];
}

export default function FinanceKpisPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [k, setK] = useState<Kpis | null>(null);
  const [fx, setFx] = useState<{ base: string; latest_day: string | null; missing: string[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!privy) { setLoading(false); return; }
    let cancelled = false;
    getWorkspace(privy).then(async (w) => {
      if (!w || cancelled) { setLoading(false); return; }
      const [kp, st] = await Promise.all([
        rpc('get_finance_kpis', { p_privy: privy, p_workspace: w.id, p_months: 12 }),
        rpc('get_fx_status', { p_privy: privy, p_workspace: w.id }, { quiet: true }),
      ]);
      if (!cancelled) {
        setK((kp.data as Kpis) ?? null);
        setFx((st.data as any) ?? null);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [privy]);

  if (!ready || loading) return <AppLoading label="Reading your ledger…" />;

  const cur = k?.currency || fx?.base || 'USD';
  const M = (n: any) => fmtMoney(n, cur);
  const total = (rows: { value: number }[]) => rows.reduce((a, r) => a + Number(r.value || 0), 0);
  // Concentration is the number an investor or a lender asks for first, and it
  // is a share of the top client rather than a chart nobody reads as a ratio.
  const clients = k?.top_clients ?? [];
  const concentration = clients.length && total(clients) > 0
    ? Math.round((Number(clients[0].value) / total(clients)) * 100) : null;

  return (
    <>
      <PageHeader title="Finance KPIs" />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="page-body p-6 2xl:p-8 flex flex-col gap-5">

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-2xs text-tertiary">
              Reported in <span className="text-secondary font-semibold">{cur}</span>
              {fx?.latest_day ? ` · rates from the ECB, latest ${fx.latest_day}` : ''}
            </p>
          </div>

          {/* An unconvertible amount is NAMED rather than folded in or dropped.
              A smaller, confident, wrong total is the failure this avoids. */}
          {(k?.unconverted ?? 0) > 0 && (
            <div className="rounded-xl bg-warning/10 ring-1 ring-warning/30 px-4 py-3">
              <p className="text-2xs text-secondary">
                <span className="font-semibold text-primary">{M(k!.unconverted)}</span> is not included above:
                there is no exchange rate for {fx?.missing?.length ? fx.missing.join(', ') : 'some currencies'} on
                the relevant dates. Run <code className="text-secondary">/api/fx/refresh?days=90</code> to load
                the last quarter of rates from the ECB.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <Stat label="Cash" value={M(k?.cash)} />
            <Stat label="Owed to us" value={M(k?.receivable)} sub="unpaid invoices" />
            <Stat label="We owe" value={M(k?.payable)} sub="unpaid bills" />
            <Stat label="Working capital" value={M(k?.working_capital)} sub="cash + owed − owe" />
            <Stat label="Revenue (12m)" value={M(k?.revenue)} />
            <Stat label="Costs (12m)" value={M(k?.costs)} />
            <Stat label="Margin" value={k?.margin_pct != null ? `${k.margin_pct}%` : '—'} />
            <Stat
              label="Days to get paid"
              value={k?.dso_days != null ? `${k.dso_days}` : '—'}
              sub={k?.dso_days != null
                ? `average of ${k.dso_based_on}`
                : 'no invoice has been marked paid yet'} />
          </div>

          {(k?.ar_ageing?.length ?? 0) > 0 && (
            <Card title="What we are owed, by how late"
              note="Measured from the due date — an invoice is not late until it is due.">
              <InsightChart buckets={k!.ar_ageing} kind="bar" currency total={total(k!.ar_ageing)} />
            </Card>
          )}

          {clients.length > 0 && (
            <Card title="Revenue by client"
              note={concentration !== null
                ? `Your largest client is ${concentration}% of the last 12 months.`
                : undefined}>
              <InsightChart buckets={clients} kind="bar" currency total={total(clients)} />
            </Card>
          )}

          {(k?.expense_mix?.length ?? 0) > 0 && (
            <Card title="Where the money goes">
              <InsightChart buckets={k!.expense_mix} kind="pie" currency total={total(k!.expense_mix)} />
            </Card>
          )}

          {(k?.campaigns?.length ?? 0) > 0 && (
            <Card title="Campaign spend"
              note="Cost per lead is real arithmetic. Return on investment is not shown: nothing links a campaign to an invoice, so any figure would be invented.">
              <div className="divide-y divide-subtle">
                {k!.campaigns.map((c) => (
                  <div key={c.label} className="flex items-center gap-3 py-2">
                    <span className="text-xs text-primary flex-1 min-w-0 truncate">{c.label}</span>
                    <span className="text-2xs text-tertiary tabular-nums">{M(c.spend)} spent</span>
                    <span className="text-2xs text-tertiary tabular-nums">{c.leads || 0} leads</span>
                    <span className="text-xs font-semibold text-primary tabular-nums w-24 text-right">
                      {c.cost_per_lead != null ? `${M(c.cost_per_lead)}/lead` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <p className="text-2xs text-tertiary">
            No MRR, churn or customer acquisition cost: this workspace holds no subscriptions and nothing
            connects a campaign to the revenue it produced, so those would be guesses rather than measurements.
          </p>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card p-3">
      <p className="text-2xs text-tertiary">{label}</p>
      <p className="mt-0.5 text-base font-medium text-primary tabular-nums">{value}</p>
      {sub && <p className="text-2xs text-tertiary">{sub}</p>}
    </div>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-5">
      <h2 className="text-sm font-medium text-primary">{title}</h2>
      {note && <p className="mt-0.5 text-2xs text-tertiary">{note}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}
