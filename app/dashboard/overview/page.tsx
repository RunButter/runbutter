'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import {
  Users, Briefcase, CheckCircle2, Calendar, TrendingUp, Clock, Loader2,
  Plus, Columns3, Sparkles, Mail, ArrowUpRight,
} from 'lucide-react';
import { loadHrOverview, hrStatus, type HrOverview } from '@/lib/hr/overview';
import HiringFunnel from '@/components/crm/HiringFunnel';
import StatCard from '@/components/ui/StatCard';
import PageHeader from '@/components/ui/PageHeader';
import SectionCard from '@/components/ui/SectionCard';

const fmtDate = (s?: string | null) => {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en', { day: '2-digit', month: 'short' });
};

// Icons here are wayfinding, not status, so they are all one colour. They used
// to be accent/warning/success by row, which implied a grouping that does not
// exist — "Interviews" is not more urgent than "Candidates".
const QUICK = [
  { label: 'Hiring pipeline', desc: 'Drag-and-drop stages', icon: Columns3, href: '/dashboard/pipeline' },
  { label: 'Candidates', desc: 'Browse all applicants', icon: Users, href: '/dashboard/candidates' },
  { label: 'Positions', desc: 'Create & manage roles', icon: Briefcase, href: '/dashboard/positions' },
  { label: 'Interviews', desc: 'Schedule & track', icon: Calendar, href: '/dashboard/interviews' },
  { label: 'Talent Treasury', desc: 'Explore your talent pool', icon: Sparkles, href: '/dashboard/treasury' },
  { label: 'Email templates', desc: 'Reusable candidate emails', icon: Mail, href: '/dashboard/templates' },
];

export default function HrOverviewPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [hr, setHr] = useState<HrOverview | null>(null);

  useEffect(() => { if (ready) loadHrOverview(privy).then(setHr); }, [ready, privy]);

  const s = hr?.stats;
  // No per-card tone: these are plain counts. See StatCard's `tone` note.
  const kpis = [
    { label: 'Candidates', value: s?.totalCandidates, icon: Users },
    { label: 'Open roles', value: s?.activePositions, icon: Briefcase },
    { label: 'Assessed', value: s?.assessmentsCompleted, icon: CheckCircle2 },
    { label: 'Interviews', value: s?.upcomingInterviews, icon: Calendar },
    { label: 'New (7d)', value: s?.newApplications, icon: TrendingUp },
    { label: 'Pending', value: s?.pendingReview, icon: Clock },
  ];

  return (
    <div className="p-5 sm:p-6 2xl:p-8">
      <div className="max-w-6xl space-y-6">
        <PageHeader
          title="Recruiting"
          subtitle="Your hiring pipeline, candidates and open roles"
          badges={
            <>
              <span className={`text-3xs font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ${hr?.live ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                {hr?.live ? 'Live' : 'Sample'}
              </span>
              {hr?.company?.plan && (
                <span className="text-3xs font-semibold text-secondary bg-surface-hover rounded-md px-2 py-0.5 capitalize">
                  {hr.company.plan} plan
                </span>
              )}
            </>
          }
          actions={
            <Link href="/dashboard/positions/new" className="h-10 px-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm transition-colors">
              <Plus className="w-4 h-4" /> New position
            </Link>
          }
        />

        {/* Three across on a phone rather than two: six tiles in a 2-column grid
            is three screenfuls of near-identical boxes before any real content. */}
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2.5">
          {kpis.map((k) => (
            <StatCard key={k.label} label={k.label} value={k.value === undefined ? '—' : k.value} icon={k.icon} />
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          <SectionCard
            className="lg:col-span-2"
            title="Hiring funnel"
            subtitle="Candidates by stage"
            action="Open pipeline"
            actionHref="/dashboard/pipeline"
          >
            {!hr
              ? <div className="h-40 flex items-center justify-center text-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
              : <HiringFunnel stages={hr.funnel} />}
          </SectionCard>

          <SectionCard title="Quick actions">
            <div className="-mx-2 space-y-0.5">
              {QUICK.slice(0, 4).map((q) => (
                <Link key={q.label} href={q.href} className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-sunken transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-surface-sunken ring-1 ring-subtle flex items-center justify-center shrink-0">
                    <q.icon className="w-4 h-4 text-secondary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-primary truncate">{q.label}</div>
                    <div className="text-2xs text-tertiary truncate">{q.desc}</div>
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-tertiary group-hover:text-secondary transition-colors shrink-0" />
                </Link>
              ))}
            </div>
          </SectionCard>
        </div>

        <SectionCard
          flush
          title="Recent applications"
          meta={hr?.recent.length ? `${hr.recent.length} shown` : undefined}
          action="All candidates"
          actionHref="/dashboard/candidates"
        >
          {!hr ? (
            <div className="h-32 flex items-center justify-center text-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : hr.recent.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Users className="w-10 h-10 text-tertiary mx-auto mb-3" />
              <p className="text-sm text-secondary mb-4">No candidates yet.</p>
              <Link href="/dashboard/positions/new" className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">
                Create your first position
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-subtle">
              {hr.recent.map((c) => {
                const st = hrStatus(c.status);
                return (
                  <Link key={c.id} href={`/dashboard/candidates/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-sunken/70 transition-colors">
                    <div className="w-9 h-9 rounded-full bg-surface-hover text-secondary text-2xs font-semibold flex items-center justify-center shrink-0">
                      {(c.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-primary truncate">{c.full_name}</div>
                      <div className="text-2xs text-tertiary truncate">{c.email}{c.position_title ? ` · ${c.position_title}` : ''}</div>
                    </div>
                    <span className="hidden sm:block text-2xs text-tertiary tabular-nums">{fmtDate(c.applied_at)}</span>
                    <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-2xs font-semibold ring-1 ${st.cls}`}>{st.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
