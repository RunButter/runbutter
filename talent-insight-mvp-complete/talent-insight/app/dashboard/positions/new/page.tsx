'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { Briefcase, ArrowLeft, Loader2, Globe, Building2 } from 'lucide-react';
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
    });

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

            const { data: position, error: postError } = await supabase
                .from('positions')
                .insert({
                    company_id: companyUser.company_id,
                    title: formData.title,
                    description: formData.description,
                    department: formData.department,
                    location: formData.location,
                    employment_type: formData.employment_type,
                    created_by: companyUser.id,
                    is_active: true
                })
                .select()
                .single();

            if (postError) throw postError;

            // Create default assessment for this position
            await supabase.from('assessment_templates').insert({
                company_id: companyUser.company_id,
                position_id: position.id,
                name: `${formData.title} Assessment`,
                description: `Standard assessment for ${formData.title}`,
                questions: [
                    { id: '1', category: 'personality', trait: 'Extraversion', text: 'I enjoy interacting with people', type: 'scale', options: ['1', '2', '3', '4', '5'] },
                    { id: '2', category: 'work_style', text: 'I prefer working in a structured environment', type: 'scale', options: ['1', '2', '3', '4', '5'] }
                ],
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
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-primary-600 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white border-b">
                <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-4">
                    <Link href="/dashboard/positions" className="p-2 hover:bg-gray-100 rounded-lg">
                        <ArrowLeft className="w-5 h-5 text-gray-600" />
                    </Link>
                    <h1 className="text-xl font-bold text-gray-800">Create New Position</h1>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-6 py-8">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
                    {error && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="col-span-2">
                                <label className="block text-sm font-medium text-gray-700 mb-2">Job Title</label>
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
                                <label className="block text-sm font-medium text-gray-700 mb-2">Department</label>
                                <div className="relative">
                                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
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
                                <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
                                <div className="relative">
                                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
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
                                <label className="block text-sm font-medium text-gray-700 mb-2">Employment Type</label>
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
                            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                            <textarea
                                className="input-field min-h-[150px]"
                                placeholder="Describe the role, responsibilities, and requirements..."
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                            />
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
