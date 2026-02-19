'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { usePrivy } from '@privy-io/react-auth';
import { Users, Briefcase, CheckCircle, Calendar, TrendingUp, Clock, Loader2 } from 'lucide-react';
import Logo from '@/components/Logo';
import Link from 'next/link';

interface DashboardStats {
  totalCandidates: number;
  activePositions: number;
  assessmentsCompleted: number;
  upcomingInterviews: number;
  newApplications: number;
  pendingReview: number;
}

interface RecentCandidate {
  id: string;
  full_name: string;
  email: string;
  status: string;
  applied_at: string;
  position: {
    title: string;
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const { ready, authenticated, user, logout } = usePrivy();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    totalCandidates: 0,
    activePositions: 0,
    assessmentsCompleted: 0,
    upcomingInterviews: 0,
    newApplications: 0,
    pendingReview: 0,
  });
  const [recentCandidates, setRecentCandidates] = useState<RecentCandidate[]>([]);
  const [company, setCompany] = useState<any>(null);


  const loadDashboardData = async (privyUserId: string) => {
    try {
      // Set the session variable for RLS
      await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });

      // Get company user info
      const { data: companyUser, error: companyError } = await supabase
        .from('company_users')
        .select('*, company:companies(*)')
        .eq('privy_user_id', privyUserId)
        .maybeSingle();

      if (companyError) throw companyError;

      if (!companyUser) {
        router.push('/auth/register');
        return;
      }

      setCompany(companyUser.company);

      // Get stats
      const { count: totalCandidates } = await supabase
        .from('candidates')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyUser.company_id);

      const { count: activePositions } = await supabase
        .from('positions')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyUser.company_id)
        .eq('is_active', true);

      const { count: assessmentsCompleted } = await supabase
        .from('assessment_responses')
        .select('candidate:candidates!inner(*)', { count: 'exact', head: true })
        .eq('is_completed', true)
        .eq('candidate.company_id', companyUser.company_id);

      const { count: upcomingInterviews } = await supabase
        .from('interviews')
        .select('candidate:candidates!inner(*)', { count: 'exact', head: true })
        .eq('status', 'scheduled')
        .eq('candidate.company_id', companyUser.company_id)
        .gte('scheduled_at', new Date().toISOString());

      const { count: newApplications } = await supabase
        .from('candidates')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyUser.company_id)
        .eq('status', 'applied')
        .gte('applied_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

      const { count: pendingReview } = await supabase
        .from('candidates')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyUser.company_id)
        .in('status', ['applied', 'screening']);

      setStats({
        totalCandidates: totalCandidates || 0,
        activePositions: activePositions || 0,
        assessmentsCompleted: assessmentsCompleted || 0,
        upcomingInterviews: upcomingInterviews || 0,
        newApplications: newApplications || 0,
        pendingReview: pendingReview || 0,
      });

      // Get recent candidates
      const { data: candidates } = await supabase
        .from('candidates')
        .select('id, full_name, email, status, applied_at, position:positions(title)')
        .eq('company_id', companyUser.company_id)
        .order('applied_at', { ascending: false })
        .limit(5);

      setRecentCandidates((candidates || []).map((c: any) => ({
        ...c,
        position: Array.isArray(c.position) ? c.position[0] : c.position
      })));
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ready) {
      if (!authenticated) {
        router.push('/auth/login');
      } else if (user) {
        loadDashboardData(user.id);
      }
    }
  }, [ready, authenticated, user, router]);

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { bg: string; text: string; label: string }> = {
      applied: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Applied' },
      screening: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Screening' },
      assessment_sent: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Assessment Sent' },
      assessment_completed: { bg: 'bg-indigo-100', text: 'text-indigo-800', label: 'Assessed' },
      interview_scheduled: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Interview Scheduled' },
      interviewed: { bg: 'bg-green-100', text: 'text-green-800', label: 'Interviewed' },
      offered: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Offered' },
      rejected: { bg: 'bg-red-100', text: 'text-red-800', label: 'Rejected' },
      hired: { bg: 'bg-teal-100', text: 'text-teal-800', label: 'Hired' },
    };

    const config = statusMap[status] || statusMap.applied;
    return (
      <span className={`badge ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };

  if (!ready || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading hirebtr.com...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div>
              <div className="flex items-center gap-4">
                <Link href="/dashboard">
                  <Logo />
                </Link>
                <div className="h-8 w-px bg-gray-200" />
                <h1 className="text-2xl font-bold text-gray-800 tracking-tight">Recruiter Dashboard</h1>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-gray-600">{company?.name}</p>
                <span className="px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 text-[10px] font-bold uppercase tracking-wider border border-primary-200">
                  {company?.plan || 'Free'} Plan
                </span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/dashboard/positions/new" className="btn-primary">
                Create Position
              </Link>
              <button
                onClick={async () => {
                  await logout();
                  router.push('/auth/login');
                }}
                className="btn-secondary"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Quick Stats */}
        <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm">Total Candidates</span>
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <div className="text-3xl font-bold text-gray-800">{stats.totalCandidates}</div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm">Active Positions</span>
              <Briefcase className="w-5 h-5 text-purple-600" />
            </div>
            <div className="text-3xl font-bold text-gray-800">{stats.activePositions}</div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm">Assessed</span>
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div className="text-3xl font-bold text-gray-800">{stats.assessmentsCompleted}</div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm">Interviews</span>
              <Calendar className="w-5 h-5 text-orange-600" />
            </div>
            <div className="text-3xl font-bold text-gray-800">{stats.upcomingInterviews}</div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm">New (7d)</span>
              <TrendingUp className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="text-3xl font-bold text-gray-800">{stats.newApplications}</div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm">Pending</span>
              <Clock className="w-5 h-5 text-yellow-600" />
            </div>
            <div className="text-3xl font-bold text-gray-800">{stats.pendingReview}</div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid md:grid-cols-4 gap-4 mb-8">
          <Link href="/dashboard/candidates" className="card hover:shadow-lg transition cursor-pointer">
            <Users className="w-8 h-8 text-primary-600 mb-3" />
            <h3 className="font-semibold text-gray-800 mb-1">View Candidates</h3>
            <p className="text-sm text-gray-600">Manage all applications</p>
          </Link>

          <Link href="/dashboard/positions" className="card hover:shadow-lg transition cursor-pointer">
            <Briefcase className="w-8 h-8 text-primary-600 mb-3" />
            <h3 className="font-semibold text-gray-800 mb-1">Job Positions</h3>
            <p className="text-sm text-gray-600">Create and manage roles</p>
          </Link>

          <Link href="/dashboard/interviews" className="card hover:shadow-lg transition cursor-pointer">
            <Calendar className="w-8 h-8 text-primary-600 mb-3" />
            <h3 className="font-semibold text-gray-800 mb-1">Interviews</h3>
            <p className="text-sm text-gray-600">Schedule and track</p>
          </Link>

          <Link href="/dashboard/analytics" className="card hover:shadow-lg transition cursor-pointer">
            <TrendingUp className="w-8 h-8 text-primary-600 mb-3" />
            <h3 className="font-semibold text-gray-800 mb-1">Analytics</h3>
            <p className="text-sm text-gray-600">View insights</p>
          </Link>
        </div>

        {/* Recent Candidates */}
        <div className="card">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Recent Applications</h2>
          {recentCandidates.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600 mb-4">No candidates yet</p>
              <Link href="/dashboard/positions/new" className="btn-primary">
                Create Your First Position
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {recentCandidates.map((candidate) => (
                <Link
                  key={candidate.id}
                  href={`/dashboard/candidates/${candidate.id}`}
                  className="block p-4 border border-gray-200 rounded-lg hover:border-primary-300 hover:shadow-md transition"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-800">{candidate.full_name}</h3>
                      <p className="text-sm text-gray-600">{candidate.email}</p>
                      <p className="text-sm text-gray-500 mt-1">{candidate.position.title}</p>
                    </div>
                    <div className="text-right">
                      {getStatusBadge(candidate.status)}
                      <p className="text-xs text-gray-500 mt-2">
                        {new Date(candidate.applied_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
