'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { Search, Mail, ExternalLink, Loader2, Plus, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import PageHeader from '@/components/dashboard/PageHeader';
import Button from '@/components/ui/Button';
import { useDialog } from '@/components/ui/Dialog';
import { hrStatus } from '@/lib/hr/overview';
import { createCandidate, deleteCandidate, listPositionsMin, type PositionMin } from '@/lib/hr/manage';
import { rpc } from '@/lib/rpc';

function StatusPill({ status }: { status: string }) {
    const st = hrStatus(status);
    return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-2xs font-semibold ring-1 ${st.cls}`}>{st.label}</span>;
}

function ScoreDot({ score }: { score?: number | null }) {
    if (score === null || score === undefined) return <span className="text-tertiary text-xs italic">Pending</span>;
    return <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-accent/10 ring-1 ring-accent/20 text-xs font-semibold text-accent tabular-nums">{score || 0}</span>;
}

export default function CandidatesPage() {
    const router = useRouter();
    const { confirm: confirmDialog, notify } = useDialog();
    const { ready, authenticated, user } = usePrivy();
    const [loading, setLoading] = useState(true);
    const [searching, setSearching] = useState(false);
    const [candidates, setCandidates] = useState<any[]>([]);
    const [adding, setAdding] = useState(false);
    const searchParams = useSearchParams();
    const [searchTerm, setSearchTerm] = useState(searchParams.get('q') || '');

    const removeCandidate = async (e: React.MouseEvent, can: any) => {
        e.stopPropagation();
        if (!user) return;
        if (!(await confirmDialog({ title: `Delete ${can.full_name}?`, body: 'This removes the candidate and all their assessments and interviews. This cannot be undone.', danger: true }))) return;
        const { error } = await deleteCandidate(user.id, can.id);
        if (error) { notify(error); return; }
        setCandidates((cs) => cs.filter((c) => c.id !== can.id));
    };
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
                        className="h-8 w-[18rem] max-w-[44vw] pl-8 pr-8 text-sm rounded-lg bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none" />
                    {searching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-accent animate-spin" />}
                </div>
                <Button size="sm" variant="primary" onClick={() => setAdding(true)} disabled={!user}>
                    <Plus className="w-3.5 h-3.5" /> New candidate
                </Button>
            </PageHeader>

            {/* Search-syntax hint */}
            <div className="px-4 py-1.5 border-b border-subtle bg-surface-sunken/40 text-2xs text-tertiary font-mono">
                space = AND · <span className="text-secondary">or</span> = OR · <span className="text-secondary">-term</span> = NOT · "quotes" = exact phrase
            </div>

            <div className="p-6">
                {/* Mobile: card list */}
                <div className="md:hidden space-y-2.5">
                    {candidates.map((can) => (
                        <Link key={can.id} href={`/dashboard/candidates/${can.id}`}
                            className="block rounded-xl bg-surface ring-1 ring-subtle shadow-card p-4 active:bg-surface-sunken transition">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="font-semibold text-primary truncate">{can.full_name}</div>
                                    <div className="flex items-center gap-1 text-xs text-tertiary truncate"><Mail className="w-3 h-3 shrink-0" /> <span className="truncate">{can.email}</span></div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <StatusPill status={can.status} />
                                    <button onClick={(e) => { e.preventDefault(); removeCandidate(e, can); }} aria-label="Delete candidate" className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10"><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-3">
                                <span className="text-sm text-secondary truncate">{can.position?.title || '—'}</span>
                                <ScoreDot score={can.assessment_results?.[0]?.overall_score} />
                            </div>
                        </Link>
                    ))}
                    {candidates.length === 0 && (
                        <div className="rounded-xl ring-1 ring-subtle bg-surface px-6 py-12 text-center text-tertiary text-sm">{empty}</div>
                    )}
                </div>

                {/* Desktop: table */}
                <div className="hidden md:block rounded-xl bg-surface ring-1 ring-subtle shadow-card overflow-hidden">
                    <table className="w-full text-sm border-separate border-spacing-0">
                        <thead>
                            <tr>
                                {[['Candidate', 'left'], ['Position', 'left'], ['Score', 'center'], ['Screening', 'left'], ['Applied', 'left'], ['Status', 'left'], ['', 'right']].map(([h, a], i) => (
                                    <th key={i} className={`bg-surface-sunken/60 px-4 h-9 text-2xs font-semibold uppercase tracking-wider text-tertiary border-b border-subtle ${a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left'}`}>{h}</th>
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
                                            <div className="flex items-center gap-1 text-2xs text-tertiary"><Mail className="w-3 h-3" /> {can.email}</div>
                                        </td>
                                        <td className="px-4 h-[56px] border-b border-subtle text-secondary">{can.position?.title || '—'}</td>
                                        <td className="px-4 h-[56px] border-b border-subtle text-center"><ScoreDot score={ar?.overall_score} /></td>
                                        <td className="px-4 h-[56px] border-b border-subtle">
                                            {sc !== null && sc !== undefined ? (
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex justify-between items-center text-3xs font-semibold tracking-wider text-tertiary"><span>MATCH</span><span className="tabular-nums">{sc}%</span></div>
                                                    <div className="w-24 h-1.5 bg-surface-hover rounded-full overflow-hidden">
                                                        <div className={`h-full rounded-full transition-all duration-700 ${sc >= 66 ? 'bg-success' : sc >= 33 ? 'bg-warning' : 'bg-danger'}`} style={{ width: `${sc}%` }} />
                                                    </div>
                                                </div>
                                            ) : <span className="text-tertiary text-xs italic">N/A</span>}
                                        </td>
                                        <td className="px-4 h-[56px] border-b border-subtle text-secondary tabular-nums">{can.applied_at ? new Date(can.applied_at).toLocaleDateString() : '—'}</td>
                                        <td className="px-4 h-[56px] border-b border-subtle"><StatusPill status={can.status} /></td>
                                        <td className="px-4 h-[56px] border-b border-subtle text-right" onClick={(e) => e.stopPropagation()}>
                                            <div className="inline-flex items-center gap-1">
                                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-tertiary group-hover:text-accent transition-colors cursor-pointer" onClick={() => router.push(`/dashboard/candidates/${can.id}`)}>View <ExternalLink className="w-3 h-3" /></span>
                                                <button onClick={(e) => removeCandidate(e, can)} aria-label="Delete candidate" className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                                            </div>
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

            {adding && user && (
                <AddCandidateModal privy={user.id} onClose={() => setAdding(false)}
                    onAdded={() => { setAdding(false); if (user) loadCandidates(user.id, searchTerm.trim()); }} />
            )}
        </>
    );
}

