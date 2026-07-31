'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { Megaphone, Wallet, Users, Target, ArrowUpRight, Loader2, Radio } from 'lucide-react';
import { loadRecords } from '@/lib/crm/data';
import StatCard from '@/components/ui/StatCard';

const money = (n: number) => '$' + Math.round(n).toLocaleString();

const CHANNEL_TONE: Record<string, string> = {
  email: 'bg-accent', social: 'bg-accent/70', ads: 'bg-warning',
  event: 'bg-accent/40', content: 'bg-success', other: 'bg-strong',
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
    { label: 'Active campaigns', value: String(stats.active), sub: `${rows.length} total`, icon: Megaphone, tone: 'text-accent' },
    { label: 'Spend', value: money(stats.spend), sub: `of ${money(stats.budget)} budget`, icon: Wallet, tone: 'text-secondary' },
    { label: 'Leads', value: stats.leads.toLocaleString(), sub: 'from all campaigns', icon: Users, tone: 'text-success' },
    { label: 'Cost / lead', value: stats.leads ? money(stats.cpl) : '—', sub: 'spend ÷ leads', icon: Target, tone: 'text-warning' },
  ];

  const maxSpend = Math.max(1, ...stats.byChannel.map(([, v]) => v.spend));

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 px-6 border-b border-subtle">
        <h1 className="text-md font-medium text-primary">Marketing</h1>
        <span className={`text-3xs font-medium uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
          {live ? 'Live' : 'Sample'}
        </span>
      </header>

      <div className="flex-1 overflow-auto p-6 2xl:p-8">
        {loading ? (
          <div className="h-40 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="max-w-5xl space-y-6">
            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {cards.map((c) => (
                <StatCard key={c.label} label={c.label} value={c.value} sub={c.sub} icon={c.icon} tone={c.tone} />
              ))}
            </div>

            {/* Spend by channel */}
            <div className="card-surface p-5">
              <h2 className="text-base font-medium text-primary mb-1">Spend by channel</h2>
              <p className="text-xs text-tertiary mb-4">Where the budget goes, and what it brings back.</p>
              {stats.byChannel.length === 0 ? (
                <p className="py-6 text-center text-sm text-tertiary">No campaigns yet — create your first one.</p>
              ) : (
                <div className="space-y-3">
                  {stats.byChannel.map(([channel, v]) => (
                    <div key={channel} className="flex items-center gap-3">
                      <span className="w-16 text-xs font-semibold text-secondary capitalize shrink-0">{channel}</span>
                      <div className="flex-1 h-2.5 rounded-full bg-surface-hover overflow-hidden">
                        <div className={`h-full rounded-full ${CHANNEL_TONE[channel] || CHANNEL_TONE.other}`} style={{ width: `${(v.spend / maxSpend) * 100}%` }} />
                      </div>
                      <span className="w-20 text-right text-xs tabular-nums text-secondary shrink-0">{money(v.spend)}</span>
                      <span className="w-16 text-right text-xs tabular-nums text-tertiary shrink-0">{v.leads} leads</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick links */}
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { label: 'Campaigns', desc: 'Plan, budget, and track results', icon: Megaphone, href: '/objects/campaigns', tone: 'text-accent' },
                { label: 'Source tracking', desc: 'UTM links — see where people come from', icon: Radio, href: '/dashboard/sources', tone: 'text-accent' },
              ].map((q) => (
                <Link key={q.label} href={q.href}
                  className="group flex items-center gap-3 card-surface p-4 hover:ring-strong hover:shadow-elevated transition-all">
                  <div className="w-9 h-9 rounded-xl bg-inverse flex items-center justify-center">
                    <q.icon className={`w-4 h-4 ${q.tone}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-primary">{q.label}</div>
                    <div className="text-xs text-tertiary truncate">{q.desc}</div>
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
