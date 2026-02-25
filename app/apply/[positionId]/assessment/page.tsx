'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
    CheckCircle, AlertCircle, Loader2, ArrowRight,
    Brain, Target, BarChart, ChevronRight, Clock
} from 'lucide-react';
import LogoContainer from '@/components/LogoContainer';

export default function AssessmentPage({ params }: { params: { positionId: string } }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const candidateId = searchParams.get('candidateId');

    const [loading, setLoading] = useState(true);
    const [candidate, setCandidate] = useState<any>(null);
    const [template, setTemplate] = useState<any>(null);
    const [companyInfo, setCompanyInfo] = useState<{ name: string, logoUrl: string | null } | null>(null);
    const [currentStep, setCurrentStep] = useState(0); // 0: intro, 1: personality/workstyle, 2: screening, 3: completed
    const [submitting, setSubmitting] = useState(false);
    const [answers, setAnswers] = useState<Record<string, any>>({});

    const handleAnswer = (questionId: number, option: string) => {
        setAnswers(prev => ({ ...prev, [questionId]: option }));
    };

    const loadCandidate = useCallback(async () => {
        const token = searchParams.get('token');
        if (!candidateId || !token) {
            router.push(`/apply/${params.positionId}`);
            return;
        }

        try {
            // Set the security context for RLS
            await supabase.rpc('set_config', { name: 'app.candidate_access_token', value: token, is_local: false });

            const { data, error } = await supabase
                .from('candidates')
                .select('*, companies(name, logo_url)')
                .eq('id', candidateId)
                .single();

            if (error || !data) {
                console.error('Candidate not found or access denied:', error);
                router.push(`/apply/${params.positionId}`);
                return;
            }
            setCandidate(data);
            setCompanyInfo({
                name: (data.companies as any).name,
                logoUrl: (data.companies as any).logo_url
            });

            // Fetch Assessment Template
            const { data: tmpl, error: tmplError } = await supabase
                .from('assessment_templates')
                .select('*')
                .eq('position_id', data.position_id)
                .is('is_default', true)
                .single();

            if (!tmplError && tmpl) {
                setTemplate(tmpl);
            } else {
                // Fallback for positions without custom templates (old positions)
                setTemplate({
                    questions: [
                        { id: '1', category: 'personality', trait: 'Extraversion', text: 'I enjoy interacting with people', type: 'scale', options: ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'] },
                        { id: '2', category: 'work_style', text: 'I prefer working in a structured environment', type: 'scale', options: ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'] },
                        { id: '3', category: 'personality', trait: 'Openness', text: 'I enjoy thinking about new ways of doing things', type: 'scale', options: ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'] },
                        { id: '4', category: 'work_style', text: 'I like to understand the big picture before diving into specific tasks', type: 'scale', options: ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'] }
                    ]
                });
            }
        } catch (err) {
            console.error('Error loading candidate security context:', err);
            router.push(`/apply/${params.positionId}`);
        } finally {
            setLoading(false);
        }
    }, [candidateId, searchParams, params.positionId, router]);

    useEffect(() => {
        if (!candidateId) {
            router.push(`/apply/${params.positionId}`);
            return;
        }
        loadCandidate();
    }, [candidateId, params.positionId, router, loadCandidate]);

    const handleComplete = async () => {
        setSubmitting(true);
        try {
            // 1. Calculate Personality/Workstyle Scores
            const personaQuestions = template?.questions?.filter((q: any) => q.category === 'personality' || q.category === 'work_style') || [];

            const getScoreForCategory = (category: string) => {
                const qs = personaQuestions.filter((q: any) => q.category === category);
                if (qs.length === 0) return 70; // Baseline
                const score = qs.reduce((acc: number, q: any) => {
                    const opt = answers[q.id];
                    const val = q.options.indexOf(opt);
                    return acc + (val >= 0 ? val : 2);
                }, 0);
                return Math.round((score / (qs.length * (qs[0].options.length - 1))) * 100);
            };

            const personality_score = getScoreForCategory('personality');
            const work_style_score = getScoreForCategory('work_style');

            // 2. Calculate Screening Match Percentage
            const screeningMCQs = template?.questions?.filter((q: any) => q.category === 'screening' && q.type === 'choice') || [];
            let correctCount = 0;
            const screeningAnswers = template?.questions?.filter((q: any) => q.category === 'screening').map((q: any) => ({
                question: q.text,
                answer: answers[q.id],
                is_correct: q.type === 'choice' ? q.options.indexOf(answers[q.id]) === q.correctIndex : null
            })) || [];

            if (screeningMCQs.length > 0) {
                screeningMCQs.forEach((q: any) => {
                    if (q.options.indexOf(answers[q.id]) === q.correctIndex) {
                        correctCount++;
                    }
                });
            }
            const screening_score = screeningMCQs.length > 0 ? Math.round((correctCount / screeningMCQs.length) * 100) : null;

            const finalResults = {
                candidate_id: candidateId,
                overall_score: screening_score !== null ? Math.round((personality_score + work_style_score + screening_score) / 3) : Math.round((personality_score + work_style_score) / 2),
                cognitive_score: 85 + Math.floor(Math.random() * 10),
                personality_score,
                work_style_score,
                screening_score,
                screening_answers: screeningAnswers,
                personality_data: {
                    openness: personality_score,
                    conscientiousness: Math.max(40, personality_score - 10),
                    extraversion: Math.min(100, personality_score + 5),
                    agreeableness: personality_score,
                    neuroticism: 25
                },
                work_style_data: {
                    collaboration: work_style_score,
                    structure: Math.max(30, 100 - work_style_score),
                    strategic: work_style_score,
                    innovation: work_style_score
                },
                cognitive_data: { logic: 88, patterns: 82, problem_solving: 90 },
                summary: `Candidate showed a ${screening_score}% match on screening questions. Their personality profile indicates strong alignment with ${companyInfo?.name}'s values.`
            };

            // 1. Create a response record first to get an ID
            const { data: resp, error: respError } = await supabase
                .from('assessment_responses')
                .insert({
                    candidate_id: candidateId,
                    answers: answers,
                    is_completed: true,
                    completed_at: new Date().toISOString()
                })
                .select()
                .single();

            if (respError) throw respError;

            // 2. Insert results linked to the response
            await supabase
                .from('assessment_results')
                .insert({
                    ...finalResults,
                    assessment_response_id: resp.id,
                    calculated_at: new Date().toISOString()
                });

            // 3. Update candidate status to 'assessment_completed'
            await supabase
                .from('candidates')
                .update({ status: 'assessment_completed' })
                .eq('id', candidateId);

            // Log activity
            await supabase.from('activity_log').insert({
                company_id: candidate.company_id,
                candidate_id: candidate.id,
                action: 'assessment_completed',
                details: { score: finalResults.overall_score, screening_match: screening_score }
            });

            setCurrentStep(3);
        } catch (error) {
            console.error('Error submitting assessment:', error);
            alert('Failed to submit assessment results');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-primary-600 animate-spin" />
            </div>
        );
    }

    if (currentStep === 3) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center p-6 text-center">
                <div className="max-w-md">
                    {companyInfo?.logoUrl && (
                        <div className="flex justify-center mb-8">
                            <LogoContainer src={companyInfo.logoUrl} alt={companyInfo.name} />
                        </div>
                    )}
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="w-12 h-12 text-green-600" />
                    </div>
                    <h1 className="text-3xl font-bold text-gray-800 mb-4">Assessment Complete!</h1>
                    <p className="text-gray-600 mb-8">
                        Your profile has been updated and sent to the recruitment team.
                        They will review your results and contact you for next steps.
                    </p>
                    <button
                        onClick={() => window.close()}
                        className="btn-secondary w-full"
                    >
                        Close Window
                    </button>
                </div>
            </div>
        );
    }


    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white border-b py-4 px-6 sticky top-0 z-10">
                <div className="max-w-3xl mx-auto flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        {companyInfo?.logoUrl ? (
                            <LogoContainer src={companyInfo.logoUrl} alt={companyInfo.name} className="h-8 w-auto" />
                        ) : (
                            <span className="font-black text-2xl tracking-tight">hirebtr<span className="text-primary-600">.com</span></span>
                        )}
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="hidden sm:block text-sm text-gray-500">
                            Candidate: <span className="font-semibold text-gray-800">{candidate.full_name}</span>
                        </div>
                        <div className="h-2 w-32 bg-gray-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-primary-600 transition-all duration-500"
                                style={{ width: `${(currentStep + 1) * 25}%` }}
                            />
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-6 py-12">
                {currentStep === 0 && (
                    <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
                        <h1 className="text-3xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                            <Target className="w-8 h-8 text-primary-600" />
                            Work Style & Personality Assessment
                        </h1>
                        <p className="text-gray-600 mb-8 text-lg">
                            This assessment helps us understand how you work, collaborate, and solve problems.
                            There are no right or wrong answers—just be yourself!
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
                            <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
                                <h3 className="font-bold text-blue-900 mb-2 flex items-center gap-2">
                                    <Clock className="w-5 h-5" /> Duration
                                </h3>
                                <p className="text-sm text-blue-700">Approximately 10-15 minutes to complete.</p>
                            </div>
                            <div className="p-4 rounded-xl bg-purple-50 border border-purple-100">
                                <h3 className="font-bold text-purple-900 mb-2 flex items-center gap-2">
                                    <BarChart className="w-5 h-5" /> Sections
                                </h3>
                                <p className="text-sm text-purple-700">Personality traits and hypothetical work scenarios.</p>
                            </div>
                        </div>

                        <button
                            onClick={() => setCurrentStep(1)}
                            className="btn-primary w-full py-4 text-lg flex items-center justify-center gap-2"
                        >
                            Start Assessment
                            <ArrowRight className="w-6 h-6" />
                        </button>
                    </div>
                )}

                {(currentStep === 1) && (
                    <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <h2 className="text-xl font-bold text-gray-800 mb-8 flex items-center gap-2">
                            <Brain className="w-5 h-5 text-primary-500" />
                            Personality & Work Style Analysis
                        </h2>

                        <div className="space-y-10 mb-12">
                            {(template?.questions?.filter((q: any) => q.category === 'personality' || q.category === 'work_style') || []).map((q: any) => (
                                <div key={q.id} className="space-y-4">
                                    <p className="text-lg text-gray-800 font-medium leading-relaxed">
                                        {q.text}
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {q.options.map((opt: string) => (
                                            <button
                                                key={opt}
                                                onClick={() => handleAnswer(q.id, opt)}
                                                className={`px-4 py-2 rounded-xl border-2 transition-all duration-200 text-sm font-bold ${answers[q.id] === opt
                                                    ? 'border-primary-600 bg-primary-600 text-white shadow-md transform scale-[1.02]'
                                                    : 'border-gray-100 hover:border-primary-200 hover:bg-gray-50 text-gray-500'
                                                    }`}
                                            >
                                                {opt}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex justify-between items-center pt-8 border-t">
                            <button
                                onClick={() => setCurrentStep(0)}
                                className="text-gray-400 hover:text-gray-800 font-bold flex items-center gap-1 transition"
                            >
                                Back
                            </button>
                            <button
                                onClick={() => {
                                    const screeningQs = template?.questions?.filter((q: any) => q.category === 'screening') || [];
                                    if (screeningQs.length > 0) {
                                        setCurrentStep(2);
                                    } else {
                                        handleComplete();
                                    }
                                }}
                                className="btn-primary px-8 py-3 flex items-center gap-2 shadow-lg hover:shadow-primary-200"
                                disabled={submitting}
                            >
                                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                                    <>
                                        {(template?.questions?.filter((q: any) => q.category === 'screening') || []).length > 0 ? 'Next: Custom Questions' : 'Finish & Submit'}
                                        <ChevronRight className="w-5 h-5" />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {currentStep === 2 && (
                    <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <h2 className="text-xl font-bold text-gray-800 mb-8 flex items-center gap-2">
                            <Target className="w-5 h-5 text-indigo-500" />
                            Custom Screening Questions
                        </h2>

                        <div className="space-y-12 mb-12">
                            {(template?.questions?.filter((q: any) => q.category === 'screening') || []).map((q: any, idx: number) => (
                                <div key={q.id} className="space-y-4">
                                    <div className="flex items-start gap-4">
                                        <span className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-sm shrink-0">
                                            {idx + 1}
                                        </span>
                                        <div className="flex-1 space-y-4">
                                            <p className="text-lg text-gray-800 font-medium leading-relaxed pt-1">
                                                {q.text}
                                            </p>

                                            {q.type === 'choice' ? (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                    {q.options.map((opt: string) => (
                                                        <button
                                                            key={opt}
                                                            onClick={() => handleAnswer(q.id, opt)}
                                                            className={`px-4 py-3 rounded-xl border-2 text-left transition-all duration-200 text-sm font-bold ${answers[q.id] === opt
                                                                ? 'border-indigo-600 bg-indigo-600 text-white shadow-md'
                                                                : 'border-gray-100 hover:border-indigo-200 hover:bg-gray-50 text-gray-500'
                                                                }`}
                                                        >
                                                            {opt}
                                                        </button>
                                                    ))}
                                                </div>
                                            ) : (
                                                <textarea
                                                    className="w-full p-4 rounded-xl border-2 border-gray-100 focus:border-indigo-500 outline-none transition min-h-[120px] text-gray-700"
                                                    placeholder="Type your answer here..."
                                                    value={answers[q.id] || ''}
                                                    onChange={(e) => handleAnswer(q.id, e.target.value)}
                                                />
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex justify-between items-center pt-8 border-t">
                            <button
                                onClick={() => setCurrentStep(1)}
                                className="text-gray-400 hover:text-gray-800 font-bold flex items-center gap-1 transition"
                            >
                                Back
                            </button>
                            <button
                                onClick={handleComplete}
                                className="btn-primary bg-indigo-600 hover:bg-indigo-700 px-8 py-3 flex items-center gap-2 shadow-lg hover:shadow-indigo-200"
                                disabled={submitting}
                            >
                                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                                    <>
                                        Finish & Submit
                                        <CheckCircle className="w-5 h-5" />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
