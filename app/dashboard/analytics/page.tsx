'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { rpc } from '@/lib/rpc';
import { useChartTokens } from '@/lib/chart-tokens';
import { BarChart, TrendingUp, Users, PieChart, Loader2, Download, CheckCircle2, Briefcase } from 'lucide-react';
import Paywall from '@/components/Paywall';
import PageHeader from '@/components/dashboard/PageHeader';
import StatCard from '@/components/ui/StatCard';
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
    const chart = useChartTokens();
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
            if (!user?.id) return;
            // Verified RPC — candidates/positions are no longer anon-readable.
            const { data, error } = await rpc('hr_analytics_data', { p_privy: user.id });
            if (error || !data) return;
            const comp: any = data.company;
            if (comp && comp.id) {
                setCompany(comp);

                const positions = data.positions as { id: string; title: string; status: string }[] | null;
                const candidates = data.candidates as { id: string; status: string; source: string; position_id: string }[] | null;

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
                backgroundColor: chart?.accent,
                borderRadius: 6,
            },
        ],
    };

    // Chart.js defaults its axes to a dark grey that disappears on the dark
    // canvas, so both axes are driven off the tokens too.
    const axisOptions = {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: { grid: { display: false }, ticks: { color: chart?.label } },
            y: { grid: { color: chart?.grid }, ticks: { color: chart?.label } },
        },
    };

    const sourceLabels = Object.keys(metrics.sources);
    const sourceData = Object.values(metrics.sources);
    const hasSourceData = sourceLabels.length > 0;

    const pieData = {
        labels: hasSourceData ? sourceLabels.map(l => l.toUpperCase()) : ['No Data'],
        datasets: [
            {
                data: hasSourceData ? sourceData : [100],
                // Sources are categorical, so these stay distinct hues rather
                // than shades of one token — but the lead slice is the accent
                // so the chart still belongs to the palette.
                backgroundColor: [
                    chart?.accent,
                    'rgba(147, 51, 234, 0.85)',
                    'rgba(59, 130, 246, 0.85)',
                    'rgba(16, 185, 129, 0.85)',
                    'rgba(245, 158, 11, 0.85)',
                ],
                borderWidth: 0,
            },
        ],
    };

    if (!ready || loading) {
        return <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 text-tertiary animate-spin" /></div>;
    }

    const kpis = [
        { label: 'Total candidates', value: metrics.totalCandidates, icon: Users, tone: 'text-accent' },
        { label: 'Total hires', value: metrics.hiredCandidates, icon: CheckCircle2, tone: 'text-success' },
        { label: 'Hire rate', value: `${metrics.offerRate}%`, icon: TrendingUp, tone: 'text-accent' },
        { label: 'Active positions', value: metrics.totalPositions, icon: Briefcase, tone: 'text-warning' },
    ];

    return (
        <>
            <PageHeader title="Analytics" badge={<span className="text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-success/10 text-success">Live</span>}>
                <button className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-sunken transition-colors">
                    <Download className="w-3.5 h-3.5" /> Export
                </button>
            </PageHeader>

            <div className="p-6">
                <div className="max-w-6xl">
                    <Paywall isLocked={company?.plan === 'free'} featureName="Advanced Analytics">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                            {kpis.map((k) => (
                                <StatCard key={k.label} label={k.label} value={k.value} icon={k.icon} tone={k.tone} />
                            ))}
                        </div>

                        <div className="grid lg:grid-cols-3 gap-4">
                            <div className="lg:col-span-2 rounded-xl bg-surface ring-1 ring-subtle p-5">
                                <div className="flex items-center justify-between mb-5">
                                    <h3 className="text-sm font-semibold text-primary flex items-center gap-2"><BarChart className="w-4 h-4 text-accent" /> Application volume by position</h3>
                                    <span className="text-[10px] font-semibold uppercase tracking-widest text-tertiary bg-surface-hover rounded px-1.5 py-0.5">All time</span>
                                </div>
                                <div className="h-[300px]">
                                    <Bar options={axisOptions} data={barData} />
                                </div>
                            </div>

                            <div className="rounded-xl bg-surface ring-1 ring-subtle p-5">
                                <h3 className="text-sm font-semibold text-primary mb-5 flex items-center gap-2"><PieChart className="w-4 h-4 text-accent" /> Candidate sources</h3>
                                <div className="h-[220px] relative">
                                    <Pie options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} data={pieData} />
                                </div>
                                <div className="mt-5 space-y-2">
                                    {pieData.labels.map((label: string, i: number) => (
                                        <div key={label} className="flex items-center justify-between text-[13px]">
                                            <div className="flex items-center gap-2 text-secondary">
                                                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: pieData.datasets[0].backgroundColor[i % 5] }} />
                                                {label}
                                            </div>
                                            <span className="font-semibold text-primary tabular-nums">{hasSourceData ? (sourceData[i] as number) : 0}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </Paywall>
                </div>
            </div>
        </>
    );
}
