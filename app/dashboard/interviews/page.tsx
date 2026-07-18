'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { Calendar, Clock, Briefcase, Video, ChevronRight, Loader2, Plus } from 'lucide-react';
import Paywall from '@/components/Paywall';
import PageHeader from '@/components/dashboard/PageHeader';

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
        return <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 text-tertiary animate-spin" /></div>;
    }

    return (
        <>
            <PageHeader title="Interviews">
                <button className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-semibold text-white bg-accent hover:bg-accent/90 shadow-sm transition-colors">
                    <Plus className="w-3.5 h-3.5" /> Schedule
                </button>
            </PageHeader>

            <div className="p-6">
                <div className="max-w-3xl mx-auto">
                    <Paywall isLocked={company?.plan === 'free'} featureName="Interview Management">
                        <div className="mb-5">
                            <h2 className="text-lg font-semibold text-primary tracking-tight">Upcoming interviews</h2>
                            <p className="text-[13px] text-secondary">Track and manage your upcoming candidate evaluations.</p>
                        </div>

                        <div className="space-y-3">
                            {dummyInterviews.map((iv) => (
                                <div key={iv.id} className="group flex items-center gap-4 rounded-xl bg-surface ring-1 ring-subtle p-4 hover:ring-strong hover:shadow-sm transition-all cursor-pointer">
                                    <div className="w-14 h-14 rounded-xl bg-surface-sunken ring-1 ring-subtle flex flex-col items-center justify-center text-accent shrink-0 group-hover:bg-accent/10 transition-colors">
                                        <Calendar className="w-5 h-5" />
                                        <span className="text-[9px] font-semibold uppercase tracking-tight mt-0.5">Oct 24</span>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <h3 className="text-sm font-semibold text-primary truncate group-hover:text-accent transition-colors">{iv.candidate}</h3>
                                        <div className="flex items-center gap-3 mt-0.5 text-[12px] text-secondary">
                                            <span className="inline-flex items-center gap-1"><Briefcase className="w-3.5 h-3.5 text-tertiary" /> {iv.role}</span>
                                            <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-tertiary" /> {iv.time}</span>
                                        </div>
                                    </div>
                                    <div className="hidden sm:flex flex-col items-end gap-1 shrink-0">
                                        <span className="text-[10px] font-semibold uppercase tracking-widest text-accent bg-accent/10 px-2 py-0.5 rounded-md ring-1 ring-accent/30">{iv.type}</span>
                                        <span className="text-[10px] text-tertiary inline-flex items-center gap-1"><Video className="w-3 h-3" /> Google Meet</span>
                                    </div>
                                    <ChevronRight className="w-5 h-5 text-tertiary group-hover:text-secondary transition-colors shrink-0" />
                                </div>
                            ))}
                        </div>

                        <div className="mt-6 rounded-xl ring-1 ring-dashed ring-strong p-10 text-center">
                            <Calendar className="w-10 h-10 text-tertiary mx-auto mb-3" />
                            <h3 className="text-sm font-semibold text-secondary">No more interviews today</h3>
                            <p className="text-[12px] text-tertiary mt-1 max-w-xs mx-auto">Your schedule is clear — a good time to review some assessments.</p>
                        </div>
                    </Paywall>
                </div>
            </div>
        </>
    );
}
