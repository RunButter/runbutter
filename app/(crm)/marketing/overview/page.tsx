'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { Megaphone, Wallet, Users, Target, ArrowUpRight, Loader2, Radio } from 'lucide-react';
import { loadRecords } from '@/lib/crm/data';

const money = (n: number) => '$' + Math.round(n).toLocaleString();

const CHANNEL_TONE: Record<string, string> = {
  email: 'bg-sky-400', social: 'bg-fuchsia-400', ads: 'bg-amber-400',
  event: 'bg-violet-400', content: 'bg-teal-400', other: 'bg-slate-300',
};

export default function MarketingOverview() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [rows, setRows] = useState<any[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    loadRecords(privy, 'campaigns').then((res) => { setRows(res.rows); setLive(res.live); setLoading(false); });
  }, [ready, privy]);

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.status === 'active').length;
    const budget = rows.reduce((s, r) => s + (+r.budget || 0), 0);
    const spend = rows.reduce((s, r) => s + (+r.spend || 0), 0);
    const leads = rows.reduce((s, r) => s + (+r.leads || 0), 0);
    const byChannel = new Map<string, { spend: number; leads: number }>();
    for (const r of rows) {
      const c = byChannel.get(r.channel || 'other') || { spend: 0, leads: 0 };
      c.spend += +r.spend || 0; c.leads += +r.leads || 0;
      byChannel.set(r.channel || 'other', c);
    }
    return { active, budget, spend, leads, cpl: leads > 0 ? spend / leads : 0, byChannel: [...byChannel.entries()].sort((a, b) => b[1].spend - a[1].spend) };
  }, [rows]);

  const cards = [
    { label: 'Active campaigns', value: String(stats.active), sub: `${rows.length} total`, icon: Megaphone, tone: 'text-fuchsia-600' },
    { label: 'Spend', value: money(stats.spend), sub: `of ${money(stats.budget)} budget`, icon: Wallet, tone: 'text-slate-700' },
    { label: 'Leads', value: stats.leads.toLocaleString(), sub: 'from all campaigns', icon: Users, tone: 'text-emerald-600' },
    { label: 'Cost / lead', value: stats.leads ? money(stats.cpl) : '—', sub: 'spend ÷ leads', icon: Target, tone: 'text-amber-600' },
  ];

  const maxSpend = Math.max(1, ...stats.byChannel.map(([, v]) => v.spend));

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200/70">
        <h1 className="text-sm font-bold text-slate-800">Marketing</h1>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
          {live ? 'Live' : 'Sample'}
        </span>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
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

            {/* Spend by channel */}
            <div className="rounded-xl bg-white ring-1 ring-slate-200/60 p-5">
              <h2 className="text-sm font-bold text-slate-800 mb-1">Spend by channel</h2>
              <p className="text-[12px] text-slate-400 mb-4">Where the budget goes, and what it brings back.</p>
              {stats.byChannel.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-slate-400">No campaigns yet — create your first one.</p>
              ) : (
                <div className="space-y-3">
                  {stats.byChannel.map(([channel, v]) => (
                    <div key={channel} className="flex items-center gap-3">
                      <span className="w-16 text-[12px] font-semibold text-slate-600 capitalize shrink-0">{channel}</span>
                      <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className={`h-full rounded-full ${CHANNEL_TONE[channel] || CHANNEL_TONE.other}`} style={{ width: `${(v.spend / maxSpend) * 100}%` }} />
                      </div>
                      <span className="w-20 text-right text-[12px] tabular-nums text-slate-600 shrink-0">{money(v.spend)}</span>
                      <span className="w-16 text-right text-[12px] tabular-nums text-slate-400 shrink-0">{v.leads} leads</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick links */}
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { label: 'Campaigns', desc: 'Plan, budget, and track results', icon: Megaphone, href: '/objects/campaigns', tone: 'text-fuchsia-600' },
                { label: 'Source tracking', desc: 'UTM links — see where people come from', icon: Radio, href: '/dashboard/sources', tone: 'text-sky-600' },
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
