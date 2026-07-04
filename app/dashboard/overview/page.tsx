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
  { label: 'Hiring pipeline', desc: 'Drag-and-drop stages', icon: Columns3, href: '/dashboard/pipeline', tone: 'text-primary-600' },
  { label: 'Candidates', desc: 'Browse all applicants', icon: Users, href: '/dashboard/candidates', tone: 'text-cyan-600' },
  { label: 'Positions', desc: 'Create & manage roles', icon: Briefcase, href: '/dashboard/positions', tone: 'text-violet-600' },
  { label: 'Interviews', desc: 'Schedule & track', icon: Calendar, href: '/dashboard/interviews', tone: 'text-orange-600' },
  { label: 'Talent Treasury', desc: 'Explore your talent pool', icon: Sparkles, href: '/dashboard/treasury', tone: 'text-amber-600' },
  { label: 'Email templates', desc: 'Reusable candidate emails', icon: Mail, href: '/dashboard/templates', tone: 'text-emerald-600' },
];

export default function HrOverviewPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [hr, setHr] = useState<HrOverview | null>(null);

  useEffect(() => { if (ready) loadHrOverview(privy).then(setHr); }, [ready, privy]);

  const s = hr?.stats;
  const kpis = [
    { label: 'Candidates', value: s?.totalCandidates, icon: Users, tone: 'text-cyan-600' },
    { label: 'Open roles', value: s?.activePositions, icon: Briefcase, tone: 'text-violet-600' },
    { label: 'Assessed', value: s?.assessmentsCompleted, icon: CheckCircle2, tone: 'text-emerald-600' },
    { label: 'Interviews', value: s?.upcomingInterviews, icon: Calendar, tone: 'text-orange-600' },
    { label: 'New (7d)', value: s?.newApplications, icon: TrendingUp, tone: 'text-indigo-600' },
    { label: 'Pending', value: s?.pendingReview, icon: Clock, tone: 'text-amber-600' },
  ];

  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Title */}
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Recruiting</h1>
          <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${hr?.live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{hr?.live ? 'Live' : 'Sample'}</span>
          {hr?.company?.plan && <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 rounded-md px-2 py-0.5 capitalize">{hr.company.plan} plan</span>}
          <Link href="/dashboard/positions/new" className="ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 shadow-sm transition-colors">
            <Plus className="w-3.5 h-3.5" /> New position
          </Link>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-xl bg-white ring-1 ring-slate-200/60 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{k.label}</span>
                <k.icon className="w-4 h-4 text-slate-300" />
              </div>
              <div className={`mt-2 text-2xl font-black tabular-nums ${k.tone}`}>{k.value === undefined ? '—' : k.value}</div>
            </div>
          ))}
        </div>

        {/* Funnel + quick actions */}
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-xl bg-white ring-1 ring-slate-200/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-slate-800">Hiring funnel</h2>
                <p className="text-[12px] text-slate-400">Candidates by stage</p>
              </div>
              <Link href="/dashboard/pipeline" className="text-[12px] font-semibold text-primary-600 hover:text-primary-700 inline-flex items-center gap-0.5">Open pipeline <ArrowRight className="w-3 h-3" /></Link>
            </div>
            {!hr ? <div className="h-40 flex items-center justify-center text-slate-300"><Loader2 className="w-5 h-5 animate-spin" /></div> : <HiringFunnel stages={hr.funnel} />}
          </div>

          <div className="rounded-xl bg-white ring-1 ring-slate-200/60 p-3">
            <div className="px-2 pt-1.5 pb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">Quick actions</div>
            <div className="space-y-0.5">
              {QUICK.slice(0, 4).map((q) => (
                <Link key={q.label} href={q.href} className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-slate-50 ring-1 ring-slate-200/60 flex items-center justify-center shrink-0"><q.icon className={`w-4 h-4 ${q.tone}`} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-slate-800">{q.label}</div>
                    <div className="text-[11px] text-slate-400 truncate">{q.desc}</div>
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors" />
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Recent applications */}
        <div className="rounded-xl bg-white ring-1 ring-slate-200/60 overflow-hidden">
          <div className="flex items-center justify-between px-5 h-12 border-b border-slate-200/60">
            <h2 className="text-sm font-bold text-slate-800">Recent applications</h2>
            <Link href="/dashboard/candidates" className="text-[12px] font-semibold text-primary-600 hover:text-primary-700 inline-flex items-center gap-0.5">All candidates <ArrowRight className="w-3 h-3" /></Link>
          </div>
          {!hr ? (
            <div className="h-32 flex items-center justify-center text-slate-300"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : hr.recent.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-[13px] text-slate-500 mb-3">No candidates yet.</p>
              <Link href="/dashboard/positions/new" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700">Create your first position</Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {hr.recent.map((c) => {
                const st = hrStatus(c.status);
                return (
                  <Link key={c.id} href={`/dashboard/candidates/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/70 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 text-slate-600 text-[11px] font-bold flex items-center justify-center shrink-0">
                      {(c.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-slate-800 truncate">{c.full_name}</div>
                      <div className="text-[11px] text-slate-400 truncate">{c.email}{c.position_title ? ` · ${c.position_title}` : ''}</div>
                    </div>
                    <span className="hidden sm:block text-[11px] text-slate-400 tabular-nums">{fmtDate(c.applied_at)}</span>
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
