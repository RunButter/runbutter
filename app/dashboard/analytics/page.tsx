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
import { Bar, Pie, Line } from 'react-chartjs-2';

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


    const loadAnalytics = useCallback(async () => {
        try {
            await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: user?.id, is_local: false });
            const { data: companyUser } = await supabase
                .from('company_users')
                .select('company:companies(*)')
                .eq('privy_user_id', user?.id)
                .single();

            if (companyUser) setCompany(companyUser.company);
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

    const barData = {
        labels: ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'],
        datasets: [
            {
                label: 'Candidates',
                data: [45, 59, 80, 81, 56, 95],
                backgroundColor: 'rgba(79, 70, 229, 0.8)',
                borderRadius: 8,
            },
        ],
    };

    const pieData = {
        labels: ['Referral', 'LinkedIn', 'Indeed', 'Direct'],
        datasets: [
            {
                data: [35, 45, 10, 10],
                backgroundColor: [
                    'rgba(79, 70, 229, 0.8)',
                    'rgba(147, 51, 234, 0.8)',
                    'rgba(59, 130, 246, 0.8)',
                    'rgba(16, 185, 129, 0.8)',
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
                            { label: 'Time to Hire', value: '18 Days', pct: '+12%', icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50' },
                            { label: 'Offer Accept Rate', value: '82%', pct: '-3%', icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50' },
                            { label: 'Interview Ratio', value: '1:5', pct: '+5%', icon: Users, color: 'text-purple-600', bg: 'bg-purple-50' },
                            { label: 'Total Positions', value: '12', pct: '0%', icon: Briefcase, color: 'text-orange-600', bg: 'bg-orange-50' },
                        ].map((stat) => (
                            <div key={stat.label} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                                <div className="flex items-center justify-between mb-4">
                                    <div className={`p-3 rounded-xl ${stat.bg}`}>
                                        <stat.icon className={`w-6 h-6 ${stat.color}`} />
                                    </div>
                                    <span className={`text-xs font-bold ${stat.pct.startsWith('+') ? 'text-green-600' : 'text-red-500'}`}>
                                        {stat.pct} vs last mo
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
                                    <TrendingUp className="w-5 h-5 text-primary-600" />
                                    Application Volume
                                </h3>
                                <select className="bg-gray-50 border border-gray-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500">
                                    <option>Last 6 Months</option>
                                    <option>Last Year</option>
                                </select>
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
                                {pieData.labels.map((label, i) => (
                                    <div key={label} className="flex items-center justify-between text-sm">
                                        <div className="flex items-center gap-2 text-gray-600">
                                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: pieData.datasets[0].backgroundColor[i] }} />
                                            {label}
                                        </div>
                                        <span className="font-bold text-gray-800">{pieData.datasets[0].data[i]}%</span>
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
