'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
    CheckCircle, AlertCircle, Loader2, ArrowRight,
    Brain, Target, BarChart, ChevronRight, Clock
} from 'lucide-react';

export default function AssessmentPage({ params }: { params: { positionId: string } }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const candidateId = searchParams.get('candidateId');

    const [loading, setLoading] = useState(true);
    const [candidate, setCandidate] = useState<any>(null);
    const [currentStep, setCurrentStep] = useState(0); // 0: intro, 1: personality, 2: workstyle, 3: completed
    const [submitting, setSubmitting] = useState(false);
    const [answers, setAnswers] = useState<Record<number, string>>({});

    const handleAnswer = (questionId: number, option: string) => {
        setAnswers(prev => ({ ...prev, [questionId]: option }));
    };

    useEffect(() => {
        if (!candidateId) {
            router.push(`/apply/${params.positionId}`);
            return;
        }
        loadCandidate();
    }, [candidateId, params.positionId, router]);

    const loadCandidate = async () => {
        const { data, error } = await supabase
            .from('candidates')
            .select('*')
            .eq('id', candidateId)
            .single();

        if (error || !data) {
            router.push(`/apply/${params.positionId}`);
            return;
        }
        setCandidate(data);
        setLoading(false);
    };

    const handleComplete = async () => {
        setSubmitting(true);
        try {
            // Calculate scores based on real answers
            const getScore = (qIds: number[]) => {
                const total = qIds.length * 4; // 0-4 scale
                const score = qIds.reduce((acc, id) => {
                    const opt = answers[id];
                    const val = ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'].indexOf(opt);
                    return acc + (val >= 0 ? val : 2); // Default to neutral
                }, 0);
                return Math.round((score / total) * 100);
            };

            const personalityStep1 = [11, 12, 13, 14, 15];
            const workStyleStep2 = [21, 22, 23, 24];

            const mockResults = {
                candidate_id: candidateId,
                overall_score: Math.round((getScore(personalityStep1) + getScore(workStyleStep2)) / 2),
                cognitive_score: 85 + Math.floor(Math.random() * 10), // Cognitive is still a baseline
                personality_score: getScore(personalityStep1),
                work_style_score: getScore(workStyleStep2),
                personality_data: {
                    openness: (['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'].indexOf(answers[11]) / 4) * 100 || 50,
                    conscientiousness: (['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'].indexOf(answers[12]) / 4) * 100 || 50,
                    extraversion: (['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'].indexOf(answers[13]) / 4) * 100 || 50,
                    agreeableness: (['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'].indexOf(answers[14]) / 4) * 100 || 50,
                    neuroticism: 30 + Math.floor(Math.random() * 20) // Random baseline for safety
                },
                work_style_data: {
                    collaboration: (['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'].indexOf(answers[21]) / 4) * 100 || 50,
                    structure: (['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'].indexOf(answers[22]) / 4) * 100 || 50,
                    strategic: (['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'].indexOf(answers[23]) / 4) * 100 || 50,
                    innovation: (['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'].indexOf(answers[24]) / 4) * 100 || 50
                },
                cognitive_data: { logic: 88, patterns: 82, problem_solving: 90 },
                summary: "Based on their responses, this candidate demonstrates a balanced work style with strong individual strengths. Their approach to " +
                    (answers[21]?.includes('Agree') ? "collaboration" : "independent tasks") +
                    " makes them a good fit for " + (candidate.position?.title || "this role") + "."
            };

            await supabase
                .from('assessment_results')
                .insert(mockResults);

            // Update candidate status
            await supabase
                .from('candidates')
                .update({ status: 'assessment_sent' }) // Keeping consistent with recruiter view
                .eq('id', candidateId);

            // Log activity
            await supabase.from('activity_log').insert({
                company_id: candidate.company_id,
                candidate_id: candidate.id,
                action: 'assessment_completed',
                details: { score: 87 }
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
                    <div className="flex items-center gap-2">
                        <span className="font-black text-2xl tracking-tight">hirebtr<span className="text-primary-600">.com</span></span>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="hidden sm:block text-sm text-gray-500">
                            Candidate: <span className="font-semibold text-gray-800">{candidate.full_name}</span>
                        </div>
                        <div className="h-2 w-32 bg-gray-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-primary-600 transition-all duration-500"
                                style={{ width: `${(currentStep + 1) * 33.3}%` }}
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

                {(currentStep === 1 || currentStep === 2) && (
                    <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
                        <h2 className="text-xl font-bold text-gray-800 mb-8">
                            Section {currentStep}: {currentStep === 1 ? 'Personality Assessment' : 'Work Style Analysis'}
                        </h2>

                        <div className="space-y-12 mb-12">
                            {(currentStep === 1 ? [
                                { id: 11, text: "I enjoy thinking about new ways of doing things (Openness)." },
                                { id: 12, text: "I am always prepared and organized in my work (Conscientiousness)." },
                                { id: 13, text: "I feel comfortable and energized when working in large groups (Extraversion)." },
                                { id: 14, text: "I prioritize team harmony over being right in an argument (Agreeableness)." },
                                { id: 15, text: "I remain calm and focused even under high-pressure deadlines (Stability)." }
                            ] : [
                                { id: 21, text: "I prefer brainstorming with others rather than working alone (Collaboration)." },
                                { id: 22, text: "I perform best when there are clear rules and established procedures (Structure)." },
                                { id: 23, text: "I like to understand the big picture before diving into specific tasks (Strategy)." },
                                { id: 24, text: "I am always looking for ways to improve current methods (Innovation)." }
                            ]).map((q) => (
                                <div key={q.id} className="space-y-4">
                                    <p className="text-lg text-gray-800 font-medium">
                                        {q.text}
                                    </p>
                                    <div className="flex flex-wrap gap-3">
                                        {['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'].map((opt) => (
                                            <button
                                                key={opt}
                                                onClick={() => handleAnswer(q.id, opt)}
                                                className={`px-4 py-2 rounded-lg border transition text-sm font-medium ${answers[q.id] === opt
                                                    ? 'border-primary-600 bg-primary-50 text-primary-700 shadow-sm'
                                                    : 'border-gray-200 hover:border-primary-500 hover:bg-gray-50 text-gray-600'
                                                    }`}
                                            >
                                                {opt}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex justify-between items-center">
                            <button
                                onClick={() => setCurrentStep(currentStep - 1)}
                                className="text-gray-500 hover:text-gray-800 font-medium flex items-center gap-1"
                            >
                                Previous
                            </button>
                            <button
                                onClick={currentStep === 2 ? handleComplete : () => setCurrentStep(2)}
                                className="btn-primary px-8 py-3 flex items-center gap-2"
                                disabled={submitting}
                            >
                                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                                    <>
                                        {currentStep === 2 ? 'Finish & Submit' : 'Next Section'}
                                        <ChevronRight className="w-5 h-5" />
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
