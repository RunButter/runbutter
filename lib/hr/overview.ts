// HR overview data — stats, hiring funnel, and recent applications for the
// recruitment (ATS) module. Reads the legacy ATS tables (candidates/positions/
// interviews), which are company-scoped via company_users.privy_user_id + the
// app.current_privy_user_id RLS session var. Falls back to sample data when the
// user isn't signed in or has no company, so the surface always renders.
import { rpc } from '@/lib/rpc';

export interface HrStats {
  totalCandidates: number; activePositions: number; assessmentsCompleted: number;
  upcomingInterviews: number; newApplications: number; pendingReview: number; hired: number;
}
export interface HrFunnelStage { key: string; label: string; count: number }
export interface HrCandidate { id: string; full_name: string; email: string; status: string; applied_at: string | null; position_title: string | null }
export interface HrOverview {
  company: { name: string; plan: string } | null;
  stats: HrStats; funnel: HrFunnelStage[]; recent: HrCandidate[]; live: boolean;
}

// Ordered hiring funnel — maps the many candidate statuses onto 6 clean stages.
const FUNNEL: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: 'applied', label: 'Applied', match: (s) => s === 'applied' },
  { key: 'screening', label: 'Screening', match: (s) => s === 'screening' },
  { key: 'assessment', label: 'Assessment', match: (s) => s === 'assessment_sent' || s === 'assessment_completed' },
  { key: 'interview', label: 'Interview', match: (s) => s === 'interview_scheduled' || s === 'interviewed' },
  { key: 'offered', label: 'Offer', match: (s) => s === 'offered' },
  { key: 'hired', label: 'Hired', match: (s) => s === 'hired' },
];

// Status → pill style + label, shared by the Home + HR Overview recent lists.
export const HR_STATUS: Record<string, { label: string; cls: string }> = {
  applied: { label: 'Applied', cls: 'bg-blue-50 text-blue-700 ring-blue-200/60' },
  screening: { label: 'Screening', cls: 'bg-amber-50 text-amber-700 ring-amber-200/60' },
  assessment_sent: { label: 'Assessment', cls: 'bg-violet-50 text-violet-700 ring-violet-200/60' },
  assessment_completed: { label: 'Assessed', cls: 'bg-indigo-50 text-indigo-700 ring-indigo-200/60' },
  interview_scheduled: { label: 'Interview', cls: 'bg-orange-50 text-orange-700 ring-orange-200/60' },
  interviewed: { label: 'Interviewed', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60' },
  offered: { label: 'Offered', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60' },
  rejected: { label: 'Rejected', cls: 'bg-rose-50 text-rose-700 ring-rose-200/60' },
  hired: { label: 'Hired', cls: 'bg-teal-50 text-teal-700 ring-teal-200/60' },
};
export const hrStatus = (s: string) => HR_STATUS[s] || { label: s?.replace(/_/g, ' ') || '—', cls: 'bg-slate-50 text-slate-600 ring-slate-200/60' };

function mockOverview(): HrOverview {
  const funnel = [
    { key: 'applied', label: 'Applied', count: 42 },
    { key: 'screening', label: 'Screening', count: 28 },
    { key: 'assessment', label: 'Assessment', count: 19 },
    { key: 'interview', label: 'Interview', count: 11 },
    { key: 'offered', label: 'Offer', count: 4 },
    { key: 'hired', label: 'Hired', count: 3 },
  ];
  const recent: HrCandidate[] = [
    { id: 'c1', full_name: 'Anna Kowalski', email: 'anna.k@northwind.io', status: 'interview_scheduled', applied_at: '2026-07-02', position_title: 'Senior Engineer' },
    { id: 'c2', full_name: 'Marcus Obi', email: 'marcus@vertex.co', status: 'assessment_completed', applied_at: '2026-07-01', position_title: 'Data Scientist' },
    { id: 'c3', full_name: 'Sara Lindqvist', email: 'sara.l@pulse.app', status: 'screening', applied_at: '2026-06-30', position_title: 'Product Designer' },
    { id: 'c4', full_name: 'David Reyes', email: 'david@lumen.dev', status: 'offered', applied_at: '2026-06-28', position_title: 'Sales Lead' },
    { id: 'c5', full_name: 'Lena Fischer', email: 'lena@cobalt.io', status: 'applied', applied_at: '2026-06-27', position_title: 'Account Exec' },
  ];
  return {
    company: { name: 'Acme Inc.', plan: 'starter' },
    stats: { totalCandidates: 107, activePositions: 6, assessmentsCompleted: 34, upcomingInterviews: 5, newApplications: 12, pendingReview: 23, hired: 3 },
    funnel, recent, live: false,
  };
}

export async function loadHrOverview(privyUserId: string | null): Promise<HrOverview> {
  if (!privyUserId) return mockOverview();
  try {
    // One verified RPC (hr_overview_data) replaces the direct table reads —
    // the crown-jewel tables are no longer reachable with the anon key.
    const { data, error } = await rpc('hr_overview_data', { p_privy: privyUserId });
    if (error || !data) return mockOverview();
    const company: any = data.company;

    const rows = (data.status_rows || []) as { status: string; applied_at: string | null }[];
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const funnel = FUNNEL.map((f) => ({ key: f.key, label: f.label, count: rows.filter((r) => f.match(r.status)).length }));
    const stats: HrStats = {
      totalCandidates: rows.length,
      activePositions: data.active_positions || 0,
      assessmentsCompleted: data.assessments_completed || 0,
      upcomingInterviews: data.upcoming_interviews || 0,
      newApplications: rows.filter((r) => r.applied_at && new Date(r.applied_at).getTime() >= weekAgo).length,
      pendingReview: rows.filter((r) => r.status === 'applied' || r.status === 'screening').length,
      hired: rows.filter((r) => r.status === 'hired').length,
    };
    const recent: HrCandidate[] = (data.recent || []).map((c: any) => ({
      id: c.id, full_name: c.full_name, email: c.email, status: c.status, applied_at: c.applied_at,
      position_title: c.position_title ?? null,
    }));

    return { company: company ? { name: company.name, plan: company.plan } : null, stats, funnel, recent, live: true };
  } catch {
    return mockOverview();
  }
}
