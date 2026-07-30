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

// Status → chip style + label, shared by the Home + HR Overview recent lists.
//
// THREE tones, not nine. Each status used to carry its own literal palette
// colour (bg-blue-50, amber, violet, indigo, orange, emerald, rose, teal), which
// broke twice: those are raw Tailwind palette values, so in dark mode a chip
// rendered as a near-white blob with dark text; and nine hues for what is really
// one ordered pipeline meant the eye read nine unrelated categories.
//
// Only three distinctions actually carry meaning to someone scanning a list:
// this one ended well, this one ended badly, this one is still in progress.
// Everything mid-pipeline is neutral — the LABEL says which stage it is.
const IN_PROGRESS = 'bg-surface-hover text-secondary ring-subtle';
const GOOD = 'bg-success/10 text-success ring-success/20';
const BAD = 'bg-danger/10 text-danger ring-danger/20';

export const HR_STATUS: Record<string, { label: string; cls: string }> = {
  applied: { label: 'Applied', cls: IN_PROGRESS },
  screening: { label: 'Screening', cls: IN_PROGRESS },
  assessment_sent: { label: 'Assessment', cls: IN_PROGRESS },
  assessment_completed: { label: 'Assessed', cls: IN_PROGRESS },
  interview_scheduled: { label: 'Interview', cls: IN_PROGRESS },
  interviewed: { label: 'Interviewed', cls: IN_PROGRESS },
  offered: { label: 'Offered', cls: GOOD },
  rejected: { label: 'Rejected', cls: BAD },
  hired: { label: 'Hired', cls: GOOD },
};
export const hrStatus = (s: string) => HR_STATUS[s] || { label: s?.replace(/_/g, ' ') || '—', cls: IN_PROGRESS };

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
