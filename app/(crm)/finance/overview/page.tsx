'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { TrendingUp, Wallet, PiggyBank, Clock, Receipt, ArrowUpRight, Loader2, ArrowLeftRight } from 'lucide-react';
import { loadFinanceAnalytics, loadBankAccounts, type FinanceAnalytics, type BankAccount } from '@/lib/crm/data';
import FinanceChart from '@/components/crm/FinanceChart';
import StatCard, { monthlyMomentum } from '@/components/ui/StatCard';

const money = (n: number) => '$' + Math.round(n).toLocaleString();

const PERIODS: { label: string; months: number }[] = [
  { label: '1M', months: 1 },
  { label: '3M', months: 3 },
  { label: '6M', months: 6 },
  { label: '12M', months: 12 },
];

export default function FinanceOverview() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [months, setMonths] = useState(12);
  const [fin, setFin] = useState<FinanceAnalytics | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    loadFinanceAnalytics(privy, months).then((res) => { setFin(res); setLoading(false); });
  }, [ready, privy, months]);

  useEffect(() => { if (ready) loadBankAccounts(privy).then((r) => setAccounts(r.accounts)); }, [ready, privy]);

  const totalCash = accounts.reduce((s, a) => s + a.balance, 0);

  const live = fin?.live ?? false;
  const net = fin?.net ?? 0;

  // Truthful monthly series for the tile sparklines.
  const revSeries = fin?.series?.map((p) => p.revenue) ?? [];
  const costSeries = fin?.series?.map((p) => p.costs) ?? [];
  const netSeries = fin?.series?.map((p) => p.revenue - p.costs) ?? [];

  const cards = [
    { label: 'Revenue', value: fin ? money(fin.revenue) : '—', sub: 'Paid invoices', icon: TrendingUp, tone: 'text-success', spark: revSeries, trend: monthlyMomentum(revSeries) },
    { label: 'Costs', value: fin ? money(fin.costs) : '—', sub: 'Approved + paid', icon: Wallet, tone: 'text-secondary', spark: costSeries, trend: monthlyMomentum(costSeries, { upIsGood: false }) },
    { label: 'Net profit', value: fin ? money(net) : '—', sub: fin ? `${fin.margin}% margin` : '—', icon: PiggyBank, tone: net >= 0 ? 'text-success' : 'text-danger', spark: netSeries, trend: monthlyMomentum(netSeries) },
    { label: 'Outstanding', value: fin ? money(fin.outstanding) : '—', sub: 'Owed to you', icon: Clock, tone: 'text-warning' },
  ] as const;

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-subtle">
        <h1 className="text-sm font-semibold text-primary">Finance</h1>
        <span className={`text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
          {live ? 'Live' : 'Sample'}
        </span>
        <div className="ml-auto flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-hover ring-1 ring-subtle">
          {PERIODS.map((p) => (
            <button key={p.label} onClick={() => setMonths(p.months)}
              className={`h-6 px-2.5 rounded-md text-[11px] font-semibold transition-colors ${months === p.months ? 'bg-surface text-primary shadow-sm' : 'text-tertiary hover:text-secondary'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {!fin ? (
          <div className="h-40 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="max-w-5xl space-y-6">
            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {cards.map((c) => (
                <StatCard key={c.label} label={c.label} value={c.value} sub={c.sub} icon={c.icon} tone={c.tone}
                  spark={'spark' in c ? c.spark : undefined} trend={'trend' in c ? c.trend : undefined} />
              ))}
            </div>

            {/* Revenue vs costs chart */}
            <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card p-5">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <h2 className="text-sm font-semibold text-primary">Revenue vs costs</h2>
                  <p className="text-[12px] text-tertiary">Last {months} {months === 1 ? 'month' : 'months'} · money in vs money out</p>
                </div>
                <div className="flex items-center gap-4 text-[11px] font-semibold">
                  <span className="inline-flex items-center gap-1.5 text-secondary"><span className="w-2.5 h-2.5 rounded-sm bg-success" /> Revenue</span>
                  <span className="inline-flex items-center gap-1.5 text-secondary"><span className="w-2.5 h-2.5 rounded-sm bg-strong" /> Costs</span>
                </div>
              </div>
              {loading ? (
                <div className="h-56 flex items-center justify-center text-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : (
                <FinanceChart series={fin.series} />
              )}
            </div>

            {/* Quick links into the ledgers */}
            <div className="grid sm:grid-cols-3 gap-3">
              {[
                { label: 'Transactions', desc: `Bank ledger · ${money(totalCash)} across ${accounts.length || 0} account${accounts.length === 1 ? '' : 's'}`, icon: ArrowLeftRight, href: '/finance/transactions', tone: 'text-accent' },
                { label: 'Invoices', desc: 'Money in — accounts receivable', icon: Receipt, href: '/objects/invoices', tone: 'text-success' },
                { label: 'Expenses', desc: 'Money out — accounts payable', icon: Wallet, href: '/objects/expenses', tone: 'text-danger' },
              ].map((q) => (
                <Link key={q.label} href={q.href}
                  className="group flex items-center gap-3 rounded-xl bg-surface ring-1 ring-subtle shadow-card p-4 hover:ring-strong hover:shadow-elevated transition-all">
                  <div className="w-9 h-9 rounded-lg bg-surface-sunken ring-1 ring-subtle flex items-center justify-center">
                    <q.icon className={`w-4 h-4 ${q.tone}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-primary">{q.label}</div>
                    <div className="text-[12px] text-tertiary truncate">{q.desc}</div>
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-tertiary group-hover:text-secondary ml-auto transition-colors" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
