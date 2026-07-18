'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import {
    User, Mail, Phone, Linkedin, Calendar, Briefcase,
    FileText, CheckCircle, Clock, AlertCircle, Loader2, ArrowLeft,
    Send, ChevronRight, Brain, Target, BarChart, TrendingUp, Users
} from 'lucide-react';
import Link from 'next/link';
import {
    Chart as ChartJS,
    RadialLinearScale,
    PointElement,
    LineElement,
    Filler,
    Tooltip,
    Legend,
} from 'chart.js';
import { Radar } from 'react-chartjs-2';
import TeamFitModal from './TeamFitModal';
import CandidateMessageModal from './CandidateMessageModal';
import { rpc } from '@/lib/rpc';
import { useDialog } from '@/components/ui/Dialog';

ChartJS.register(
    RadialLinearScale,
    PointElement,
    LineElement,
    Filler,
    Tooltip,
    Legend
);

export default function CandidateDetailPage({ params }: { params: { id: string } }) {
  const { notify } = useDialog();
    const router = useRouter();
    const { ready, authenticated, user } = usePrivy();
    const [loading, setLoading] = useState(true);
    const [candidate, setCandidate] = useState<any>(null);
    const [activity, setActivity] = useState<any[]>([]);
    const [results, setResults] = useState<any>(null);
    const [debugInfo, setDebugInfo] = useState<any>(null);
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [scheduleTime, setScheduleTime] = useState('');
    const [isScheduling, setIsScheduling] = useState(false);
    const [companyPlan, setCompanyPlan] = useState('free');

    // Team Fit + Messaging
    const [showFitModal, setShowFitModal] = useState(false);
    const [treasury, setTreasury] = useState<any[] | null>(null);
    const [loadingFit, setLoadingFit] = useState(false);
    const [showMessageModal, setShowMessageModal] = useState(false);

    const openFitSimulator = async () => {
        setShowFitModal(true);
        if (treasury || !user) return;
        setLoadingFit(true);
        try {
            const { data } = await rpc('get_treasury_dataset', { p_privy_user_id: user.id });
            setTreasury(data || []);
        } catch (e) {
            console.error('Error loading team profiles:', e);
            setTreasury([]);
        } finally {
            setLoadingFit(false);
        }
    };

    const loadCandidateData = useCallback(async () => {
        try {
            if (!params.id) {
                console.error('Missing candidate ID in URL params');
                return;
            }

            if (!user?.id) {
                console.warn('loadCandidateData called without valid privyUser.id');
                return;
            }

            // Ensure session is initialized for any RLS secondary queries
            await supabase.auth.getUser();

            const { data, error } = await rpc('get_candidate_details', {
                p_candidate_id: params.id,
                p_privy_user_id: user.id
            });

            if (error) {
                setDebugInfo((prev: any) => ({ ...prev, rpcError: error }));
                throw error;
            }

            if (!data) {
                setDebugInfo((prev: any) => ({ ...prev, rpcData: 'NULL' }));
                throw new Error('Candidate not found');
            }

            const can = data;
            setCandidate({
                ...can,
                position: {
                    title: can.position_title,
                    department: can.position_department,
                    neuro_profile: can.position_neuro_profile,
                    created_by: can.position_created_by
                }
            });

            // Fetch company plan
            const { data: comp } = await supabase.from('companies').select('plan').eq('id', can.company_id).single();
            setCompanyPlan(comp?.plan || 'free');

            // Activity log via verified RPC (activity_log is no longer anon-readable).
            const { data: acts } = await rpc('hr_candidate_activity', {
                p_privy: user.id, p_candidate_id: params.id,
            });
            setActivity(Array.isArray(acts) ? acts : []);

            if (can.assessment_results && can.assessment_results.length > 0) {
                setResults(can.assessment_results[0]);
            }
        } catch (error) {
            console.error('Error loading candidate data:', error);
        } finally {
            setLoading(false);
        }
    }, [user, params.id]);

    useEffect(() => {
        if (ready) {
            if (!authenticated) {
                router.push('/auth/login');
            } else if (user) {
                loadCandidateData();
            }
        }
    }, [ready, authenticated, user, router, loadCandidateData]);

    const generateDemoResults = async () => {
        setLoading(true);
        try {
            const demoResults = {
                candidate_id: params.id,
                overall_score: 87,
                cognitive_score: 92,
                personality_score: 85,
                work_style_score: 84,
                personality_data: {
                    extraversion: 65,
                    agreeableness: 72,
                    conscientiousness: 88,
                    neuroticism: 25,
                    openness: 82
                },
                work_style_data: {
                    collaboration: 75,
                    structure: 60,
                    strategic: 82,
                    innovation: 78
                },
                cognitive_data: {
                    logic: 90,
                    patterns: 88,
                    problem_solving: 94
                },
                screening_score: 100,
                screening_answers: [
                    { question: "How many years of React experience do you have?", answer: "3+ years", is_correct: true },
                    { question: "Have you worked with Supabase or PostgreSQL?", answer: "Yes, expert level", is_correct: true },
                    { question: "Tell us about your most complex project.", answer: "Built a multi-tenant SaaS for recruitment with AI integration and RLS security.", is_correct: null }
                ],
                summary: "This candidate shows strong leadership potential with a highly collaborative work style. They matched 100% on core technical screening questions. Their detailed open-ended response about multi-tenant SaaS architecture is particularly impressive."
            };

            if (!user?.id) return;
            const { data, error } = await rpc('hr_seed_demo_result', {
                p_privy: user.id, p_candidate_id: params.id, p_results: demoResults,
            });
            if (error || data === false) throw error || new Error('Seed rejected');
            loadCandidateData();
        } catch (error) {
            console.error('Error generating demo data:', error);
            notify('Failed to generate demo data');
        } finally {
            setLoading(false);
        }
    };

    const updateStatus = async (newStatus: string) => {
        try {
            if (!user?.id) return;
            // Verified RPC updates the row AND writes the audit entry atomically.
            const { data, error } = await rpc('hr_update_candidate_status', {
                p_privy: user.id, p_candidate_id: params.id, p_status: newStatus,
            });
            if (error || data === false) throw error || new Error('Update rejected');

            setCandidate({ ...candidate, status: newStatus });

            // Notify the candidate of their new status (fire-and-forget)
            fetch('/api/email/candidate-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ candidateId: params.id, status: newStatus, privyUserId: user?.id }),
            }).catch(console.error);

            loadCandidateData();
        } catch (error) {
            console.error('Error updating status:', error);
            notify('Failed to update status');
        }
    };

    const renderActivityDetails = (act: any) => {
        if (!act.details) return null;
        const d = act.details;

        try {
            switch (act.action) {
                case 'application_submitted':
                    return `Applied for ${d.position_title || 'this position'}${d.cv_uploaded ? ' (CV uploaded)' : ''}`;
                case 'assessment_completed':
                    return (
                        <div className="space-y-1">
                            <p className="font-semibold text-accent">Scored {d.overall_score}% Compatibility</p>
                            <p className="italic">&quot;{d.summary}&quot;</p>
                        </div>
                    );
                case 'status_updated':
                    return `Moved from ${d.old_status || 'applied'} to ${d.new_status}`;
                default:
                    return typeof d === 'object' ? JSON.stringify(d) : d;
            }
        } catch (e) {
            return typeof d === 'object' ? JSON.stringify(d) : d;
        }
    };

    const handleSchedule = async () => {
        if (!scheduleTime) return notify('Please select a date and time');

        setIsScheduling(true);
        try {
            const res = await fetch('/api/interviews/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidateId: params.id,
                    privyUserId: user?.id,
                    startTime: new Date(scheduleTime).toISOString(),
                    durationMinutes: 30
                })
            });
            const data = await res.json();

            if (!res.ok) {
                if (data.error === 'Scheduling requires a Pro plan') {
                    notify('Locked Feature: Please upgrade your account to Premium to schedule interviews automatically.');
                } else {
                    throw new Error(data.error || 'Failed to schedule interview. Ensure Google Calendar is integrated.');
                }
                return;
            }

            notify('Interview successfully scheduled via Google Calendar!');
            setShowScheduleModal(false);
            loadCandidateData();
        } catch (error: any) {
            console.error('Scheduling error:', error);
            notify(error.message);
        } finally {
            setIsScheduling(false);
        }
    };

    const neuroProfile = candidate?.position?.neuro_profile || 'hard-tech';
    const benchmarks: Record<string, number[]> = {
        'hard-tech': [85, 85, 40, 50, 30], // O, C, E, A, N
        'aggressive-sales': [50, 60, 90, 30, 40],
        'creative-chaos': [95, 40, 70, 60, 60],
        'operations-monk': [40, 95, 40, 60, 20]
    };
    const targetData = benchmarks[neuroProfile];

    const radarData = results ? {
        labels: ['Openness', 'Conscientiousness', 'Extraversion', 'Agreeableness', 'Neuroticism'],
        datasets: [
            {
                label: 'Candidate Profile',
                data: [
                    results.personality_data?.openness || 0,
                    results.personality_data?.conscientiousness || 0,
                    results.personality_data?.extraversion || 0,
                    results.personality_data?.agreeableness || 0,
                    results.personality_data?.neuroticism || 0,
                ],
                backgroundColor: 'rgba(79, 70, 229, 0.2)',
                borderColor: 'rgba(79, 70, 229, 1)',
                borderWidth: 2,
                pointRadius: 3,
                order: 1
            },
            {
                label: `${neuroProfile.toUpperCase()} Target`,
                data: targetData,
                backgroundColor: 'rgba(16, 185, 129, 0.05)',
                borderColor: 'rgba(16, 185, 129, 0.4)',
                borderWidth: 2,
                borderDash: [5, 5],
                pointRadius: 0,
                order: 2
            },
        ],
    } : null;

    const radarOptions = {
        scales: {
            r: {
                angleLines: { color: 'rgba(0,0,0,0.05)' },
                grid: { color: 'rgba(0,0,0,0.05)' },
                pointLabels: {
                    font: { size: 11, weight: 'bold' as any },
                    color: '#64748b'
                },
                suggestedMin: 0,
                suggestedMax: 100,
                ticks: { display: false }
            },
        },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                titleColor: '#1e293b',
                bodyColor: '#475569',
                borderColor: '#e2e8f0',
                borderWidth: 1,
                padding: 10,
                displayColors: false
            }
        },
        maintainAspectRatio: false
    };

    const WorkStyleBar = ({ label, left, right, value = 0 }: any) => (
        <div className="space-y-2">
            <div className="flex justify-between text-sm font-semibold text-secondary">
                <span>{label}</span>
                <span className="text-accent">{(value || 0)}% {(value || 0) > 50 ? right : left}</span>
            </div>
            <div className="h-3 bg-surface-hover rounded-full overflow-hidden border border-subtle">
                <div
                    className="h-full bg-primary-500 rounded-full transition-all duration-500"
                    style={{ width: `${value || 0}%` }}
                />
            </div>
            <div className="flex justify-between text-[10px] text-tertiary uppercase font-semibold tracking-tighter">
                <span>{left}</span>
                <span>{right}</span>
            </div>
        </div>
    );

    if (!ready || loading) {
        return (
            <div className="min-h-screen bg-surface-sunken flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-accent animate-spin" />
            </div>
        );
    }

    if (!candidate) {
        return (
            <div className="min-h-screen bg-surface-sunken flex items-center justify-center flex-col gap-6 p-6 text-center">
                <div className="flex flex-col items-center">
                    <AlertCircle className="w-16 h-16 text-danger mb-4" />
                    <h2 className="text-2xl font-semibold text-primary">Candidate not found</h2>
                    <p className="text-secondary mt-2 max-w-sm">We couldn&apos;t retrieve this candidate. They may have been deleted or you may not have permission to view them.</p>
                </div>

                <div className="flex gap-4">
                    <Link href="/dashboard/candidates" className="btn-secondary px-6">Back to List</Link>
                    <button onClick={() => window.location.reload()} className="btn-primary px-6">Retry</button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-surface-sunken pb-12">
            <header className="bg-surface border-b sticky top-0 z-10 transition-shadow hover:shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        <Link href="/dashboard/candidates" className="p-2 hover:bg-surface-hover rounded-full transition shrink-0">
                            <ArrowLeft className="w-5 h-5 text-secondary" />
                        </Link>
                        <div>
                            <h1 className="text-xl font-semibold text-primary">{candidate.full_name}</h1>
                            <p className="text-sm text-secondary">{candidate.position?.title} • {candidate.position?.department}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 w-full sm:w-auto sm:flex sm:items-center sm:gap-3">
                        <select
                            className="input-field py-2 text-sm border-subtle rounded-lg shadow-sm focus:ring-accent/30 focus:border-accent/30 col-span-2 sm:col-span-1 sm:w-auto"
                            value={candidate.status}
                            onChange={(e) => updateStatus(e.target.value)}
                        >
                            <option value="applied">Applied</option>
                            <option value="screening">Screening</option>
                            <option value="assessment_sent">Assessment Sent</option>
                            <option value="interview_scheduled">Interview Scheduled</option>
                            <option value="offered">Offered</option>
                            <option value="hired">Hired</option>
                            <option value="rejected">Rejected</option>
                        </select>
                        <button onClick={() => setShowMessageModal(true)} className="btn-secondary flex items-center justify-center gap-2 py-2 px-4 text-sm w-full sm:w-auto">
                            <Mail className="w-4 h-4" /> Message
                        </button>
                        <button
                            className={`flex items-center justify-center gap-2 py-2 px-4 shadow-sm text-sm rounded border w-full sm:w-auto ${companyPlan === 'free' ? 'bg-surface-hover text-secondary border-subtle cursor-not-allowed' : 'btn-primary'}`}
                            onClick={() => {
                                if (companyPlan === 'free') {
                                    notify('Automatic Interview Scheduling is a Premium feature. Upgrade your plan to use it!');
                                    return;
                                }
                                setShowScheduleModal(true);
                            }}
                        >
                            <Calendar className="w-4 h-4" />
                            {companyPlan === 'free' ? 'Schedule (Pro)' : 'Schedule Interview'}
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8 flex flex-col gap-8">
                {/* Assessment Report Hero Section (Only shows if results exist) */}
                {results ? (
                    <section className="bg-surface rounded-3xl shadow-popover border border-subtle overflow-hidden animate-in fade-in slide-in-from-bottom-6 duration-700">
                        <div className="bg-surface p-8 border-b border-subtle">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                                <div>
                                    <h2 className="text-2xl font-semibold text-primary flex items-center gap-3">
                                        Candidate Assessment Report
                                    </h2>
                                    <p className="mt-1 text-secondary font-medium flex items-center gap-2">
                                        {candidate.full_name} • {candidate.position?.title} • Completed: {new Date(results.completed_at).toLocaleDateString(undefined, { dateStyle: 'long' })}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button onClick={openFitSimulator} className="px-5 py-2.5 bg-accent text-white font-semibold rounded-xl hover:bg-accent/90 transition text-sm flex items-center gap-2 shadow-sm">
                                        <Users className="w-4 h-4" />
                                        Simulate Team Fit
                                    </button>
                                    <button className="px-5 py-2.5 bg-surface-sunken text-secondary font-semibold rounded-xl border border-subtle hover:bg-surface-hover transition text-sm">
                                        Switch to Candidate View
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="p-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            {[
                                { label: 'Overall Match', value: results.overall_score, color: 'bg-success/10 text-success border-success/30' },
                                { label: 'Cognitive Score', value: results.cognitive_score, color: 'bg-accent/10 text-accent border-accent/30' },
                                { label: 'Personality Fit', value: results.personality_score, color: 'bg-accent/10 text-accent border-accent/30' },
                                { label: 'Work Style', value: results.work_style_score, color: 'bg-orange-50 text-orange-600 border-orange-100' }
                            ].filter((stat) => stat.value != null).map((stat) => (
                                <div key={stat.label} className={`${stat.color} p-6 rounded-2xl border text-left`}>
                                    <div className="text-4xl font-semibold leading-none">{stat.value}</div>
                                    <div className="mt-2 text-xs font-semibold uppercase tracking-widest opacity-80">{stat.label}</div>
                                </div>
                            ))}
                        </div>

                        <div className="px-8 pb-12">
                            <div className="mb-12">
                                <h3 className="text-lg font-semibold text-primary mb-8">Big 5 Personality Traits</h3>
                                <div className="bg-surface-sunken/50 rounded-3xl p-12 flex items-center justify-center relative">
                                    <div className="h-[360px] w-full max-w-[500px]">
                                        {radarData && <Radar data={radarData} options={radarOptions} />}
                                    </div>
                                    <div className="absolute bottom-8 flex gap-6 text-[10px] font-semibold uppercase tracking-widest text-tertiary">
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full bg-primary-500 opacity-20 border border-accent/30" />
                                            Candidate Profile
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full border-2 border-dashed border-subtle" />
                                            Role Benchmark
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-12">
                                <div>
                                    <h3 className="text-lg font-semibold text-primary mb-8">Work Style Preferences</h3>
                                    <div className="space-y-6">
                                        <div className="grid grid-cols-2 gap-6">
                                            <WorkStyleBar label="Collaboration vs Independent" left="Individualist" right="Collaborative" value={results.work_style_data.collaboration} />
                                            <WorkStyleBar label="Structured vs Flexible" left="Highly Flexible" right="Highly Structured" value={results.work_style_data.structure} />
                                        </div>
                                        <div className="grid grid-cols-2 gap-6">
                                            <WorkStyleBar label="Strategic vs Tactical" left="Tactical Execution" right="Strategic Thinking" value={results.work_style_data.strategic} />
                                            <WorkStyleBar label="Innovation vs Optimization" left="System Optimizer" right="Creative Innovator" value={results.work_style_data.innovation} />
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-8">
                                    {results.cognitive_data && (
                                        <>
                                            <h3 className="text-lg font-semibold text-primary mb-8">Cognitive Assessment</h3>
                                            <div className="grid grid-cols-2 gap-4">
                                                {[
                                                    { label: 'Logical Reasoning', value: results.cognitive_data?.logic },
                                                    { label: 'Pattern Recognition', value: results.cognitive_data?.patterns },
                                                    { label: 'Problem Solving', value: results.cognitive_data?.problem_solving }
                                                ].filter((stat) => stat.value != null).map((stat) => (
                                                    <div key={stat.label} className="bg-surface-sunken p-6 rounded-2xl border border-subtle">
                                                        <div className="text-2xl font-semibold text-primary">{stat.value}</div>
                                                        <div className="text-[10px] font-semibold text-secondary uppercase tracking-widest mt-1">{stat.label}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                    <div className="p-6 bg-accent/10 rounded-2xl border border-accent/20">
                                        <div className="flex items-center justify-between mb-3">
                                            <h4 className="text-xs font-semibold text-accent uppercase tracking-widest flex items-center gap-2">
                                                <Target className="w-4 h-4" />
                                                Neuro-Profile Analysis
                                            </h4>
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-widest ${candidate?.position?.neuro_profile === 'hard-tech' ? 'bg-accent/10 text-accent' :
                                                candidate?.position?.neuro_profile === 'aggressive-sales' ? 'bg-orange-100 text-orange-700' :
                                                    candidate?.position?.neuro_profile === 'creative-chaos' ? 'bg-accent/10 text-accent' :
                                                        'bg-success/10 text-success'
                                                }`}>
                                                {candidate?.position?.neuro_profile?.replace('-', ' ') || 'HARD TECH'}
                                            </span>
                                        </div>
                                        <p className="text-sm text-secondary leading-relaxed font-medium italic">
                                            &quot;{results.summary || 'Analysis pending based on trait alignment.'}&quot;
                                        </p>
                                    </div>

                                    {results.screening_answers && results.screening_answers.length > 0 && (
                                        <div className="pt-8 border-t border-subtle">
                                            <h3 className="text-lg font-semibold text-primary mb-6 flex items-center gap-2">
                                                <Target className="w-5 h-5 text-accent" />
                                                Screening & Qualification
                                            </h3>
                                            <div className="space-y-4">
                                                {results.screening_answers.map((sa: any, idx: number) => (
                                                    <div key={idx} className="p-4 bg-surface-sunken rounded-xl border border-subtle">
                                                        <div className="text-xs font-semibold text-tertiary uppercase tracking-wider mb-2">Question {idx + 1}</div>
                                                        <p className="text-sm font-semibold text-primary mb-3">{sa.question}</p>
                                                        <div className="flex items-center justify-between">
                                                            <div className={`text-sm px-3 py-1 rounded-lg font-medium ${sa.is_correct === true ? 'bg-success/10 text-success border border-success/30' :
                                                                sa.is_correct === false ? 'bg-danger/10 text-danger border border-danger/30' :
                                                                    'bg-surface text-secondary border border-subtle'
                                                                }`}>
                                                                {sa.answer}
                                                            </div>
                                                            {sa.is_correct !== null && (
                                                                <span className="text-[10px] font-semibold uppercase tracking-widest text-tertiary">
                                                                    {sa.is_correct ? 'Correct Match' : 'Mismatch'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </section>
                ) : (
                    <div className="bg-surface rounded-3xl p-12 text-center border-2 border-dashed border-subtle flex flex-col items-center justify-center gap-6">
                        <div className="w-20 h-20 bg-surface-sunken rounded-full flex items-center justify-center text-tertiary">
                            <Brain className="w-10 h-10" />
                        </div>
                        <div>
                            <h3 className="text-xl font-semibold text-primary">No Assessment Results</h3>
                            <p className="text-sm text-secondary mt-1 max-w-sm mx-auto">This candidate hasn&apos;t completed their personality and work style test yet.</p>
                        </div>
                        <div className="flex gap-3">
                            <button onClick={generateDemoResults} className="btn-secondary py-2 px-6 flex items-center gap-2">
                                <TrendingUp className="w-4 h-4" />
                                Generate Sample Results
                            </button>
                            <button className="btn-primary py-2 px-6">
                                Send Reminder
                            </button>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left Column: Basic Info & Resume */}
                    <div className="lg:col-span-2 space-y-8">
                        {/* Profile Info */}
                        <div className="bg-surface rounded-xl shadow-sm border border-subtle p-8">
                            <h3 className="text-lg font-semibold text-primary mb-6 flex items-center gap-2">
                                <User className="w-5 h-5 text-accent" />
                                Contact Details
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3 text-secondary bg-surface-sunken p-3 rounded-lg border border-subtle">
                                        <Mail className="w-5 h-5 text-accent" />
                                        <span className="font-medium truncate">{candidate.email}</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-secondary bg-surface-sunken p-3 rounded-lg border border-subtle">
                                        <Phone className="w-5 h-5 text-accent" />
                                        <span className="font-medium">{candidate.phone || 'N/A'}</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-secondary bg-surface-sunken p-3 rounded-lg border border-subtle">
                                        <Linkedin className="w-5 h-5 text-[#0077b5]" />
                                        {candidate.linkedin_url ? (
                                            <a href={candidate.linkedin_url} target="_blank" className="text-accent hover:underline font-medium">
                                                View LinkedIn Profile
                                            </a>
                                        ) : (
                                            <span className="text-tertiary">Not provided</span>
                                        )}
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3 text-secondary">
                                        <Calendar className="w-5 h-5 text-tertiary" />
                                        <div>
                                            <div className="text-xs text-tertiary uppercase font-semibold tracking-wider">Applied</div>
                                            <div className="font-medium">{new Date(candidate.applied_at).toLocaleDateString()}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 text-secondary">
                                        <Briefcase className="w-5 h-5 text-tertiary" />
                                        <div>
                                            <div className="text-xs text-tertiary uppercase font-semibold tracking-wider">Source</div>
                                            <div className="font-medium capitalize">{candidate.source}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* CV Viewer */}
                        <div className="bg-surface rounded-3xl shadow-sm border border-subtle overflow-hidden">
                            <div className="p-6 border-b bg-surface-sunken flex items-center justify-between">
                                <h3 className="font-semibold text-primary flex items-center gap-2">
                                    <FileText className="w-5 h-5 text-accent" />
                                    Resume & Documents
                                </h3>
                                {candidate.cv_url && (
                                    <div className="flex gap-2">
                                        <a href={candidate.cv_url} target="_blank" className="btn-secondary py-1.5 px-4 text-xs font-semibold flex items-center gap-2">
                                            Open External <ChevronRight className="w-4 h-4" />
                                        </a>
                                    </div>
                                )}
                            </div>
                            <div className="bg-surface min-h-[600px] flex flex-col">
                                {candidate.cv_url ? (
                                    <div className="flex-1 flex flex-col">
                                        <div className="p-4 bg-surface-sunken/50 border-b flex justify-between items-center">
                                            <p className="text-xs font-semibold text-secondary uppercase tracking-widest">Interactive Preview</p>
                                            <span className="text-[10px] bg-success/10 text-success px-2 py-0.5 rounded-full font-semibold uppercase">Secure Viewer</span>
                                        </div>
                                        <iframe
                                            src={`${candidate.cv_url}#toolbar=0`}
                                            className="flex-1 w-full border-none min-h-[600px]"
                                            title="CV Preview"
                                        />
                                    </div>
                                ) : (
                                    <div className="p-24 text-center flex flex-col items-center justify-center gap-6">
                                        <div className="w-20 h-20 bg-surface-sunken rounded-full flex items-center justify-center text-tertiary">
                                            <AlertCircle className="w-10 h-10" />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-primary text-lg">No resume uploaded</p>
                                            <p className="text-secondary text-sm mt-1">This candidate applied without a CV attachment.</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Mini Stats & activity */}
                    <div className="space-y-8">
                        {/* Status Card */}
                        <div className="bg-surface rounded-xl shadow-sm border border-subtle p-6">
                            <h3 className="font-semibold text-primary mb-6 flex items-center gap-2">
                                <Target className="w-5 h-5 text-accent" />
                                Pipeline Status
                            </h3>
                            <div className="space-y-4">
                                {candidate.status === 'hired' ? (
                                    <div className="p-4 rounded-xl bg-success/10 border border-success/30 flex items-center gap-4">
                                        <div className="w-10 h-10 bg-success/10 rounded-full flex items-center justify-center">
                                            <CheckCircle className="w-6 h-6 text-success" />
                                        </div>
                                        <div>
                                            <div className="font-semibold text-success">Candidate Hired</div>
                                            <div className="text-xs text-success">Successfully matched with role</div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="p-4 rounded-xl bg-accent/10 border border-accent/30 flex items-center gap-4">
                                        <div className="w-10 h-10 bg-accent/10 rounded-full flex items-center justify-center">
                                            <Clock className="w-6 h-6 text-accent" />
                                        </div>
                                        <div>
                                            <div className="font-semibold text-accent capitalize">{candidate.status.replace('_', ' ')}</div>
                                            <div className="text-xs text-accent">Pending next action</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Activity Timeline */}
                        <div className="bg-surface rounded-xl shadow-sm border border-subtle p-6">
                            <h3 className="font-semibold text-primary mb-8 flex items-center gap-2">
                                <BarChart className="w-5 h-5 text-accent" />
                                Hiring Activity
                            </h3>
                            <div className="space-y-8 relative before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-surface-hover">
                                {activity.map((act) => (
                                    <div key={act.id} className="relative pl-8 group">
                                        <div className="absolute left-0 top-1 w-6 h-6 rounded-full bg-surface border-2 border-accent/30 flex items-center justify-center z-10 group-hover:scale-110 transition-transform shadow-sm">
                                            <div className="w-2 h-2 rounded-full bg-primary-500" />
                                        </div>
                                        <div>
                                            <div className="text-sm font-semibold text-primary leading-tight capitalize">{act.action.replace(/_/g, ' ')}</div>
                                            <div className="text-[10px] text-tertiary font-semibold uppercase tracking-wider mt-1">{new Date(act.created_at).toLocaleString()}</div>
                                            {act.details && (
                                                <div className="text-xs text-secondary bg-surface-sunken p-3 rounded-xl border border-subtle mt-2 shadow-sm">
                                                    {renderActivityDetails(act)}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {activity.length === 0 && (
                                    <p className="text-center text-tertiary py-4 text-sm font-medium">No activity recorded yet.</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            {/* Team Fit Simulator */}
            {showFitModal && (
                <TeamFitModal
                    candidate={candidate}
                    results={results}
                    treasury={treasury}
                    loading={loadingFit}
                    onClose={() => setShowFitModal(false)}
                />
            )}

            {/* Message composer */}
            {showMessageModal && user && (
                <CandidateMessageModal
                    candidate={candidate}
                    privyUserId={user.id}
                    onClose={() => setShowMessageModal(false)}
                />
            )}

            {/* Schedule Modal */}
            {showScheduleModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-surface rounded-2xl shadow-popover w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
                        <h3 className="text-xl font-semibold text-primary mb-2">Schedule Interview</h3>
                        <p className="text-secondary text-sm mb-6">Select a date and time. An automated invite will be sent to the candidate with a generated Google Meet link.</p>

                        <div className="mb-6">
                            <label className="block text-sm font-semibold text-secondary mb-2">Date & Time</label>
                            <input
                                type="datetime-local"
                                className="input-field w-full rounded-xl"
                                value={scheduleTime}
                                onChange={(e) => setScheduleTime(e.target.value)}
                            />
                        </div>

                        <div className="flex justify-end gap-3">
                            <button className="btn-secondary" onClick={() => setShowScheduleModal(false)}>Cancel</button>
                            <button
                                className="btn-primary flex items-center gap-2"
                                onClick={handleSchedule}
                                disabled={isScheduling || !scheduleTime}
                            >
                                {isScheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
                                Confirm Schedule
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}