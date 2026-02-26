'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import {
    Calendar, Clock, User, Briefcase, Video,
    ChevronRight, Loader2, ArrowLeft, Plus
} from 'lucide-react';
import Link from 'next/link';
import Paywall from '@/components/Paywall';

export default function InterviewsPage() {
    const router = useRouter();
    const { ready, authenticated, user } = usePrivy();
    const [loading, setLoading] = useState(true);
    const [company, setCompany] = useState<any>(null);

    const loadData = useCallback(async () => {
        try {
            await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: user?.id, is_local: false });
            const { data: companyUser } = await supabase
                .from('company_users')
                .select('company:companies(*)')
                .eq('privy_user_id', user?.id)
                .single();

            if (companyUser) setCompany(companyUser.company);
        } catch (error) {
            console.error('Error loading interviews data:', error);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        if (ready) {
            if (!authenticated) {
                router.push('/auth/login');
            } else if (user) {
                loadData();
            }
        }
    }, [ready, authenticated, user, router, loadData]);

    const dummyInterviews = [
        { id: 1, candidate: 'Sarah Jenkins', role: 'Senior React Developer', time: '10:00 AM', date: 'Oct 24, 2024', type: 'Technical Screening' },
        { id: 2, candidate: 'Michael Chen', role: 'Product Designer', time: '2:30 PM', date: 'Oct 24, 2024', type: 'Portfolio Review' },
        { id: 3, candidate: 'Elena Rodriguez', role: 'DevOps Engineer', time: '11:15 AM', date: 'Oct 25, 2024', type: 'Culture Fit' },
    ];

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
                    <h1 className="text-xl font-bold text-gray-800">Interview Scheduler</h1>
                </div>
                <button className="btn-primary flex items-center gap-2 py-2 px-4 shadow-sm">
                    <Plus className="w-4 h-4" />
                    Schedule Interview
                </button>
            </header>

            <main className="max-w-4xl mx-auto px-6 py-12">
                <Paywall isLocked={company?.plan === 'free'} featureName="Interview Management">
                    <div className="mb-10 text-center">
                        <h2 className="text-2xl font-bold text-gray-800 mb-2">Upcoming Interviews</h2>
                        <p className="text-gray-500">Track and manage your upcoming candidate evaluations</p>
                    </div>

                    <div className="space-y-4">
                        {dummyInterviews.map((interview) => (
                            <div key={interview.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:border-primary-200 transition group cursor-pointer">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-6">
                                        <div className="w-16 h-16 bg-gray-50 rounded-2xl flex flex-col items-center justify-center text-primary-600 border border-gray-100 group-hover:bg-primary-50 transition">
                                            <Calendar className="w-6 h-6 mb-1" />
                                            <span className="text-[10px] font-bold uppercase tracking-tighter">OCT 24</span>
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-gray-800 group-hover:text-primary-700 transition">{interview.candidate}</h3>
                                            <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                                                <span className="flex items-center gap-1.5 font-medium">
                                                    <Briefcase className="w-4 h-4 text-gray-400" />
                                                    {interview.role}
                                                </span>
                                                <span className="flex items-center gap-1.5 font-medium">
                                                    <Clock className="w-4 h-4 text-gray-400" />
                                                    {interview.time}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-right hidden sm:block">
                                            <div className="text-xs font-bold text-primary-600 uppercase tracking-widest bg-primary-50 px-3 py-1 rounded-full border border-primary-100">
                                                {interview.type}
                                            </div>
                                            <div className="text-[10px] text-gray-400 mt-2 font-bold flex items-center justify-end gap-1">
                                                <Video className="w-3 h-3" />
                                                Google Meet Link Attached
                                            </div>
                                        </div>
                                        <ChevronRight className="w-6 h-6 text-gray-300 group-hover:text-primary-400 transition" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-12 text-center p-12 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
                        <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-gray-800 mb-2 font-display uppercase tracking-tight">No more interviews today</h3>
                        <p className="text-sm text-gray-500 max-w-xs mx-auto">Your schedule is looking clear. Great time to review some assessments!</p>
                    </div>
                </Paywall>
            </main>
        </div>
    );
}
