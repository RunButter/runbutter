'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import {
    Search, X, SlidersHorizontal, Loader2, Mail, ExternalLink,
    Users, Gauge, Sparkles, RotateCcw, ArrowUpDown,
} from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import { hrStatus } from '@/lib/hr/overview';

// Psychometric dimensions the sliders filter on (discrete 0-100 score columns).
const DIMS = [
    { key: 'overall_score', label: 'Overall Match', accent: 'bg-indigo-500' },
    { key: 'screening_score', label: 'Screening Fit', accent: 'bg-emerald-500' },
    { key: 'cognitive_score', label: 'Cognitive', accent: 'bg-sky-500' },
    { key: 'personality_score', label: 'Personality', accent: 'bg-violet-500' },
    { key: 'work_style_score', label: 'Work Style', accent: 'bg-amber-500' },
] as const;

const SORTS = [
    { key: 'overall_score', label: 'Highest Match' },
    { key: 'cognitive_score', label: 'Highest Cognitive' },
    { key: 'screening_score', label: 'Best Screening Fit' },
    { key: 'recent', label: 'Most Recent' },
] as const;

const titleize = (s: string) =>
    (s || 'unknown').replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const scoreColor = (v: number | null) =>
    v == null ? 'text-slate-300'
        : v >= 66 ? 'text-emerald-600'
            : v >= 33 ? 'text-amber-500'
                : 'text-rose-500';

