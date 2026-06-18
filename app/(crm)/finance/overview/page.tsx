'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { TrendingUp, Clock, Wallet, Receipt, ArrowUpRight, Loader2 } from 'lucide-react';
import { loadFinance, type FinanceResult } from '@/lib/crm/data';

const money = (n: number) => '$' + Math.round(n).toLocaleString();

export default function FinanceOverview() {
  const { ready, authenticated, user } = usePrivy();
  const [fin, setFin] = useState<FinanceResult | null>(null);

  useEffect(() => {
    if (!ready) return;
    loadFinance(authenticated && user ? user.id : null).then(setFin);
  }, [ready, authenticated, user]);

  const live = fin?.live ?? false;
  const net = fin ? fin.revenue - fin.expenses : 0;

  const cards = [
    { label: 'Revenue (paid)', value: fin ? money(fin.revenue) : '—', icon: TrendingUp, href: '/objects/invoices', tone: 'text-emerald-600' },
    { label: 'Outstanding', value: fin ? money(fin.outstanding) : '—', icon: Clock, href: '/objects/invoices', tone: 'text-amber-600' },
    { label: 'Expenses', value: fin ? money(fin.expenses) : '—', icon: Wallet, href: '/objects/expenses', tone: 'text-rose-600' },
    { label: 'Net', value: fin ? money(net) : '—', icon: Receipt, href: '/objects/invoices', tone: net >= 0 ? 'text-slate-900' : 'text-rose-600' },
  ];

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200/70">
        <h1 className="text-sm font-bold text-slate-800">Finance</h1>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
          {live ? 'Live' : 'Sample'}
        </span>
      </header>
      <div className="flex-1 overflow-auto p-6">
        {!fin ? (
          <div className="h-40 flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 max-w-4xl">
            {cards.map((c) => (
              <Link key={c.label} href={c.href}
                className="group rounded-xl bg-white ring-1 ring-slate-200/60 p-4 hover:ring-slate-300 hover:shadow-sm transition-all">
                <div className="flex items-center justify-between">
                  <c.icon className="w-4 h-4 text-slate-400" />
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors" />
                </div>
                <div className={`mt-3 text-2xl font-black tabular-nums ${c.tone}`}>{c.value}</div>
                <div className="text-[12px] font-medium text-slate-400">{c.label}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
