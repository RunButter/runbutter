'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation'; import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { Users, Search, Filter, Mail, ExternalLink, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function CandidatesPage() {
    const router = useRouter();
    const { ready, authenticated, user } = usePrivy();
    const [loading, setLoading] = useState(true);
    const [searching, setSearching] = useState(false);
    const [candidates, setCandidates] = useState<any[]>([]);
    const searchParams = useSearchParams();
    const [searchTerm, setSearchTerm] = useState(searchParams.get('q') || '');
    // Auth gate only — data loading is handled by the debounced effect below.
    useEffect(() => {
        if (ready && !authenticated) {
            router.push('/auth/login');
        }
    }, [ready, authenticated, router]);

    // Debounced, server-side Boolean resume search (native Postgres FTS).
    // Runs on first auth-ready (empty query => full list) and on every keystroke.
    useEffect(() => {
        if (!ready || !authenticated || !user) return;
        const isSearch = searchTerm.trim().length > 0;
        if (isSearch) setSearching(true);
        const t = setTimeout(() => {
            loadCandidates(user.id, searchTerm.trim());
        }, isSearch ? 300 : 0);
        return () => clearTimeout(t);
    }, [searchTerm, ready, authenticated, user]);

    const loadCandidates = async (privyUserId: string, query: string = '') => {
        try {
            // Ensure we have a valid Supabase session for Native RLS
            await supabase.auth.getUser();

            await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });

            // Single RPC handles both the full list (empty query) and Boolean
            // keyword search across resume text, ranked by ts_rank.
            const { data, error } = await supabase.rpc('search_candidates_for_recruiter', {
                p_privy_user_id: privyUserId,
                p_query: query || null,
            });

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
            setSearching(false);
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
                    <h1 className="text-xl font-bold text-gray-800">Candidates</h1>                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8">
                <div className="mb-6 flex flex-col md:flex-row gap-4 justify-between">
                    <div className="w-full md:w-[32rem]">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input
                                type="text"
                                placeholder='Search resumes — e.g. react node -junior  or  "node.js" or vue'
                                className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                            {searching && (
                                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary-500 animate-spin" />
                            )}
                        </div>
                        <p className="mt-1.5 text-[11px] text-gray-400 font-mono">
                            space = AND · <span className="text-gray-500">or</span> = OR · <span className="text-gray-500">-term</span> = NOT · "quotes" = exact phrase
                        </p>
                    </div>
                    <div className="text-sm text-gray-500 self-start md:self-center whitespace-nowrap">
                        {candidates.length} {candidates.length === 1 ? 'candidate' : 'candidates'}
                        {searchTerm.trim() && ' matched'}
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
                            {candidates.map((can) => (
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
                            {candidates.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                                        {searchTerm.trim()
                                            ? `No candidates match "${searchTerm.trim()}".`
                                            : 'No candidates found.'}
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
