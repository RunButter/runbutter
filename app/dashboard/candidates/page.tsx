'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { Users, Search, Filter, Mail, ExternalLink, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function CandidatesPage() {
    const router = useRouter();
    const { ready, authenticated, user } = usePrivy();
    const [loading, setLoading] = useState(true);
    const [candidates, setCandidates] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        if (ready) {
            if (!authenticated) {
                router.push('/auth/login');
            } else if (user) {
                loadCandidates(user.id);
            }
        }
    }, [ready, authenticated, user, router]);

    const loadCandidates = async (privyUserId: string) => {
        try {
            // Ensure we have a valid Supabase session for Native RLS
            await supabase.auth.getUser();

            await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });

            const { data: companyUser } = await supabase
                .from('company_users')
                .select('company_id')
                .eq('privy_user_id', privyUserId)
                .single();

            if (!companyUser) return;

            const { data, error } = await supabase.rpc('get_candidates_for_recruiter', { p_privy_user_id: privyUserId });

            if (error) throw error;

            // Map the data if necessary (the RPC returns normalized fields)
            const mappedData = (data || []).map((c: any) => ({
                ...c,
                position: { title: c.position_title },
                assessment_results: c.assessment_results || []
            }));

            setCandidates(mappedData);
        } catch (error) {
            console.error('Error loading candidates:', error);
        } finally {
            setLoading(false);
        }
    };

    const getStatusBadge = (status: string) => {
        const statusMap: Record<string, { bg: string; text: string; label: string }> = {
            applied: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Applied' },
            screening: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Screening' },
            assessment_sent: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Assessed' },
            hired: { bg: 'bg-green-100', text: 'text-green-800', label: 'Hired' },
        };
        const config = statusMap[status] || statusMap.applied;
        return <span className={`px-2 py-1 text-xs font-semibold rounded-full ${config.bg} ${config.text}`}>{config.label}</span>;
    };

    const filteredCandidates = candidates.filter(c =>
        c.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.email.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (!ready || loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-primary-600 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white border-b">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-2">
                    <Link href="/dashboard" className="text-gray-500 hover:text-gray-700">Dashboard</Link>
                    <span className="text-gray-400">/</span>
                    <h1 className="text-xl font-bold text-gray-800">Candidates <span className="text-[10px] ml-2 text-gray-300">v4.4</span></h1>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8">
                <div className="mb-6 flex flex-col md:flex-row gap-4 justify-between">
                    <div className="relative w-full md:w-96">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by name or email..."
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="px-6 py-4 text-sm font-semibold text-gray-600">Candidate</th>
                                <th className="px-6 py-4 text-sm font-semibold text-gray-600">Position</th>
                                <th className="px-6 py-4 text-sm font-semibold text-gray-600 text-center">Score</th>
                                <th className="px-6 py-4 text-sm font-semibold text-gray-600">Screening</th>
                                <th className="px-6 py-4 text-sm font-semibold text-gray-600">Applied Date</th>
                                <th className="px-6 py-4 text-sm font-semibold text-gray-600">Status</th>
                                <th className="px-6 py-4 text-sm font-semibold text-gray-600 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {filteredCandidates.map((can) => (
                                <tr key={can.id} className="hover:bg-gray-50 transition">
                                    <td className="px-6 py-4">
                                        <div className="font-semibold text-gray-800">{can.full_name}</div>
                                        <div className="flex items-center gap-1 text-xs text-gray-500">
                                            <Mail className="w-3 h-3" /> {can.email}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-600">{can.position?.title || '—'}</td>
                                    <td className="px-6 py-4 text-center">
                                        {can.assessment_results && can.assessment_results.length > 0 ? (
                                            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-indigo-50 border-2 border-indigo-100 text-xs font-black text-indigo-700">
                                                {can.assessment_results[0].overall_score || 0}
                                            </div>
                                        ) : (
                                            <span className="text-gray-300 text-xs italic">Pending</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">
                                        {can.assessment_results && can.assessment_results.length > 0 && can.assessment_results[0].screening_score !== null && can.assessment_results[0].screening_score !== undefined ? (
                                            <div className="flex flex-col gap-1.5">
                                                <div className="flex justify-between items-center text-[10px] font-black tracking-widest text-gray-400">
                                                    <span>MATCH</span>
                                                    <span>{can.assessment_results[0].screening_score}%</span>
                                                </div>
                                                <div className="w-24 h-2 bg-gray-50 rounded-full overflow-hidden border border-gray-100 flex shadow-inner">
                                                    <div
                                                        className={`h-full rounded-full transition-all duration-1000 ${can.assessment_results[0].screening_score >= 66 ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' :
                                                            can.assessment_results[0].screening_score >= 33 ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.4)]' :
                                                                'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]'
                                                            }`}
                                                        style={{ width: `${can.assessment_results[0].screening_score}%` }}
                                                    />
                                                </div>
                                            </div>
                                        ) : (
                                            <span className="text-gray-300 text-xs italic">N/A</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-600">
                                        {new Date(can.applied_at).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4">
                                        {getStatusBadge(can.status)}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <Link href={`/dashboard/candidates/${can.id}`} className="btn-secondary py-1 text-xs inline-flex items-center gap-1">
                                            View Details
                                            <ExternalLink className="w-3 h-3" />
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                            {filteredCandidates.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                                        No candidates found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </main>
        </div>
    );
}
