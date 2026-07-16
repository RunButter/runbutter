'use client';

import { getLimit, formatLimit } from '@/lib/plans';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { DEFAULT_PERSONALITY_QUESTIONS } from '@/lib/questions';
import { Briefcase, ArrowLeft, Loader2, Globe, Building2, Target, X, Plus, CheckCircle } from 'lucide-react';
import Link from 'next/link';

export default function NewPositionPage() {
    const router = useRouter();
    const { ready, authenticated, user } = usePrivy();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const [formData, setFormData] = useState({
        title: '',
        description: '',
        department: '',
        location: '',
        employment_type: 'full-time',
        neuro_profile: 'hard-tech' as any,
    });

    const [screeningQuestions, setScreeningQuestions] = useState<any[]>([
        { id: 's1', category: 'screening', type: 'choice', text: '', options: ['', '', ''], correctIndex: 0 },
    ]);

    const [openEndedQuestion, setOpenEndedQuestion] = useState({ id: 's_open', category: 'screening', type: 'text', text: '' });

    const addMCQ = () => {
        if (screeningQuestions.length >= 3) return;
        setScreeningQuestions([...screeningQuestions, {
            id: `s${screeningQuestions.length + 1}`,
            category: 'screening',
            type: 'choice',
            text: '',
            options: ['', '', ''],
            correctIndex: 0
        }]);
    };

    const removeMCQ = (index: number) => {
        setScreeningQuestions(screeningQuestions.filter((_, i) => i !== index));
    };

    const updateMCQ = (index: number, field: string, value: any) => {
        const updated = [...screeningQuestions];
        updated[index] = { ...updated[index], [field]: value };
        setScreeningQuestions(updated);
    };

    const updateMCQOption = (qIndex: number, oIndex: number, value: string) => {
        const updated = [...screeningQuestions];
        const updatedOptions = [...updated[qIndex].options];
        updatedOptions[oIndex] = value;
        updated[qIndex].options = updatedOptions;
        setScreeningQuestions(updated);
    };

    useEffect(() => {
        if (ready && !authenticated) {
            router.push('/auth/login');
        }
    }, [ready, authenticated, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        setSubmitting(true);
        setError('');

        try {
            await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: user.id, is_local: false });

            const { data: companyUser } = await supabase
                .from('company_users')
                .select('company_id, id')
                .eq('privy_user_id', user.id)
                .single();

            if (!companyUser) throw new Error('Company user not found');

            // Enforce plan position limit
            const { data: companyRow } = await supabase
                .from('companies').select('plan').eq('id', companyUser.company_id).single();
            const { count: positionCount } = await supabase
                .from('positions')
                .select('id', { count: 'exact', head: true })
                .eq('company_id', companyUser.company_id);
            const maxPositions = getLimit(companyRow?.plan, 'maxPositions');
            if ((positionCount ?? 0) >= maxPositions) {
                throw new Error(`Your ${companyRow?.plan || 'free'} plan allows ${formatLimit(maxPositions)} position(s). Upgrade to add more.`);
            }

            const { data: position, error: postError } = await supabase
                .from('positions')
                .insert({
                    company_id: companyUser.company_id,
                    title: formData.title,
                    description: formData.description,
                    department: formData.department,
                    location: formData.location,
                    employment_type: formData.employment_type,
                    neuro_profile: formData.neuro_profile,
                    created_by: companyUser.id,
                    is_active: true
                })
                .select()
                .single();

            if (postError) throw postError;

            // Combine default questions with custom screening questions
            const defaultQuestions = DEFAULT_PERSONALITY_QUESTIONS;

            const customQuestions = [
                ...screeningQuestions.filter(q => q.text.trim() !== ''),
                ...(openEndedQuestion.text.trim() !== '' ? [openEndedQuestion] : [])
            ];

            // Create default assessment for this position
            await supabase.from('assessment_templates').insert({
                company_id: companyUser.company_id,
                position_id: position.id,
                name: `${formData.title} Assessment`,
                description: `Standard assessment for ${formData.title}`,
                questions: [...defaultQuestions, ...customQuestions],
                is_default: true
            });

            router.push('/dashboard/positions');
        } catch (err: any) {
            setError(err.message || 'Failed to create position');
        } finally {
            setSubmitting(false);
        }
    };

    if (!ready) {
        return (
            <div className="min-h-screen bg-surface-sunken flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-accent animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-surface-sunken">
            <header className="bg-surface border-b">
                <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-4">
                    <Link href="/dashboard/positions" className="p-2 hover:bg-surface-hover rounded-lg">
                        <ArrowLeft className="w-5 h-5 text-secondary" />
                    </Link>
                    <h1 className="text-xl font-semibold text-primary">Create New Position</h1>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-6 py-8">
                <div className="bg-surface rounded-2xl shadow-sm border border-subtle p-8">
                    {error && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="col-span-2">
                                <label className="block text-sm font-medium text-secondary mb-2">Job Title</label>
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="e.g. Senior Software Engineer"
                                    value={formData.title}
                                    onChange={e => setFormData({ ...formData, title: e.target.value })}
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-secondary mb-2">Department</label>
                                <div className="relative">
                                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-tertiary" />
                                    <input
                                        type="text"
                                        className="input-field pl-10"
                                        placeholder="Engineering"
                                        value={formData.department}
                                        onChange={e => setFormData({ ...formData, department: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-secondary mb-2">Location</label>
                                <div className="relative">
                                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-tertiary" />
                                    <input
                                        type="text"
                                        className="input-field pl-10"
                                        placeholder="Remote / New York"
                                        value={formData.location}
                                        onChange={e => setFormData({ ...formData, location: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-secondary mb-2">Employment Type</label>
                                <select
                                    className="input-field"
                                    value={formData.employment_type}
                                    onChange={e => setFormData({ ...formData, employment_type: e.target.value })}
                                >
                                    <option value="full-time">Full-time</option>
                                    <option value="part-time">Part-time</option>
                                    <option value="contract">Contract</option>
                                    <option value="internship">Internship</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-secondary mb-2">Description</label>
                            <textarea
                                className="input-field min-h-[120px]"
                                placeholder="Describe the role, responsibilities, and requirements..."
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                            />
                        </div>

                        <div className="pt-6 border-t font-sans">
                            <label className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-tertiary mb-4">
                                [ SELECT NEURO-PROFILE ]
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {[
                                    { id: 'hard-tech', label: 'HARD-TECH', focus: 'Focus: C / O', color: 'border-blue-200 bg-blue-50 text-blue-700' },
                                    { id: 'aggressive-sales', label: 'AGGRESSIVE-SALES', focus: 'Focus: E / A-', color: 'border-orange-200 bg-orange-50 text-orange-700' },
                                    { id: 'creative-chaos', label: 'CREATIVE-CHAOS', focus: 'Focus: O / N', color: 'border-purple-200 bg-purple-50 text-purple-700' },
                                    { id: 'operations-monk', label: 'OPERATIONS-MONK', focus: 'Focus: C / N-', color: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
                                ].map((profile) => (
                                    <button
                                        key={profile.id}
                                        type="button"
                                        onClick={() => setFormData({ ...formData, neuro_profile: profile.id })}
                                        className={`p-4 rounded-xl border-2 text-left transition-all duration-200 relative group ${formData.neuro_profile === profile.id
                                            ? `${profile.color} shadow-md scale-[1.02]`
                                            : 'border-subtle hover:border-subtle bg-surface'
                                            }`}
                                    >
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-sm font-semibold tracking-wider">{profile.label}</span>
                                            {formData.neuro_profile === profile.id && (
                                                <div className="w-4 h-4 rounded-full bg-current flex items-center justify-center p-0.5">
                                                    <div className="w-full h-full rounded-full bg-surface" />
                                                </div>
                                            )}
                                        </div>
                                        <p className={`text-[10px] font-semibold uppercase tracking-widest ${formData.neuro_profile === profile.id ? 'opacity-80' : 'text-tertiary opacity-60'}`}>
                                            {profile.focus}
                                        </p>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="pt-6 border-t">
                            <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                                <Target className="w-5 h-5 text-accent" />
                                Custom Screening Questions
                            </h3>
                            <p className="text-sm text-secondary mb-6">
                                Add specific questions to filter candidates automatically based on your requirements.
                            </p>

                            <div className="space-y-6">
                                {screeningQuestions.map((q, qIndex) => (
                                    <div key={q.id} className="p-4 bg-surface-sunken rounded-xl border border-subtle relative">
                                        <button
                                            type="button"
                                            onClick={() => removeMCQ(qIndex)}
                                            className="absolute top-4 right-4 text-tertiary hover:text-red-500"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-xs font-semibold text-tertiary uppercase tracking-wider mb-2">Question {qIndex + 1} (Multiple Choice)</label>
                                                <input
                                                    type="text"
                                                    className="input-field"
                                                    placeholder="e.g. Years of experience in React?"
                                                    value={q.text}
                                                    onChange={e => updateMCQ(qIndex, 'text', e.target.value)}
                                                />
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                                {q.options.map((opt: string, oIndex: number) => (
                                                    <div key={oIndex} className="relative">
                                                        <input
                                                            type="text"
                                                            className={`w-full pl-3 pr-8 py-2 text-sm border rounded-lg outline-none transition ${q.correctIndex === oIndex ? 'border-green-500 bg-green-50' : 'border-subtle focus:border-indigo-500'}`}
                                                            placeholder={`Option ${oIndex + 1}`}
                                                            value={opt}
                                                            onChange={e => updateMCQOption(qIndex, oIndex, e.target.value)}
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => updateMCQ(qIndex, 'correctIndex', oIndex)}
                                                            className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full transition ${q.correctIndex === oIndex ? 'text-green-600 bg-surface shadow-sm' : 'text-tertiary hover:text-secondary'}`}
                                                            title="Mark as expected answer"
                                                        >
                                                            <CheckCircle className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                {screeningQuestions.length < 3 && (
                                    <button
                                        type="button"
                                        onClick={addMCQ}
                                        className="w-full py-3 border-2 border-dashed border-subtle rounded-xl text-sm font-medium text-secondary hover:border-indigo-300 hover:text-accent transition flex items-center justify-center gap-2"
                                    >
                                        <Plus className="w-4 h-4" />
                                        Add Multi-Choice Question
                                    </button>
                                )}

                                <div className="p-4 bg-accent/10 rounded-xl border border-accent/20">
                                    <label className="block text-xs font-semibold text-accent uppercase tracking-wider mb-2">Final Open-Ended Question</label>
                                    <input
                                        type="text"
                                        className="input-field bg-surface"
                                        placeholder="e.g. Why are you interested in this role?"
                                        value={openEndedQuestion.text}
                                        onChange={e => setOpenEndedQuestion({ ...openEndedQuestion, text: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 border-t flex justify-end gap-3">
                            <Link href="/dashboard/positions" className="btn-secondary">
                                Cancel
                            </Link>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="btn-primary flex items-center gap-2"
                            >
                                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                Create Position
                            </button>
                        </div>
                    </form>
                </div>
            </main>
        </div>
    );
}
