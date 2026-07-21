'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import {
  Wallet, PiggyBank, Target, Users, ArrowUpRight, ArrowRight, Loader2,
  TrendingUp, Megaphone, FolderKanban, Receipt, Calendar, Briefcase,
} from 'lucide-react';
import {
  getWorkspace, loadFinanceAnalytics, loadBankAccounts, loadBoard, loadLedger,
  type WorkspaceContext, type FinanceAnalytics, type BankAccount, type LedgerTxn,
} from '@/lib/crm/data';
import type { PipelineRecord } from '@/lib/crm/types';
import { loadHrOverview, hrStatus, type HrOverview } from '@/lib/hr/overview';
import FinanceChart from '@/components/crm/FinanceChart';
import HiringFunnel from '@/components/crm/HiringFunnel';

const money = (n: number) => (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(n)).toLocaleString();
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const fmtDate = (s?: string | null) => {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en', { day: '2-digit', month: 'short' });
};

export default function WorkspaceHome() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [fin, setFin] = useState<FinanceAnalytics | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [deals, setDeals] = useState<PipelineRecord[]>([]);
  const [hr, setHr] = useState<HrOverview | null>(null);
  const [txns, setTxns] = useState<LedgerTxn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    Promise.all([
      privy ? getWorkspace(privy) : Promise.resolve(null),
      loadFinanceAnalytics(privy, 12),
      loadBankAccounts(privy),
      loadBoard(privy, 'sales', 'sales'),
      loadHrOverview(privy),
      loadLedger(privy, null, 3),
    ]).then(([w, f, a, b, h, l]) => {
      setWs(w); setFin(f); setAccounts(a.accounts); setDeals(b.records); setHr(h); setTxns(l.rows.slice(0, 5));
      setLoading(false);
    });
  }, [ready, privy]);

  const live = !!ws;
  const cash = accounts.reduce((s, a) => s + a.balance, 0);
  const openDeals = deals.filter((d) => d.status === 'active');
  const pipelineValue = openDeals.reduce((s, d) => s + (d.amount || 0), 0);
  const net = fin?.net ?? 0;

  const kpis = [
    { label: 'Cash in bank', value: money(cash), sub: `${accounts.length} account${accounts.length === 1 ? '' : 's'}`, icon: Wallet, tone: cash < 0 ? 'text-danger' : 'text-success', href: '/finance/transactions' },
    { label: 'Net profit', value: fin ? money(net) : '—', sub: fin ? `${fin.margin}% margin · 12M` : '—', icon: PiggyBank, tone: net >= 0 ? 'text-success' : 'text-danger', href: '/finance/overview' },
    { label: 'Open pipeline', value: money(pipelineValue), sub: `${openDeals.length} active deal${openDeals.length === 1 ? '' : 's'}`, icon: Target, tone: 'text-accent', href: '/pipelines/sales/board' },
    { label: 'Candidates', value: hr ? String(hr.stats.totalCandidates) : '—', sub: hr ? `${hr.stats.pendingReview} in review` : '—', icon: Users, tone: 'text-accent', href: '/dashboard/overview' },
  ];

  const pillars = [
    { label: 'Sales', desc: `${openDeals.length} open deals`, icon: Target, href: '/pipelines/sales/board', tone: 'text-accent', bg: 'bg-accent/10' },
    { label: 'Finance', desc: `${money(cash)} cash`, icon: TrendingUp, href: '/finance/overview', tone: 'text-success', bg: 'bg-success/10' },
    { label: 'Marketing', desc: 'Campaigns & analytics', icon: Megaphone, href: '/marketing/overview', tone: 'text-accent', bg: 'bg-accent/10' },
    { label: 'Recruiting', desc: hr ? `${hr.stats.activePositions} open roles` : 'Hiring & HR', icon: Briefcase, href: '/dashboard/overview', tone: 'text-accent', bg: 'bg-accent/10' },
    { label: 'Projects', desc: 'Boards & roadmap', icon: FolderKanban, href: '/projects/board', tone: 'text-accent', bg: 'bg-accent/10' },
  ];

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-subtle">
        <h1 className="text-sm font-semibold text-primary">Home</h1>
        <span className={`text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>{live ? 'Live' : 'Sample'}</span>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Greeting */}
          <div>
            <h2 className="text-2xl font-semibold text-primary tracking-tight">{greeting()}{ws?.name ? `, ${ws.name}` : ''}</h2>
            <p className="text-sm text-secondary mt-0.5">Here’s what’s happening across your company today.</p>
          </div>

          {/* Cross-pillar KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {kpis.map((k) => (
              <Link key={k.label} href={k.href} className="group rounded-xl bg-surface ring-1 ring-subtle p-4 hover:ring-strong hover:shadow-sm transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">{k.label}</span>
                  <k.icon className="w-4 h-4 text-tertiary group-hover:text-tertiary transition-colors" />
                </div>
                <div className={`mt-2 text-2xl font-semibold tabular-nums ${k.tone}`}>{k.value}</div>
                <div className="text-[11px] font-medium text-tertiary">{k.sub}</div>
              </Link>
            ))}
          </div>

          {/* Cashflow + hiring funnel */}
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-xl bg-surface ring-1 ring-subtle p-5">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <h3 className="text-sm font-semibold text-primary">Cashflow</h3>
                  <p className="text-[12px] text-tertiary">Revenue vs costs · last 12 months</p>
                </div>
                <div className="flex items-center gap-4 text-[11px] font-semibold">
                  <span className="inline-flex items-center gap-1.5 text-secondary"><span className="w-2.5 h-2.5 rounded-sm bg-success" /> Revenue</span>
                  <span className="inline-flex items-center gap-1.5 text-secondary"><span className="w-2.5 h-2.5 rounded-sm bg-strong" /> Costs</span>
                </div>
              </div>
              {loading || !fin ? (
                <div className="h-56 flex items-center justify-center text-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : (
                <FinanceChart series={fin.series} />
              )}
            </div>

            <div className="rounded-xl bg-surface ring-1 ring-subtle p-5 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-primary">Hiring funnel</h3>
                  <p className="text-[12px] text-tertiary">Candidates by stage</p>
                </div>
                <Link href="/dashboard/pipeline" className="text-[12px] font-semibold text-accent hover:text-accent inline-flex items-center gap-0.5">Pipeline <ArrowRight className="w-3 h-3" /></Link>
              </div>
              {loading || !hr ? (
                <div className="flex-1 flex items-center justify-center text-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : (
                <HiringFunnel stages={hr.funnel} />
              )}
            </div>
          </div>

          {/* Explore pillars */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-tertiary mb-3">Jump back in</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {pillars.map((p) => (
                <Link key={p.label} href={p.href} className="group rounded-xl bg-surface ring-1 ring-subtle p-4 hover:ring-strong hover:shadow-sm transition-all">
                  <div className={`w-9 h-9 rounded-lg ${p.bg} ring-1 ring-subtle flex items-center justify-center mb-3`}>
                    <p.icon className={`w-4 h-4 ${p.tone}`} />
                  </div>
                  <div className="text-sm font-semibold text-primary flex items-center gap-1">{p.label}<ArrowUpRight className="w-3 h-3 text-tertiary group-hover:text-secondary transition-colors" /></div>
                  <div className="text-[12px] text-tertiary truncate">{p.desc}</div>
                </Link>
              ))}
            </div>
          </div>

          {/* Recent activity */}
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Recent applications */}
            <div className="rounded-xl bg-surface ring-1 ring-subtle overflow-hidden">
              <div className="flex items-center justify-between px-5 h-12 border-b border-subtle">
                <h3 className="text-sm font-semibold text-primary flex items-center gap-2"><Users className="w-4 h-4 text-accent" /> Recent applications</h3>
                <Link href="/dashboard/candidates" className="text-[12px] font-semibold text-accent hover:text-accent inline-flex items-center gap-0.5">All <ArrowRight className="w-3 h-3" /></Link>
              </div>
              <div className="divide-y divide-subtle">
                {(hr?.recent || []).length === 0 ? (
                  <div className="px-5 py-8 text-center text-[13px] text-tertiary">No candidates yet.</div>
                ) : (hr?.recent || []).map((c) => {
                  const st = hrStatus(c.status);
                  return (
                    <Link key={c.id} href={`/dashboard/candidates/${c.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-sunken/70 transition-colors">
                      <div className="w-7 h-7 rounded-full bg-surface-hover text-secondary text-[10px] font-semibold flex items-center justify-center shrink-0">
                        {(c.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-primary truncate">{c.full_name}</div>
                        <div className="text-[11px] text-tertiary truncate">{c.position_title || '—'}</div>
                      </div>
                      <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ring-1 ${st.cls}`}>{st.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Recent transactions */}
            <div className="rounded-xl bg-surface ring-1 ring-subtle overflow-hidden">
              <div className="flex items-center justify-between px-5 h-12 border-b border-subtle">
                <h3 className="text-sm font-semibold text-primary flex items-center gap-2"><Receipt className="w-4 h-4 text-success" /> Recent transactions</h3>
                <Link href="/finance/transactions" className="text-[12px] font-semibold text-accent hover:text-accent inline-flex items-center gap-0.5">All <ArrowRight className="w-3 h-3" /></Link>
              </div>
              <div className="divide-y divide-subtle">
                {txns.length === 0 ? (
                  <div className="px-5 py-8 text-center text-[13px] text-tertiary">No transactions yet.</div>
                ) : txns.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-primary truncate">{t.description || '—'}</div>
                      <div className="text-[11px] text-tertiary">{fmtDate(t.txn_date)}{t.category ? ` · ${t.category}` : ''}</div>
                    </div>
                    <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${t.amount < 0 ? 'text-danger' : 'text-success'}`}>{money(t.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
