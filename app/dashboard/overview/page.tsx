'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import {
  Users, Briefcase, CheckCircle2, Calendar, TrendingUp, Clock, Loader2,
  Plus, ArrowRight, Columns3, Sparkles, Mail, ArrowUpRight,
} from 'lucide-react';
import { loadHrOverview, hrStatus, type HrOverview } from '@/lib/hr/overview';
import HiringFunnel from '@/components/crm/HiringFunnel';

const fmtDate = (s?: string | null) => {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en', { day: '2-digit', month: 'short' });
};

const QUICK = [
  { label: 'Hiring pipeline', desc: 'Drag-and-drop stages', icon: Columns3, href: '/dashboard/pipeline', tone: 'text-accent' },
  { label: 'Candidates', desc: 'Browse all applicants', icon: Users, href: '/dashboard/candidates', tone: 'text-cyan-600' },
  { label: 'Positions', desc: 'Create & manage roles', icon: Briefcase, href: '/dashboard/positions', tone: 'text-accent' },
  { label: 'Interviews', desc: 'Schedule & track', icon: Calendar, href: '/dashboard/interviews', tone: 'text-orange-600' },
  { label: 'Talent Treasury', desc: 'Explore your talent pool', icon: Sparkles, href: '/dashboard/treasury', tone: 'text-warning' },
  { label: 'Email templates', desc: 'Reusable candidate emails', icon: Mail, href: '/dashboard/templates', tone: 'text-success' },
];

export default function HrOverviewPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [hr, setHr] = useState<HrOverview | null>(null);

  useEffect(() => { if (ready) loadHrOverview(privy).then(setHr); }, [ready, privy]);

  const s = hr?.stats;
  const kpis = [
    { label: 'Candidates', value: s?.totalCandidates, icon: Users, tone: 'text-cyan-600' },
    { label: 'Open roles', value: s?.activePositions, icon: Briefcase, tone: 'text-accent' },
    { label: 'Assessed', value: s?.assessmentsCompleted, icon: CheckCircle2, tone: 'text-success' },
    { label: 'Interviews', value: s?.upcomingInterviews, icon: Calendar, tone: 'text-orange-600' },
    { label: 'New (7d)', value: s?.newApplications, icon: TrendingUp, tone: 'text-accent' },
    { label: 'Pending', value: s?.pendingReview, icon: Clock, tone: 'text-warning' },
  ];

  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Title */}
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold text-primary tracking-tight">Recruiting</h1>
          <span className={`text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ${hr?.live ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>{hr?.live ? 'Live' : 'Sample'}</span>
          {hr?.company?.plan && <span className="text-[11px] font-semibold text-secondary bg-surface-hover rounded-md px-2 py-0.5 capitalize">{hr.company.plan} plan</span>}
          <Link href="/dashboard/positions/new" className="ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-semibold text-white bg-accent hover:bg-accent/90 shadow-sm transition-colors">
            <Plus className="w-3.5 h-3.5" /> New position
          </Link>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-xl bg-surface ring-1 ring-subtle p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">{k.label}</span>
                <k.icon className="w-4 h-4 text-tertiary" />
              </div>
              <div className={`mt-2 text-2xl font-semibold tabular-nums ${k.tone}`}>{k.value === undefined ? '—' : k.value}</div>
            </div>
          ))}
        </div>

        {/* Funnel + quick actions */}
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-xl bg-surface ring-1 ring-subtle p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-primary">Hiring funnel</h2>
                <p className="text-[12px] text-tertiary">Candidates by stage</p>
              </div>
              <Link href="/dashboard/pipeline" className="text-[12px] font-semibold text-accent hover:text-accent inline-flex items-center gap-0.5">Open pipeline <ArrowRight className="w-3 h-3" /></Link>
            </div>
            {!hr ? <div className="h-40 flex items-center justify-center text-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div> : <HiringFunnel stages={hr.funnel} />}
          </div>

          <div className="rounded-xl bg-surface ring-1 ring-subtle p-3">
            <div className="px-2 pt-1.5 pb-2 text-[11px] font-semibold uppercase tracking-widest text-tertiary">Quick actions</div>
            <div className="space-y-0.5">
              {QUICK.slice(0, 4).map((q) => (
                <Link key={q.label} href={q.href} className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-sunken transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-surface-sunken ring-1 ring-subtle flex items-center justify-center shrink-0"><q.icon className={`w-4 h-4 ${q.tone}`} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-primary">{q.label}</div>
                    <div className="text-[11px] text-tertiary truncate">{q.desc}</div>
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-tertiary group-hover:text-secondary transition-colors" />
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Recent applications */}
        <div className="rounded-xl bg-surface ring-1 ring-subtle overflow-hidden">
          <div className="flex items-center justify-between px-5 h-12 border-b border-subtle">
            <h2 className="text-sm font-semibold text-primary">Recent applications</h2>
            <Link href="/dashboard/candidates" className="text-[12px] font-semibold text-accent hover:text-accent inline-flex items-center gap-0.5">All candidates <ArrowRight className="w-3 h-3" /></Link>
          </div>
          {!hr ? (
            <div className="h-32 flex items-center justify-center text-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : hr.recent.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Users className="w-10 h-10 text-tertiary mx-auto mb-3" />
              <p className="text-[13px] text-secondary mb-3">No candidates yet.</p>
              <Link href="/dashboard/positions/new" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-semibold text-white bg-accent hover:bg-accent/90">Create your first position</Link>
            </div>
          ) : (
            <div className="divide-y divide-subtle">
              {hr.recent.map((c) => {
                const st = hrStatus(c.status);
                return (
                  <Link key={c.id} href={`/dashboard/candidates/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-sunken/70 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 text-secondary text-[11px] font-semibold flex items-center justify-center shrink-0">
                      {(c.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-primary truncate">{c.full_name}</div>
                      <div className="text-[11px] text-tertiary truncate">{c.email}{c.position_title ? ` · ${c.position_title}` : ''}</div>
                    </div>
                    <span className="hidden sm:block text-[11px] text-tertiary tabular-nums">{fmtDate(c.applied_at)}</span>
                    <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ring-1 ${st.cls}`}>{st.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
