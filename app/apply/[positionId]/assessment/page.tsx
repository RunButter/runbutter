'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { DEFAULT_PERSONALITY_QUESTIONS } from '@/lib/questions';
import {
    CheckCircle2, Loader2, ArrowRight, ArrowLeft,
    Brain, Target, Clock, BarChart3, Check
} from 'lucide-react';
import LogoContainer from '@/components/LogoContainer';

// Candidate assessment, one question at a time (Typeform-style): a real
// per-question progress bar, auto-advance on answer, and no way to finish
// with unanswered questions (the old version silently scored skipped
// questions as "neutral"). Scoring + submission logic is unchanged.
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
    const [qIndex, setQIndex] = useState(0);   // active question within step 1

    const personalityQs = useMemo(
        () => template?.questions?.filter((q: any) => q.category === 'personality' || q.category === 'work_style') || [],
        [template],
    );
    const screeningQs = useMemo(
        () => template?.questions?.filter((q: any) => q.category === 'screening') || [],
        [template],
    );
    const totalQs = personalityQs.length + screeningQs.length;
    const answeredCount = useMemo(
        () => [...personalityQs, ...screeningQs].filter((q: any) => answers[q.id] !== undefined && answers[q.id] !== '').length,
        [personalityQs, screeningQs, answers],
    );
    const progress = currentStep === 0 ? 0 : currentStep === 3 ? 100 : Math.round((answeredCount / Math.max(totalQs, 1)) * 100);

    // MCQ screening answers are required; free-text stays optional.
    const screeningMcqsAnswered = screeningQs
        .filter((q: any) => q.type === 'choice')
        .every((q: any) => answers[q.id] !== undefined);

    const loadCandidate = useCallback(async () => {
        const token = searchParams.get('token');
        if (!candidateId || !token) {
            router.push(`/apply/${params.positionId}`);
            return;
        }

        try {
            const { data, error } = await supabase.rpc('get_assessment_init_data', {
                p_candidate_id: candidateId,
                p_token: token
            });

            if (error || !data) {
                console.error('Candidate not found or access denied:', error);
                router.push(`/apply/${params.positionId}`);
                return;
            }

            const { candidate: can, company, template: tmpl } = data;

            setCandidate(can);
            setCompanyInfo({
                name: company.name,
                logoUrl: company.logo_url
            });

            if (tmpl && tmpl.questions) {
                const personalityQuestions = tmpl.questions.filter((q: any) => q.category === 'personality' || q.trait);
                if (personalityQuestions.length < 20) {
                    // v4.3 safeguard: thin templates get the 20 default personality questions
                    const screeningQuestions = tmpl.questions.filter((q: any) => q.category === 'screening');
                    setTemplate({
                        ...tmpl,
                        questions: [...DEFAULT_PERSONALITY_QUESTIONS, ...screeningQuestions]
                    });
                } else {
                    setTemplate(tmpl);
                }
            } else {
                setTemplate({
                    questions: DEFAULT_PERSONALITY_QUESTIONS
                });
            }
        } catch (err) {
            console.error('Error loading assessment data:', err);
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

    // Answer + auto-advance for the one-at-a-time personality flow.
    const answerAndAdvance = (questionId: number, option: string) => {
        setAnswers(prev => ({ ...prev, [questionId]: option }));
        setTimeout(() => {
            setQIndex((i) => Math.min(i + 1, personalityQs.length));   // len = "all answered" panel
        }, 180);
    };
    const handleAnswer = (questionId: number, option: string) => {
        setAnswers(prev => ({ ...prev, [questionId]: option }));
    };

    const handleComplete = async () => {
        setSubmitting(true);
        try {
            // 0. Fetch Position Neuro-Profile for benchmark
            const { data: posData } = await supabase
                .from('positions')
                .select('neuro_profile')
                .eq('id', params.positionId)
                .single();

            const neuroProfile = posData?.neuro_profile || 'hard-tech';

            // 1. Calculate Personality Scores (Big 5)
            const getScoreForTrait = (trait: string) => {
                const qs = template?.questions?.filter((q: any) => q.trait === trait) || [];
                if (qs.length === 0) return 50;
                const total = qs.reduce((acc: number, q: any) => {
                    const opt = answers[q.id];
                    const val = q.options.indexOf(opt); // 0-4
                    return acc + (val >= 0 ? val : 2);
                }, 0);
                return Math.round((total / (qs.length * 4)) * 100);
            };

            const openness = getScoreForTrait('Openness');
            const conscientiousness = getScoreForTrait('Conscientiousness');
            const extraversion = getScoreForTrait('Extraversion');
            const agreeableness = getScoreForTrait('Agreeableness');
            const neuroticism = getScoreForTrait('Neuroticism');

            // 2. Calculate Neuro-Profile Match
            const calculateMatch = (scores: any, profile: string) => {
                let match = 0;
                if (profile === 'hard-tech') {
                    // Focus: C / O
                    match = (scores.conscientiousness * 0.5) + (scores.openness * 0.5);
                } else if (profile === 'aggressive-sales') {
                    // Focus: E / A- (Inverted A)
                    match = (scores.extraversion * 0.6) + ((100 - scores.agreeableness) * 0.4);
                } else if (profile === 'creative-chaos') {
                    // Focus: O / N
                    match = (scores.openness * 0.6) + (scores.neuroticism * 0.4);
                } else if (profile === 'operations-monk') {
                    // Focus: C / N- (Inverted N)
                    match = (scores.conscientiousness * 0.6) + ((100 - scores.neuroticism) * 0.4);
                }
                return Math.round(match);
            };

            const overall_score = calculateMatch({ openness, conscientiousness, extraversion, agreeableness, neuroticism }, neuroProfile);

            // 3. Calculate Screening Match Percentage (MCQs)
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
                overall_score,
                // No cognitive test exists yet — store null, never a fabricated number.
                cognitive_score: null,
                personality_score: Math.round((openness + conscientiousness + extraversion + agreeableness + (100 - neuroticism)) / 5),
                work_style_score: Math.round((conscientiousness + extraversion) / 2),
                screening_score,
                screening_answers: screeningAnswers,
                personality_data: { openness, conscientiousness, extraversion, agreeableness, neuroticism },
                work_style_data: {
                    collaboration: agreeableness,
                    structure: conscientiousness,
                    strategic: openness,
                    innovation: openness
                },
                cognitive_data: null,
                summary: `Candidate profile matches the ${neuroProfile.toUpperCase()} Neuro-Profile with a ${overall_score}% alignment rating.`
            };

            // Use RPC for atomic and secure submission
            const { error: submitError } = await supabase.rpc('submit_assessment', {
                p_candidate_id: candidateId,
                p_token: searchParams.get('token'),
                p_results: finalResults,
                p_answers: answers
            });

            if (submitError) {
                console.error('RPC Submit Error:', submitError);
                throw new Error(`Submission failed: ${submitError.message || 'Unknown database error'}`);
            }

            setCurrentStep(3);
        } catch (error: any) {
            console.error('Error submitting assessment:', error);
            alert(`Failed to submit assessment: ${error.message || 'Please check your connection or contact support.'}`);
        } finally {
            setSubmitting(false);
        }
    };

    const CompanyMark = () =>
        companyInfo?.logoUrl ? (
            <LogoContainer src={companyInfo.logoUrl} alt={companyInfo.name} width="130px" height="36px" className="h-9 w-auto" />
        ) : (
            <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white font-semibold text-sm">
                    {companyInfo?.name?.charAt(0) || 'C'}
                </div>
                <span className="font-medium text-primary text-[15px]">{companyInfo?.name}</span>
            </div>
        );

    if (loading) {
        return (
            <div className="min-h-[100dvh] bg-surface-sunken flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-tertiary animate-spin" />
            </div>
        );
    }

    if (currentStep === 3) {
        return (
            <div className="min-h-[100dvh] bg-surface-sunken flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-surface rounded-2xl ring-1 ring-subtle shadow-popover shadow-slate-200/50 p-8 text-center">
                    <div className="flex justify-center mb-6"><CompanyMark /></div>
                    <div className="w-14 h-14 bg-success/10 ring-1 ring-success/30 rounded-full flex items-center justify-center mx-auto mb-5">
                        <CheckCircle2 className="w-8 h-8 text-success" />
                    </div>
                    <h1 className="text-2xl font-semibold tracking-tight text-primary mb-2">Assessment complete</h1>
                    <p className="text-[15px] text-secondary">
                        Your answers were sent to the recruitment team at {companyInfo?.name || 'the company'}.
                        They will review your profile and contact you about next steps.
                    </p>
                    <p className="mt-6 text-[13px] text-tertiary">You can safely close this tab.</p>
                </div>
            </div>
        );
    }

    const activeQ = personalityQs[qIndex];
    const personalityDone = qIndex >= personalityQs.length;

    return (
        <div className="min-h-[100dvh] bg-surface-sunken flex flex-col">
            {/* Header: company + real per-question progress */}
            <header className="bg-surface/$1 backdrop-blur border-b border-subtle sticky top-0 z-10">
                <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
                    <CompanyMark />
                    <div className="flex items-center gap-3 min-w-0">
                        {currentStep > 0 && (
                            <span className="text-[12px] font-semibold text-secondary tabular-nums whitespace-nowrap">{answeredCount} / {totalQs}</span>
                        )}
                        <div className="h-1.5 w-24 sm:w-36 bg-surface-hover rounded-full overflow-hidden">
                            <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
                        </div>
                    </div>
                </div>
            </header>

            <main className="flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
                {currentStep === 0 && (
                    <div className="bg-surface rounded-2xl ring-1 ring-subtle shadow-popover shadow-slate-200/50 p-6 sm:p-8">
                        <div className="w-11 h-11 rounded-xl bg-accent/10 ring-1 ring-accent/30 flex items-center justify-center mb-5">
                            <Target className="w-5 h-5 text-accent" />
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-primary mb-3">
                            Work style & personality
                        </h1>
                        <p className="text-[15px] text-secondary leading-relaxed mb-7">
                            {candidate?.full_name ? `Hi ${String(candidate.full_name).split(' ')[0]} — this` : 'This'} short questionnaire
                            helps {companyInfo?.name || 'the team'} understand how you work, collaborate, and solve problems.
                            There are no right or wrong answers. Just be yourself.
                        </p>

                        <div className="grid sm:grid-cols-3 gap-3 mb-8">
                            {[
                                { icon: Clock, label: 'Duration', value: '10-15 minutes' },
                                { icon: BarChart3, label: 'Questions', value: `${totalQs} in total` },
                                { icon: Brain, label: 'Format', value: 'One at a time' },
                            ].map((c) => (
                                <div key={c.label} className="rounded-xl bg-surface-sunken ring-1 ring-subtle p-3.5">
                                    <c.icon className="w-4 h-4 text-accent mb-1.5" />
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">{c.label}</div>
                                    <div className="text-[13px] font-medium text-secondary">{c.value}</div>
                                </div>
                            ))}
                        </div>

                        <button
                            onClick={() => { setCurrentStep(1); setQIndex(0); }}
                            className="w-full h-12 rounded-xl bg-accent text-white text-[15px] font-medium inline-flex items-center justify-center gap-2 hover:bg-accent/90 active:scale-[0.99] transition"
                        >
                            Start <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {currentStep === 1 && !personalityDone && activeQ && (
                    <div key={activeQ.id} className="bg-surface rounded-2xl ring-1 ring-subtle shadow-popover shadow-slate-200/50 p-6 sm:p-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="text-[12px] font-semibold text-tertiary mb-3 tabular-nums">Question {qIndex + 1} of {personalityQs.length}</div>
                        <p className="text-lg sm:text-xl font-medium text-primary leading-snug mb-6">{activeQ.text}</p>

                        <div className="space-y-2">
                            {activeQ.options.map((opt: string) => {
                                const selected = answers[activeQ.id] === opt;
                                return (
                                    <button
                                        key={opt}
                                        onClick={() => answerAndAdvance(activeQ.id, opt)}
                                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl ring-1 text-left text-[15px] font-medium transition-all ${selected
                                            ? 'ring-accent/30 bg-accent/10 text-accent'
                                            : 'ring-subtle text-secondary hover:ring-accent/30 hover:bg-surface-sunken'
                                            }`}
                                    >
                                        <span className={`w-5 h-5 rounded-full ring-1 flex items-center justify-center shrink-0 transition-colors ${selected ? 'bg-accent ring-accent/30' : 'ring-strong bg-surface'}`}>
                                            {selected && <Check className="w-3 h-3 text-white" />}
                                        </span>
                                        {opt}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="mt-7 flex items-center justify-between">
                            <button
                                onClick={() => (qIndex === 0 ? setCurrentStep(0) : setQIndex(qIndex - 1))}
                                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-tertiary hover:text-secondary transition-colors"
                            >
                                <ArrowLeft className="w-3.5 h-3.5" /> Back
                            </button>
                            {answers[activeQ.id] !== undefined && (
                                <button onClick={() => setQIndex(qIndex + 1)}
                                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:text-accent transition-colors">
                                    Next <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {currentStep === 1 && personalityDone && (
                    <div className="bg-surface rounded-2xl ring-1 ring-subtle shadow-popover shadow-slate-200/50 p-6 sm:p-8 text-center animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="w-12 h-12 bg-success/10 ring-1 ring-success/30 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Check className="w-6 h-6 text-success" />
                        </div>
                        <h2 className="text-xl font-semibold tracking-tight text-primary mb-2">
                            {screeningQs.length > 0 ? 'Section complete' : 'All questions answered'}
                        </h2>
                        <p className="text-[14px] text-secondary mb-7">
                            {screeningQs.length > 0
                                ? `${screeningQs.length} short question${screeningQs.length > 1 ? 's' : ''} from ${companyInfo?.name || 'the company'} left.`
                                : 'Review is done in one click. Good luck!'}
                        </p>
                        <div className="flex items-center justify-center gap-3">
                            <button onClick={() => setQIndex(personalityQs.length - 1)}
                                className="h-11 px-5 rounded-xl ring-1 ring-subtle text-secondary text-[14px] font-semibold hover:bg-surface-sunken transition-colors">
                                Back
                            </button>
                            <button
                                onClick={() => (screeningQs.length > 0 ? setCurrentStep(2) : handleComplete())}
                                disabled={submitting}
                                className="h-11 px-6 rounded-xl bg-accent text-white text-[14px] font-medium inline-flex items-center justify-center gap-2 hover:bg-accent/90 transition disabled:opacity-60"
                            >
                                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                                    <>{screeningQs.length > 0 ? 'Continue' : 'Finish & submit'} <ArrowRight className="w-4 h-4" /></>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {currentStep === 2 && (
                    <div className="bg-surface rounded-2xl ring-1 ring-subtle shadow-popover shadow-slate-200/50 p-6 sm:p-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <h2 className="text-xl font-semibold tracking-tight text-primary mb-1.5">A few questions from {companyInfo?.name || 'the company'}</h2>
                        <p className="text-[13px] text-tertiary mb-8">Specific to this role.</p>

                        <div className="space-y-9 mb-9">
                            {screeningQs.map((q: any, idx: number) => (
                                <div key={q.id}>
                                    <p className="text-[15px] font-medium text-primary leading-snug mb-3.5">
                                        <span className="text-tertiary tabular-nums mr-1.5">{idx + 1}.</span>{q.text}
                                        {q.type !== 'choice' && <span className="ml-2 text-[11px] font-medium text-tertiary">(optional)</span>}
                                    </p>

                                    {q.type === 'choice' ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            {q.options.map((opt: string) => {
                                                const selected = answers[q.id] === opt;
                                                return (
                                                    <button
                                                        key={opt}
                                                        onClick={() => handleAnswer(q.id, opt)}
                                                        className={`px-4 py-3 rounded-xl ring-1 text-left text-[14px] font-medium transition-all ${selected
                                                            ? 'ring-accent/30 bg-accent/10 text-accent'
                                                            : 'ring-subtle text-secondary hover:ring-accent/30 hover:bg-surface-sunken'
                                                            }`}
                                                    >
                                                        {opt}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <textarea
                                            className="w-full p-3.5 rounded-xl ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none transition-shadow min-h-[110px] text-[14px] text-secondary placeholder:text-tertiary"
                                            placeholder="Type your answer…"
                                            value={answers[q.id] || ''}
                                            onChange={(e) => handleAnswer(q.id, e.target.value)}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>

                        <div className="flex items-center justify-between pt-6 border-t border-subtle">
                            <button
                                onClick={() => { setCurrentStep(1); setQIndex(personalityQs.length); }}
                                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-tertiary hover:text-secondary transition-colors"
                            >
                                <ArrowLeft className="w-3.5 h-3.5" /> Back
                            </button>
                            <div className="flex items-center gap-3">
                                {!screeningMcqsAnswered && <span className="text-[12px] text-tertiary hidden sm:block">Answer the multiple-choice questions to finish</span>}
                                <button
                                    onClick={handleComplete}
                                    disabled={submitting || !screeningMcqsAnswered}
                                    className="h-11 px-6 rounded-xl bg-accent text-white text-[14px] font-medium inline-flex items-center justify-center gap-2 hover:bg-accent/90 transition disabled:opacity-50"
                                >
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : (<>Finish & submit <CheckCircle2 className="w-4 h-4" /></>)}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
