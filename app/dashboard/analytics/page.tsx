'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import {
    BarChart, TrendingUp, Users, Calendar, ArrowLeft,
    PieChart, Loader2, Download, Clock, CheckCircle, Briefcase
} from 'lucide-react';
import Link from 'next/link';
import Paywall from '@/components/Paywall';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend,
    PointElement,
    LineElement,
    ArcElement,
} from 'chart.js';
import { Bar, Pie } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    PointElement,
    LineElement,
    ArcElement,
    Title,
    Tooltip,
    Legend
);

export default function AnalyticsPage() {
    const router = useRouter();
    const { ready, authenticated, user } = usePrivy();
    const [loading, setLoading] = useState(true);
    const [company, setCompany] = useState<any>(null);
    const [metrics, setMetrics] = useState<any>({
        totalPositions: 0,
        totalCandidates: 0,
        hiredCandidates: 0,
        offerRate: 0,
        sources: {},
        positionsVolume: {}
    });

    const loadAnalytics = useCallback(async () => {
        try {
            await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: user?.id, is_local: false });
            const { data: companyUser } = await supabase
                .from('company_users')
                .select('company:companies(*)')
                .eq('privy_user_id', user?.id)
                .single();

            if (companyUser) {
                const comp: any = Array.isArray(companyUser.company) ? companyUser.company[0] : companyUser.company;
                if (!comp || !comp.id) return;
                
                setCompany(comp);

                // Fetch real data
                const { data: positions } = await supabase
                    .from('positions')
                    .select('id, title, status')
                    .eq('company_id', comp.id);

                const { data: candidates } = await supabase
                    .from('candidates')
                    .select('id, status, source, position_id')
                    .eq('company_id', comp.id);

                const totalPositions = positions?.length || 0;
                const totalCandidates = candidates?.length || 0;
                const hiredCount = candidates?.filter(c => c.status === 'hired').length || 0;
                const offerRate = totalCandidates > 0 ? Math.round((hiredCount / totalCandidates) * 100) : 0;

                const sources: any = {};
                candidates?.forEach(c => {
                    const src = c.source || 'direct';
                    sources[src] = (sources[src] || 0) + 1;
                });

                const positionsVolume: any = {};
                candidates?.forEach(c => {
                    const pos = positions?.find((p: any) => p.id === c.position_id);
                    if (pos) {
                        positionsVolume[pos.title] = (positionsVolume[pos.title] || 0) + 1;
                    }
                });

                setMetrics({
                    totalPositions,
                    totalCandidates,
                    hiredCandidates: hiredCount,
                    offerRate,
                    sources,
                    positionsVolume
                });
            }
        } catch (error) {
            console.error('Error loading analytics:', error);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        if (ready) {
            if (!authenticated) {
                router.push('/auth/login');
            } else if (user) {
                loadAnalytics();
            }
        }
    }, [ready, authenticated, user, router, loadAnalytics]);

    const positionLabels = Object.keys(metrics.positionsVolume);
    const positionData = Object.values(metrics.positionsVolume);
    const hasPositionData = positionLabels.length > 0;

    const barData = {
        labels: hasPositionData ? positionLabels : ['No Data'],
        datasets: [
            {
                label: 'Total Applications',
                data: hasPositionData ? positionData : [0],
                backgroundColor: 'rgba(79, 70, 229, 0.8)',
                borderRadius: 8,
            },
        ],
    };

    const sourceLabels = Object.keys(metrics.sources);
    const sourceData = Object.values(metrics.sources);
    const hasSourceData = sourceLabels.length > 0;

    const pieData = {
        labels: hasSourceData ? sourceLabels.map(l => l.toUpperCase()) : ['No Data'],
        datasets: [
            {
                data: hasSourceData ? sourceData : [100],
                backgroundColor: [
                    'rgba(79, 70, 229, 0.8)',
                    'rgba(147, 51, 234, 0.8)',
                    'rgba(59, 130, 246, 0.8)',
                    'rgba(16, 185, 129, 0.8)',
                    'rgba(245, 158, 11, 0.8)',
                ],
                borderWidth: 0,
            },
        ],
    };

    if (!ready || loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-primary-600 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 pb-12">
            <header className="bg-white border-b px-6 py-4 flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center gap-4">
                    <Link href="/dashboard" className="p-2 hover:bg-gray-100 rounded-full transition">
                        <ArrowLeft className="w-5 h-5 text-gray-600" />
                    </Link>
                    <h1 className="text-xl font-bold text-gray-800">Recruitment Analytics</h1>
                </div>
                <button className="btn-secondary flex items-center gap-2 py-2 px-4 text-sm">
                    <Download className="w-4 h-4" />
                    Export Report
                </button>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8">
                <Paywall isLocked={company?.plan === 'free'} featureName="Advanced Analytics">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
                        {[
                            { label: 'Total Candidates', value: metrics.totalCandidates, pct: 'Live', icon: Users, color: 'text-purple-600', bg: 'bg-purple-50' },
                            { label: 'Total Hires', value: metrics.hiredCandidates, pct: 'Live', icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50' },
                            { label: 'Overall Hire Rate', value: `${metrics.offerRate}%`, pct: 'Live', icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-50' },
                            { label: 'Active Positions', value: metrics.totalPositions, pct: 'Live', icon: Briefcase, color: 'text-orange-600', bg: 'bg-orange-50' },
                        ].map((stat) => (
                            <div key={stat.label} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                                <div className="flex items-center justify-between mb-4">
                                    <div className={`p-3 rounded-xl ${stat.bg}`}>
                                        <stat.icon className={`w-6 h-6 ${stat.color}`} />
                                    </div>
                                    <span className="text-xs font-bold text-green-600">
                                        {stat.pct}
                                    </span>
                                </div>
                                <div className="text-2xl font-bold text-gray-800">{stat.value}</div>
                                <div className="text-sm text-gray-500 mt-1">{stat.label}</div>
                            </div>
                        ))}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
                            <div className="flex items-center justify-between mb-8">
                                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                    <BarChart className="w-5 h-5 text-primary-600" />
                                    Application Volume by Position
                                </h3>
                                <div className="bg-gray-100 text-xs px-2 py-1 rounded text-gray-600 font-bold">ALL TIME</div>
                            </div>
                            <div className="h-[300px]">
                                <Bar options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} data={barData} />
                            </div>
                        </div>

                        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
                            <h3 className="text-lg font-bold text-gray-800 mb-8 flex items-center gap-2">
                                <PieChart className="w-5 h-5 text-primary-600" />
                                Candidate Sources
                            </h3>
                            <div className="h-[250px] relative">
                                <Pie options={{ responsive: true, maintainAspectRatio: false }} data={pieData} />
                            </div>
                            <div className="mt-8 space-y-3">
                                {pieData.labels.map((label: string, i: number) => (
                                    <div key={label} className="flex items-center justify-between text-sm">
                                        <div className="flex items-center gap-2 text-gray-600">
                                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: pieData.datasets[0].backgroundColor[i % 5] }} />
                                            {label}
                                        </div>
                                        <span className="font-bold text-gray-800">
                                            {hasSourceData ? sourceData[i] as number : 0}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </Paywall>
            </main>
        </div>
    );
}