export default function TreasuryPage() {
    const router = useRouter();
    const { ready, authenticated, user } = usePrivy();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any[]>([]);

    // ---- filter state (all client-side -> instant) ----
    const [mins, setMins] = useState<Record<string, number>>(
        Object.fromEntries(DIMS.map((d) => [d.key, 0]))
    );
    const [sources, setSources] = useState<Set<string>>(new Set());
    const [statuses, setStatuses] = useState<Set<string>>(new Set());
    const [positions, setPositions] = useState<Set<string>>(new Set());
    const [keyword, setKeyword] = useState('');
    const [sortKey, setSortKey] = useState<string>('overall_score');

    useEffect(() => {
        if (!ready) return;
        if (!authenticated) { router.push('/auth/login'); return; }
        if (user) loadDataset(user.id);
    }, [ready, authenticated, user, router]);

    const loadDataset = async (privyUserId: string) => {
        try {
            await supabase.auth.getUser();
            await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
            const { data: rows, error } = await supabase.rpc('get_treasury_dataset', { p_privy_user_id: privyUserId });
            if (error) throw error;
            setData(rows || []);
        } catch (e) {
            console.error('Error loading treasury dataset:', e);
        } finally {
            setLoading(false);
        }
    };

    // ---- derived: facet option counts from the full dataset ----
    const facets = useMemo(() => {
        const src = new Map<string, number>();
        const st = new Map<string, number>();
        const pos = new Map<string, { title: string; count: number }>();
        for (const r of data) {
            const s = r.source || 'unknown';
            src.set(s, (src.get(s) || 0) + 1);
            st.set(r.status, (st.get(r.status) || 0) + 1);
            if (r.position_id) {
                const prev = pos.get(r.position_id);
                pos.set(r.position_id, { title: r.position_title || 'Untitled', count: (prev?.count || 0) + 1 });
            }
        }
        return {
            sources: [...src.entries()].sort((a, b) => b[1] - a[1]),
            statuses: [...st.entries()].sort((a, b) => b[1] - a[1]),
            positions: [...pos.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.count - a.count),
        };
    }, [data]);

    // ---- derived: filtered + sorted candidates ----
    const filtered = useMemo(() => {
        let rows = data;
        const k = keyword.trim().toLowerCase();
        if (k) {
            rows = rows.filter((r) =>
                (r.full_name || '').toLowerCase().includes(k) ||
                (r.email || '').toLowerCase().includes(k) ||
                (r.position_title || '').toLowerCase().includes(k)
            );
        }
        rows = rows.filter((r) => DIMS.every((d) => mins[d.key] === 0 || (r[d.key] ?? -1) >= mins[d.key]));
        if (sources.size) rows = rows.filter((r) => sources.has(r.source || 'unknown'));
        if (statuses.size) rows = rows.filter((r) => statuses.has(r.status));
        if (positions.size) rows = rows.filter((r) => r.position_id && positions.has(r.position_id));

        const sorted = [...rows].sort((a, b) => {
            if (sortKey === 'recent') {
                return new Date(b.applied_at).getTime() - new Date(a.applied_at).getTime();
            }
            return (b[sortKey] ?? -1) - (a[sortKey] ?? -1);
        });
        return sorted;
    }, [data, keyword, mins, sources, statuses, positions, sortKey]);

    // ---- derived: cost-free micro-insights over the current view ----
    const insights = useMemo(() => {
        const n = filtered.length;
        const avg = (key: string) => {
            const vals = filtered.map((r) => r[key]).filter((v) => v != null) as number[];
            return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
        };
        const srcCount: Record<string, number> = {};
        filtered.forEach((r) => { const s = r.source || 'unknown'; srcCount[s] = (srcCount[s] || 0) + 1; });
        const top = Object.entries(srcCount).sort((a, b) => b[1] - a[1])[0];
        const assessed = filtered.filter((r) => r.has_assessment).length;
        return {
            n,
            avgOverall: avg('overall_score'),
            avgCognitive: avg('cognitive_score'),
            avgPersonality: avg('personality_score'),
            topSource: top ? { name: top[0], pct: n ? Math.round((top[1] / n) * 100) : 0 } : null,
            assessedPct: n ? Math.round((assessed / n) * 100) : 0,
        };
    }, [filtered]);

    // ---- active filter chips ----
    type Chip = { label: string; clear: () => void };
    const chips: Chip[] = [];
    DIMS.forEach((d) => {
        if (mins[d.key] > 0) chips.push({ label: `${d.label} ≥ ${mins[d.key]}`, clear: () => setMins((m) => ({ ...m, [d.key]: 0 })) });
    });
    sources.forEach((s) => chips.push({ label: `Source: ${titleize(s)}`, clear: () => setSources((p) => { const n = new Set(p); n.delete(s); return n; }) }));
    statuses.forEach((s) => chips.push({ label: `Status: ${titleize(s)}`, clear: () => setStatuses((p) => { const n = new Set(p); n.delete(s); return n; }) }));
    positions.forEach((id) => {
        const t = facets.positions.find((p) => p.id === id)?.title || 'Position';
        chips.push({ label: `Role: ${t}`, clear: () => setPositions((p) => { const n = new Set(p); n.delete(id); return n; }) });
    });
    if (keyword.trim()) chips.push({ label: `“${keyword.trim()}”`, clear: () => setKeyword('') });

    const resetAll = () => {
        setMins(Object.fromEntries(DIMS.map((d) => [d.key, 0])));
        setSources(new Set()); setStatuses(new Set()); setPositions(new Set()); setKeyword('');
    };

    const toggle = (set: Set<string>, setter: (s: Set<string>) => void, val: string) => {
        const n = new Set(set); n.has(val) ? n.delete(val) : n.add(val); setter(n);
    };

    if (!ready || loading) {
        return <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 text-slate-300 animate-spin" /></div>;
    }

    return (
        <div className="flex flex-col h-full">
            <PageHeader title="Talent Treasury" count={filtered.length}>
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Filter by name, email, role…"
                        className="h-8 w-52 pl-8 pr-2 text-[13px] rounded-lg bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
                </div>
                <div className="relative">
                    <ArrowUpDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                    <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}
                        className="h-8 pl-8 pr-7 text-[13px] rounded-lg bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none appearance-none cursor-pointer">
                        {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                </div>
            </PageHeader>

            <div className="flex-1 flex overflow-hidden">
                {/* ===== Faceted Sidebar ===== */}
                <aside className="w-64 shrink-0 border-r border-slate-200/70 bg-white overflow-y-auto hidden md:block">
                    <div className="p-4">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                <SlidersHorizontal className="w-3.5 h-3.5" /> Filters
                            </h3>
                            {chips.length > 0 && (
                                <button onClick={resetAll} className="flex items-center gap-1 text-[11px] font-bold text-primary-600 hover:text-primary-700">
                                    <RotateCcw className="w-3 h-3" /> Reset
                                </button>
                            )}
                        </div>

                        {/* Trait sliders */}
                        <div className="space-y-3.5 mb-5">
                            {DIMS.map((d) => (
                                <div key={d.key}>
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-[12px] font-semibold text-slate-600">{d.label}</span>
                                        <span className="text-[11px] font-mono text-slate-400 tabular-nums">min {mins[d.key]}</span>
                                    </div>
                                    <input type="range" min={0} max={100} step={1} value={mins[d.key]}
                                        onChange={(e) => setMins((m) => ({ ...m, [d.key]: Number(e.target.value) }))}
                                        className="w-full accent-primary-600 cursor-pointer" />
                                </div>
                            ))}
                        </div>

                        <FacetGroup title="Source">
                            {facets.sources.map(([s, c]) => (
                                <FacetRow key={s} label={titleize(s)} count={c} checked={sources.has(s)} onChange={() => toggle(sources, setSources, s)} />
                            ))}
                        </FacetGroup>

                        <FacetGroup title="Status">
                            {facets.statuses.map(([s, c]) => (
                                <FacetRow key={s} label={titleize(s)} count={c} checked={statuses.has(s)} onChange={() => toggle(statuses, setStatuses, s)} />
                            ))}
                        </FacetGroup>

                        {facets.positions.length > 0 && (
                            <FacetGroup title="Position">
                                {facets.positions.map((p) => (
                                    <FacetRow key={p.id} label={p.title} count={p.count} checked={positions.has(p.id)} onChange={() => toggle(positions, setPositions, p.id)} />
                                ))}
                            </FacetGroup>
                        )}
                    </div>
                </aside>

                {/* ===== Main column ===== */}
                <div className="flex-1 overflow-y-auto">
                    <div className="p-6 max-w-[1400px] mx-auto">
                        {/* Micro-insights bar */}
                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
                            <Insight icon={Users} label="In view" value={`${insights.n}`} />
                            <Insight icon={Gauge} label="Avg match" value={insights.avgOverall != null ? `${insights.avgOverall}%` : '—'} />
                            <Insight icon={Gauge} label="Avg cognitive" value={insights.avgCognitive != null ? `${insights.avgCognitive}%` : '—'} />
                            <Insight icon={Sparkles} label="Assessed" value={`${insights.assessedPct}%`} />
                            <Insight icon={Users} label="Main source" value={insights.topSource ? `${titleize(insights.topSource.name)} ${insights.topSource.pct}%` : '—'} />
                        </div>

                        {/* Active chips */}
                        {chips.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 mb-4">
                                {chips.map((chip, i) => (
                                    <button key={i} onClick={chip.clear}
                                        className="group flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-md bg-primary-50 ring-1 ring-primary-200/60 text-primary-700 text-[12px] font-semibold hover:bg-primary-100 transition-colors">
                                        {chip.label}
                                        <X className="w-3 h-3 text-primary-400 group-hover:text-primary-700" />
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Candidate grid */}
                        {filtered.length === 0 ? (
                            <div className="text-center py-20 text-slate-400">
                                <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
                                No candidates match the current filters.
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
                                {filtered.map((c) => {
                                    const st = hrStatus(c.status);
                                    return (
                                        <Link key={c.id} href={`/dashboard/candidates/${c.id}`}
                                            className="group rounded-xl bg-white ring-1 ring-slate-200/60 p-4 hover:ring-slate-300 hover:shadow-sm transition-all duration-200">
                                            <div className="flex items-start justify-between gap-3 mb-3">
                                                <div className="min-w-0">
                                                    <div className="font-bold text-slate-800 truncate group-hover:text-primary-700 transition-colors">{c.full_name}</div>
                                                    <div className="flex items-center gap-1 text-[11px] text-slate-400 truncate"><Mail className="w-3 h-3 shrink-0" /> {c.email}</div>
                                                    <div className="text-[12px] text-slate-500 mt-0.5 truncate">{c.position_title || '—'}</div>
                                                </div>
                                                <div className="text-center shrink-0">
                                                    <div className={`text-2xl font-black tabular-nums ${scoreColor(c.overall_score)}`}>{c.overall_score ?? '—'}</div>
                                                    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-300">Match</div>
                                                </div>
                                            </div>

                                            {/* Dimension mini-bars */}
                                            <div className="space-y-1.5 mb-3">
                                                {DIMS.slice(1).map((d) => {
                                                    const v = c[d.key] as number | null;
                                                    return (
                                                        <div key={d.key} className="flex items-center gap-2">
                                                            <span className="w-20 text-[10px] font-semibold text-slate-400 shrink-0">{d.label}</span>
                                                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                <div className={`h-full rounded-full ${d.accent} transition-all duration-500`} style={{ width: `${v ?? 0}%` }} />
                                                            </div>
                                                            <span className="w-7 text-right text-[10px] font-mono text-slate-500 tabular-nums">{v ?? '–'}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                                                <div className="flex items-center gap-2">
                                                    <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded-md ring-1 ${st.cls}`}>{st.label}</span>
                                                    <span className="text-[10px] text-slate-400">{titleize(c.source || 'direct')}</span>
                                                </div>
                                                <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 group-hover:text-primary-600 transition-colors">View <ExternalLink className="w-3 h-3" /></span>
                                            </div>
                                        </Link>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ---------- small presentational components ---------- */

function FacetGroup({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="mb-4 border-t border-slate-100 pt-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">{title}</div>
            <div className="space-y-0.5 max-h-44 overflow-y-auto pr-1">{children}</div>
        </div>
    );
}

function FacetRow({ label, count, checked, onChange }: { label: string; count: number; checked: boolean; onChange: () => void }) {
    return (
        <label className="flex items-center gap-2 py-0.5 cursor-pointer group">
            <input type="checkbox" checked={checked} onChange={onChange} className="w-3.5 h-3.5 rounded border-slate-300 accent-primary-600 cursor-pointer" />
            <span className={`flex-1 text-[12px] truncate ${checked ? 'text-slate-900 font-semibold' : 'text-slate-600'} group-hover:text-slate-900`}>{label}</span>
            <span className="text-[10px] font-mono text-slate-300 tabular-nums">{count}</span>
        </label>
    );
}

function Insight({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
    return (
        <div className="rounded-xl bg-white ring-1 ring-slate-200/60 px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                <Icon className="w-3 h-3" /> {label}
            </div>
            <div className="text-lg font-black text-slate-900 truncate">{value}</div>
        </div>
    );
}
