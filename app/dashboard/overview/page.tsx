'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import {
  Users, Briefcase, Calendar, Clock, Plus,
} from 'lucide-react';
import { loadHrOverview, hrStatus, type HrOverview } from '@/lib/hr/overview';
import HiringFunnel from '@/components/crm/HiringFunnel';
import StatCard from '@/components/ui/StatCard';
import PageHeader from '@/components/dashboard/PageHeader';
import DataBadge from '@/components/ui/DataBadge';
import SectionCard from '@/components/ui/SectionCard';
import ListRow from '@/components/ui/ListRow';
import AppLoading from '@/components/ui/AppLoading';

const fmtDate = (s?: string | null) => {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en', { day: '2-digit', month: 'short' });
};


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
    { label: 'Interviews', value: s?.upcomingInterviews, icon: Calendar },
    { label: 'To review', value: s?.pendingReview, icon: Clock, sub: s ? `${s.newApplications} new this week` : undefined },
  ];

  return (
    <>
      {/* The same header every other screen has. This one was a 24px title
          with an uppercase SAMPLE chip and a 40px button, which made Recruiting
          look like a different product from the rail beside it. */}
      <PageHeader title="Recruiting" badge={hr ? <DataBadge live={hr.live} /> : null}>
        <Link href="/dashboard/positions/new"
          className="h-7 px-2 inline-flex items-center gap-1 rounded-md text-xs font-medium text-inverse-fg bg-inverse hover:bg-inverse/90 transition-colors">
          <Plus className="w-3.5 h-3.5" /> New position
        </Link>
      </PageHeader>
    <div className="page-pad">
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((k) => (
            <StatCard key={k.label} label={k.label} value={k.value === undefined ? '—' : k.value} icon={k.icon} sub={(k as any).sub} />
          ))}
        </div>

        {/* Full width. A "Quick actions" card sat beside it listing four
            links that are already in the rail one inch to the left. */}
        <SectionCard
          title="Hiring funnel"
          subtitle="Candidates by stage"
          action="Open pipeline"
          actionHref="/dashboard/pipeline"
        >
          {!hr
            ? <AppLoading />
            : <HiringFunnel stages={hr.funnel} />}
        </SectionCard>

        <SectionCard
          flush
          title="Recent applications"
          meta={hr?.recent.length ? `${hr.recent.length} shown` : undefined}
          action="All candidates"
          actionHref="/dashboard/candidates"
        >
          {!hr ? (
            <AppLoading />
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
                  <ListRow
                    key={c.id}
                    href={`/dashboard/candidates/${c.id}`}
                    leading={
                      <span className="w-9 h-9 rounded-full bg-surface-hover text-secondary text-2xs font-medium flex items-center justify-center">
                        {(c.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                      </span>
                    }
                    title={c.full_name}
                    sub={`${c.email}${c.position_title ? ` · ${c.position_title}` : ''}`}
                    trailing={<>
                    <span className="hidden sm:block text-2xs text-tertiary tabular-nums">{fmtDate(c.applied_at)}</span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-2xs font-medium ring-1 ${st.cls}`}>{st.label}</span>
                    </>}
                  />
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
    </>
  );
}
