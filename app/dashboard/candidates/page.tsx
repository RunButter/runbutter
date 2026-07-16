'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { Search, Mail, ExternalLink, Loader2 } from 'lucide-react';
import Link from 'next/link';
import PageHeader from '@/components/dashboard/PageHeader';
import { hrStatus } from '@/lib/hr/overview';
import { rpc } from '@/lib/rpc';

function StatusPill({ status }: { status: string }) {
    const st = hrStatus(status);
    return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ring-1 ${st.cls}`}>{st.label}</span>;
}

function ScoreDot({ score }: { score?: number | null }) {
    if (score === null || score === undefined) return <span className="text-tertiary text-[12px] italic">Pending</span>;
    return <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-accent/10 ring-1 ring-accent/20 text-[12px] font-semibold text-accent tabular-nums">{score || 0}</span>;
}

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
            const { data, error } = await rpc('search_candidates_for_recruiter', {
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

    if (!ready || loading) {
        return <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 text-tertiary animate-spin" /></div>;
    }

    const empty = searchTerm.trim() ? `No candidates match "${searchTerm.trim()}".` : 'No candidates found.';

    return (
        <>
            <PageHeader title="Candidates" count={candidates.length}>
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-tertiary" />
                    <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder='Search resumes — react node -junior  or  "node.js"'
                        className="h-8 w-[22rem] max-w-[52vw] pl-8 pr-8 text-[13px] rounded-lg bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-primary-500 outline-none" />
                    {searching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary-500 animate-spin" />}
                </div>
            </PageHeader>

            {/* Search-syntax hint */}
            <div className="px-4 py-1.5 border-b border-subtle bg-surface-sunken/40 text-[11px] text-tertiary font-mono">
                space = AND · <span className="text-secondary">or</span> = OR · <span className="text-secondary">-term</span> = NOT · "quotes" = exact phrase
            </div>

            <div className="p-6">
                {/* Mobile: card list */}
                <div className="md:hidden space-y-2.5">
                    {candidates.map((can) => (
                        <Link key={can.id} href={`/dashboard/candidates/${can.id}`}
                            className="block rounded-xl bg-surface ring-1 ring-subtle p-4 active:bg-surface-sunken transition">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="font-semibold text-primary truncate">{can.full_name}</div>
                                    <div className="flex items-center gap-1 text-[12px] text-tertiary truncate"><Mail className="w-3 h-3 shrink-0" /> <span className="truncate">{can.email}</span></div>
                                </div>
                                <StatusPill status={can.status} />
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-3">
                                <span className="text-[13px] text-secondary truncate">{can.position?.title || '—'}</span>
                                <ScoreDot score={can.assessment_results?.[0]?.overall_score} />
                            </div>
                        </Link>
                    ))}
                    {candidates.length === 0 && (
                        <div className="rounded-xl ring-1 ring-subtle bg-surface px-6 py-12 text-center text-tertiary text-[13px]">{empty}</div>
                    )}
                </div>

                {/* Desktop: table */}
                <div className="hidden md:block rounded-xl bg-surface ring-1 ring-subtle overflow-hidden">
                    <table className="w-full text-[13px] border-separate border-spacing-0">
                        <thead>
                            <tr>
                                {[['Candidate', 'left'], ['Position', 'left'], ['Score', 'center'], ['Screening', 'left'], ['Applied', 'left'], ['Status', 'left'], ['', 'right']].map(([h, a], i) => (
                                    <th key={i} className={`bg-surface-sunken/60 px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-tertiary border-b border-subtle ${a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left'}`}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {candidates.map((can) => {
                                const ar = can.assessment_results?.[0];
                                const sc = ar?.screening_score;
                                return (
                                    <tr key={can.id} className="group hover:bg-surface-sunken/70 transition-colors cursor-pointer" onClick={() => router.push(`/dashboard/candidates/${can.id}`)}>
                                        <td className="px-4 h-[56px] border-b border-subtle">
                                            <div className="font-semibold text-primary">{can.full_name}</div>
                                            <div className="flex items-center gap-1 text-[11px] text-tertiary"><Mail className="w-3 h-3" /> {can.email}</div>
                                        </td>
                                        <td className="px-4 h-[56px] border-b border-subtle text-secondary">{can.position?.title || '—'}</td>
                                        <td className="px-4 h-[56px] border-b border-subtle text-center"><ScoreDot score={ar?.overall_score} /></td>
                                        <td className="px-4 h-[56px] border-b border-subtle">
                                            {sc !== null && sc !== undefined ? (
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex justify-between items-center text-[10px] font-semibold tracking-wider text-tertiary"><span>MATCH</span><span className="tabular-nums">{sc}%</span></div>
                                                    <div className="w-24 h-1.5 bg-surface-hover rounded-full overflow-hidden">
                                                        <div className={`h-full rounded-full transition-all duration-700 ${sc >= 66 ? 'bg-emerald-500' : sc >= 33 ? 'bg-amber-400' : 'bg-rose-500'}`} style={{ width: `${sc}%` }} />
                                                    </div>
                                                </div>
                                            ) : <span className="text-tertiary text-[12px] italic">N/A</span>}
                                        </td>
                                        <td className="px-4 h-[56px] border-b border-subtle text-secondary tabular-nums">{can.applied_at ? new Date(can.applied_at).toLocaleDateString() : '—'}</td>
                                        <td className="px-4 h-[56px] border-b border-subtle"><StatusPill status={can.status} /></td>
                                        <td className="px-4 h-[56px] border-b border-subtle text-right">
                                            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-tertiary group-hover:text-accent transition-colors">View <ExternalLink className="w-3 h-3" /></span>
                                        </td>
                                    </tr>
                                );
                            })}
                            {candidates.length === 0 && (
                                <tr><td colSpan={7} className="px-4 py-16 text-center text-tertiary">{empty}</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
}
