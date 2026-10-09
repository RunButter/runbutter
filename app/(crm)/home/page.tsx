'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import {
  Wallet, PiggyBank, Target, Users, ArrowUpRight, ArrowRight, TrendingUp, Megaphone, FolderKanban, Receipt, Calendar, Briefcase,
} from 'lucide-react';
import {
  getWorkspace, loadFinanceAnalytics, loadBankAccounts, loadBoard, loadLedger,
  type WorkspaceContext, type FinanceAnalytics, type BankAccount, type LedgerTxn,
} from '@/lib/crm/data';
import type { PipelineRecord } from '@/lib/crm/types';
import { loadHrOverview, hrStatus, type HrOverview } from '@/lib/hr/overview';
import FinanceChart from '@/components/crm/FinanceChart';
import HiringFunnel from '@/components/crm/HiringFunnel';
import StatCard, { monthlyMomentum } from '@/components/ui/StatCard';
import EmptyState from '@/components/ui/EmptyState';
import SeedDemoData from '@/components/crm/SeedDemoData';
import HomeExtras from '@/components/crm/HomeExtras';
import DataBadge from '@/components/ui/DataBadge';
import AppLoading from '@/components/ui/AppLoading';
import { useNav } from '@/lib/crm/nav';

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
  // Bumped after seeding so every panel refetches — the sample data is real
  // rows, so the page must show them rather than needing a manual refresh.
  const [reloadKey, setReloadKey] = useState(0);

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
  }, [ready, privy, reloadKey]);

  const live = !!ws;
  const cash = accounts.reduce((s, a) => s + a.balance, 0);
  const openDeals = deals.filter((d) => d.status === 'active');
  const pipelineValue = openDeals.reduce((s, d) => s + (d.amount || 0), 0);
  const net = fin?.net ?? 0;
  // Truthful monthly net series (revenue − costs) for the Net-profit sparkline.
  const netSeries = fin?.series?.map((p) => p.revenue - p.costs) ?? [];

  // Settings → Modules switches whole sections off; Home must follow, or a
  // company that does not hire still opens on a Candidates tile and a hiring
  // funnel. Read from the SAME nav the rail draws, so the two cannot disagree.
  const nav = useNav(privy);
  const shown = new Set(nav.map((g) => g.group));
  const on = (group: string) => shown.has(group);

  const kpis = [
    { label: 'Cash in bank', value: money(cash), sub: `${accounts.length} account${accounts.length === 1 ? '' : 's'}`, icon: Wallet, tone: cash < 0 ? 'text-danger' : 'text-success', href: '/finance/transactions' },
    { label: 'Net profit', value: fin ? money(net) : '—', sub: fin ? `${fin.margin}% margin · 12M` : '—', icon: PiggyBank, tone: net >= 0 ? 'text-success' : 'text-danger', href: '/finance/overview', spark: netSeries, trend: monthlyMomentum(netSeries) },
    { label: 'Open pipeline', value: money(pipelineValue), sub: `${openDeals.length} active deal${openDeals.length === 1 ? '' : 's'}`, icon: Target, tone: 'text-accent', href: '/pipelines/sales/board' },
    { label: 'Candidates', value: hr ? String(hr.stats.totalCandidates) : '—', sub: hr ? `${hr.stats.pendingReview} in review` : '—', icon: Users, tone: 'text-accent', href: '/dashboard/overview' },
  ].filter((k) => on(k.label === 'Open pipeline' ? 'Sales' : k.label === 'Candidates' ? 'HR' : 'Finance'));
  const kpiCols = ['', 'lg:grid-cols-1', 'lg:grid-cols-2', 'lg:grid-cols-3', 'lg:grid-cols-4'][kpis.length] || 'lg:grid-cols-4';

  const pillars = [
    { group: 'Sales', label: 'Sales', desc: `${openDeals.length} open deals`, icon: Target, href: '/pipelines/sales/board' },
    { group: 'Finance', label: 'Finance', desc: `${money(cash)} cash`, icon: TrendingUp, href: '/finance/overview' },
    { group: 'Marketing', label: 'Marketing', desc: 'Campaigns & analytics', icon: Megaphone, href: '/marketing/overview' },
    { group: 'HR', label: 'Recruiting', desc: hr ? `${hr.stats.activePositions} open roles` : 'Hiring & HR', icon: Briefcase, href: '/dashboard/overview' },
    { group: 'Projects', label: 'Projects', desc: 'Projects & roadmap', icon: FolderKanban, href: '/objects/projects' },
  ].filter((p) => on(p.group));
  const showCash = on('Finance');
  const showHiring = on('HR');

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 page-x">
        <h1 className="text-md font-medium text-primary">Home</h1>
        <DataBadge live={live} />
      </header>

      <div className="flex-1 overflow-auto page-pad">
        <div className="space-y-6">
          {/* Greeting */}
          <div>
            <h2 className="text-2xl font-medium text-primary tracking-tight">{greeting()}{ws?.name ? `, ${ws.name}` : ''}</h2>
            <p className="text-sm text-secondary mt-0.5">Here’s what’s happening across your company today.</p>
          </div>

          {/* Only on a workspace with nothing in it. An empty pipeline beside
              an empty ledger demonstrates nothing about a product whose pitch
              is that they are the same database. */}
          {live && !loading && deals.length === 0 && accounts.length === 0 && (fin?.series?.length ?? 0) === 0 && (
            <SeedDemoData privy={privy} ws={ws?.id ?? null} onSeeded={() => setReloadKey((k) => k + 1)} />
          )}

          {/* Cross-pillar KPIs */}
          {kpis.length > 0 && <div className={`grid grid-cols-2 ${kpiCols} gap-3`}>
            {kpis.map((k) => (
              <StatCard
                key={k.label}
                label={k.label}
                value={k.value}
                sub={k.sub}
                icon={k.icon}
                tone={k.tone}
                spark={'spark' in k ? k.spark : undefined}
                trend={'trend' in k ? k.trend : undefined}
                href={k.href}
              />
            ))}
          </div>}

          {/* Two questions the dashboard could not answer until the copilot and
              the usage table existed. Placed above the tables because "what did
              the AI do" is a today question and the tables are a history. */}
          <HomeExtras privy={privy} ws={ws?.id ?? null} />

          {/* Cashflow + hiring funnel */}
          {(showCash || showHiring) && <div className="grid lg:grid-cols-3 gap-4">
            {showCash && <div className={`${showHiring ? 'lg:col-span-2' : 'lg:col-span-3'} card-surface p-5`}>
              <div className="flex items-center justify-between mb-1">
                <div>
                  <h3 className="text-base font-medium text-primary">Cashflow</h3>
                  <p className="text-xs text-tertiary">Revenue vs costs · last 12 months</p>
                </div>
                <div className="flex items-center gap-4 text-2xs font-semibold">
                  <span className="inline-flex items-center gap-1.5 text-secondary"><span className="w-2.5 h-2.5 rounded-sm bg-success" /> Revenue</span>
                  <span className="inline-flex items-center gap-1.5 text-secondary"><span className="w-2.5 h-2.5 rounded-sm bg-strong" /> Costs</span>
                </div>
              </div>
              {loading || !fin ? (
                <AppLoading />
              ) : (
                <FinanceChart series={fin.series} />
              )}
            </div>}

            {showHiring && <div className={`${showCash ? '' : 'lg:col-span-3'} card-surface p-5 flex flex-col`}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-base font-medium text-primary">Hiring funnel</h3>
                  <p className="text-xs text-tertiary">Candidates by stage</p>
                </div>
                <Link href="/dashboard/pipeline" className="text-xs font-medium text-secondary hover:text-primary transition-colors inline-flex items-center gap-0.5">Pipeline <ArrowRight className="w-3 h-3" /></Link>
              </div>
              {loading || !hr ? (
                <AppLoading />
              ) : (
                <HiringFunnel stages={hr.funnel} />
              )}
            </div>}
          </div>}

          {/* Explore pillars */}
          {pillars.length > 0 && <div>
            <h2 className="text-base font-medium text-primary mb-3">Jump back in</h2>
            <div className="grid grid-cols-3 lg:grid-cols-5 gap-2.5">
              {pillars.map((p) => (
                <Link key={p.label} href={p.href} className="group card-surface p-4 hover:ring-strong hover:shadow-elevated transition-all">
                  <div className="w-9 h-9 rounded-xl bg-inverse flex items-center justify-center mb-3">
                    <p.icon className="w-4 h-4 text-inverse-fg" />
                  </div>
                  <div className="text-sm font-medium text-primary truncate">{p.label}</div>
                  <div className="text-xs text-tertiary truncate">{p.desc}</div>
                </Link>
              ))}
            </div>
          </div>}

          {/* Recent activity */}
          {(showCash || showHiring) && <div className={`grid ${showCash && showHiring ? 'lg:grid-cols-2' : ''} gap-4`}>
            {/* Recent applications */}
            {showHiring && <div className="card-surface overflow-hidden">
              <div className="flex items-center justify-between px-5 h-12 border-b border-subtle">
                <h3 className="text-base font-medium text-primary">Recent applications</h3>
                <Link href="/dashboard/candidates" className="text-xs font-medium text-secondary hover:text-primary transition-colors inline-flex items-center gap-0.5">All <ArrowRight className="w-3 h-3" /></Link>
              </div>
              <div className="divide-y divide-subtle">
                {(hr?.recent || []).length === 0 ? (
                  <EmptyState icon={Users} title="No candidates yet"
                    description="Applications land here as soon as your first position goes live." />
                ) : (hr?.recent || []).map((c) => {
                  const st = hrStatus(c.status);
                  return (
                    <Link key={c.id} href={`/dashboard/candidates/${c.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-sunken/70 transition-colors">
                      <div className="w-7 h-7 rounded-full bg-surface-hover text-secondary text-3xs font-semibold flex items-center justify-center shrink-0">
                        {(c.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-primary truncate">{c.full_name}</div>
                        <div className="text-2xs text-tertiary truncate">{c.position_title || '—'}</div>
                      </div>
                      <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-2xs font-semibold ring-1 ${st.cls}`}>{st.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>}

            {/* Recent transactions */}
            {showCash && <div className="card-surface overflow-hidden">
              <div className="flex items-center justify-between px-5 h-12 border-b border-subtle">
                <h3 className="text-base font-medium text-primary">Recent transactions</h3>
                <Link href="/finance/transactions" className="text-xs font-medium text-secondary hover:text-primary transition-colors inline-flex items-center gap-0.5">All <ArrowRight className="w-3 h-3" /></Link>
              </div>
              <div className="divide-y divide-subtle">
                {txns.length === 0 ? (
                  <EmptyState icon={Receipt} title="No transactions yet"
                    description="Import a bank statement to start reconciling against your invoices." />
                ) : txns.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-primary truncate">{t.description || '—'}</div>
                      <div className="text-2xs text-tertiary">{fmtDate(t.txn_date)}{t.category ? ` · ${t.category}` : ''}</div>
                    </div>
                    <span className={`shrink-0 text-sm font-semibold tabular-nums ${t.amount < 0 ? 'text-danger' : 'text-success'}`}>{money(t.amount)}</span>
                  </div>
                ))}
              </div>
            </div>}
          </div>}
        </div>
      </div>
    </>
  );
}
