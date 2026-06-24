'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { TrendingUp, Wallet, PiggyBank, Clock, Receipt, ArrowUpRight, Loader2 } from 'lucide-react';
import { loadFinanceAnalytics, type FinanceAnalytics } from '@/lib/crm/data';
import FinanceChart from '@/components/crm/FinanceChart';

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    loadFinanceAnalytics(privy, months).then((res) => { setFin(res); setLoading(false); });
  }, [ready, privy, months]);

  const live = fin?.live ?? false;
  const net = fin?.net ?? 0;

  const cards = [
    { label: 'Revenue', value: fin ? money(fin.revenue) : '—', sub: 'Paid invoices', icon: TrendingUp, tone: 'text-emerald-600' },
    { label: 'Costs', value: fin ? money(fin.costs) : '—', sub: 'Approved + paid', icon: Wallet, tone: 'text-slate-700' },
    { label: 'Net profit', value: fin ? money(net) : '—', sub: fin ? `${fin.margin}% margin` : '—', icon: PiggyBank, tone: net >= 0 ? 'text-emerald-600' : 'text-rose-600' },
    { label: 'Outstanding', value: fin ? money(fin.outstanding) : '—', sub: 'Owed to you', icon: Clock, tone: 'text-amber-600' },
  ];

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200/70">
        <h1 className="text-sm font-bold text-slate-800">Finance</h1>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
          {live ? 'Live' : 'Sample'}
        </span>
        <div className="ml-auto flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 ring-1 ring-slate-200/60">
          {PERIODS.map((p) => (
            <button key={p.label} onClick={() => setMonths(p.months)}
              className={`h-6 px-2.5 rounded-md text-[11px] font-bold transition-colors ${months === p.months ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {!fin ? (
          <div className="h-40 flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="max-w-5xl space-y-6">
            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {cards.map((c) => (
                <div key={c.label} className="rounded-xl bg-white ring-1 ring-slate-200/60 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{c.label}</span>
                    <c.icon className="w-4 h-4 text-slate-300" />
                  </div>
                  <div className={`mt-2 text-2xl font-black tabular-nums ${c.tone}`}>{c.value}</div>
                  <div className="text-[11px] font-medium text-slate-400">{c.sub}</div>
                </div>
              ))}
            </div>

            {/* Revenue vs costs chart */}
            <div className="rounded-xl bg-white ring-1 ring-slate-200/60 p-5">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <h2 className="text-sm font-bold text-slate-800">Revenue vs costs</h2>
                  <p className="text-[12px] text-slate-400">Last {months} {months === 1 ? 'month' : 'months'} · money in vs money out</p>
                </div>
                <div className="flex items-center gap-4 text-[11px] font-semibold">
                  <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Revenue</span>
                  <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="w-2.5 h-2.5 rounded-sm bg-slate-400" /> Costs</span>
                </div>
              </div>
              {loading ? (
                <div className="h-56 flex items-center justify-center text-slate-300"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : (
                <FinanceChart series={fin.series} />
              )}
            </div>

            {/* Quick links into the ledgers */}
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { label: 'Invoices', desc: 'Money in — accounts receivable', icon: Receipt, href: '/objects/invoices', tone: 'text-emerald-600' },
                { label: 'Expenses', desc: 'Money out — accounts payable', icon: Wallet, href: '/objects/expenses', tone: 'text-rose-600' },
              ].map((q) => (
                <Link key={q.label} href={q.href}
                  className="group flex items-center gap-3 rounded-xl bg-white ring-1 ring-slate-200/60 p-4 hover:ring-slate-300 hover:shadow-sm transition-all">
                  <div className="w-9 h-9 rounded-lg bg-slate-50 ring-1 ring-slate-200/60 flex items-center justify-center">
                    <q.icon className={`w-4 h-4 ${q.tone}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800">{q.label}</div>
                    <div className="text-[12px] text-slate-400 truncate">{q.desc}</div>
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 ml-auto transition-colors" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