function AddCandidateModal({ privy, onClose, onAdded }: { privy: string; onClose: () => void; onAdded: () => void }) {
    const { notify } = useDialog();
    const [positions, setPositions] = useState<PositionMin[]>([]);
    const [form, setForm] = useState({ full_name: '', email: '', phone: '', linkedin: '', position_id: '' });
    const [busy, setBusy] = useState(false);
    const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

    useEffect(() => { listPositionsMin(privy).then(setPositions); }, [privy]);

    const submit = async () => {
        if (!form.full_name.trim() || !form.email.trim()) return;
        setBusy(true);
        const { error } = await createCandidate(privy, form.full_name, form.email, form.phone, form.linkedin, form.position_id || null);
        setBusy(false);
        if (error) { notify(error); return; }
        onAdded();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
            <div className="bg-surface border border-subtle rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                <div className="h-12 flex items-center justify-between px-4 border-b border-subtle">
                    <h3 className="text-sm font-medium text-primary">New candidate</h3>
                    <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
                </div>
                <div className="p-4 space-y-3">
                    <label className="block"><span className="block text-xs font-medium text-secondary mb-1">Full name <span className="text-danger">*</span></span>
                        <input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} className="input-field" placeholder="Anna Kowalski" /></label>
                    <label className="block"><span className="block text-xs font-medium text-secondary mb-1">Email <span className="text-danger">*</span></span>
                        <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className="input-field" placeholder="anna@example.com" /></label>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="block"><span className="block text-xs font-medium text-secondary mb-1">Phone</span>
                            <input value={form.phone} onChange={(e) => set('phone', e.target.value)} className="input-field" /></label>
                        <label className="block"><span className="block text-xs font-medium text-secondary mb-1">LinkedIn</span>
                            <input value={form.linkedin} onChange={(e) => set('linkedin', e.target.value)} className="input-field" placeholder="URL" /></label>
                    </div>
                    <label className="block"><span className="block text-xs font-medium text-secondary mb-1">Position <span className="text-tertiary">(optional)</span></span>
                        <select value={form.position_id} onChange={(e) => set('position_id', e.target.value)} className="input-field">
                            <option value="">No position</option>
                            {positions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                        </select></label>
                </div>
                <div className="h-14 flex items-center justify-end gap-2 px-4 border-t border-subtle">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button variant="primary" disabled={busy || !form.full_name.trim() || !form.email.trim()} onClick={submit}>
                        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Add candidate
                    </Button>
                </div>
            </div>
        </div>
    );
}
