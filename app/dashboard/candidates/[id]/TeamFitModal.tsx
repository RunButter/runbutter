'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';
// Shared Chart.js module — registration lives there so this file adds no
// charting weight of its own (and the whole modal is dynamically imported).
import { Radar } from '@/components/charts/Charts';
import { useChartTokens } from '@/lib/chart-tokens';

const BIG5 = [
    { key: 'openness', label: 'Openness' },
    { key: 'conscientiousness', label: 'Conscientiousness' },
    { key: 'extraversion', label: 'Extraversion' },
    { key: 'agreeableness', label: 'Agreeableness' },
    { key: 'neuroticism', label: 'Neuroticism' },
] as const;

interface Props {
    candidate: any;
    results: any;
    treasury: any[] | null;
    loading: boolean;
    onClose: () => void;
}

// Pre-hire Team Fit Simulator: mock-inserts the candidate into an existing
// group (hired team, or candidates by position) and visualises personality
// mesh vs friction. All computed client-side — no LLM, no extra cost.
export default function TeamFitModal({ candidate, results, treasury, loading, onClose }: Props) {
    const chart = useChartTokens();
    const candVals = BIG5.map((t) => Number(results?.personality_data?.[t.key] ?? 0));

    const teams = useMemo(() => {
        const rows = (treasury || []).filter(
            (r: any) => r.id !== candidate.id && r.has_assessment && r.big5_conscientiousness != null
        );
        const opts: { key: string; label: string; rows: any[] }[] = [];
        const hired = rows.filter((r: any) => r.status === 'hired');
        if (hired.length) opts.push({ key: 'hired', label: `Hired team (${hired.length})`, rows: hired });
        const byPos = new Map<string, any[]>();
        rows.forEach((r: any) => {
            if (!r.position_id) return;
            const arr = byPos.get(r.position_id) || [];
            arr.push(r); byPos.set(r.position_id, arr);
        });
        byPos.forEach((arr) => opts.push({
            key: `pos:${arr[0].position_id}`,
            label: `${arr[0].position_title || 'Position'} (${arr.length})`,
            rows: arr,
        }));
        return opts;
    }, [treasury, candidate.id]);

    const [teamKey, setTeamKey] = useState('');
    useEffect(() => { if (!teamKey && teams.length) setTeamKey(teams[0].key); }, [teams, teamKey]);
    const team = teams.find((t) => t.key === teamKey);

    const teamAvg = useMemo(() => {
        if (!team) return null;
        return BIG5.map((t) => {
            const vals = team.rows.map((r: any) => Number(r[`big5_${t.key}`])).filter((v: number) => !isNaN(v));
            return vals.length ? Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length) : 0;
        });
    }, [team]);

    const analysis = useMemo(() => {
        if (!teamAvg) return null;
        const deltas = BIG5.map((t, i) => {
            const delta = candVals[i] - teamAvg[i];
            const abs = Math.abs(delta);
            const tag = abs <= 15 ? 'Aligned' : abs <= 35 ? 'Complementary' : 'Potential friction';
            return { key: t.key, label: t.label, cand: candVals[i], team: teamAvg[i], delta, tag };
        });
        const meanAbs = deltas.reduce((s, d) => s + Math.abs(d.delta), 0) / deltas.length;
        const synergy = Math.max(0, Math.min(100, Math.round(100 - meanAbs)));
        const sorted = [...deltas].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        return { deltas, synergy, biggest: sorted[0], closest: sorted[sorted.length - 1] };
    }, [teamAvg, candVals]);

    const radarData = teamAvg && chart ? {
        labels: BIG5.map((t) => t.label),
        datasets: [
            { label: 'Candidate', data: candVals, backgroundColor: chart.accentFill, borderColor: chart.accent, borderWidth: 2, pointRadius: 3 },
            { label: 'Team average', data: teamAvg, backgroundColor: chart.successFill, borderColor: chart.success, borderWidth: 2, borderDash: [5, 5], pointRadius: 0 },
        ],
    } : null;

    const radarOptions: any = {
        scales: {
            r: {
                angleLines: { color: chart?.grid }, grid: { color: chart?.grid },
                pointLabels: { font: { size: 10, weight: 500 }, color: chart?.label },
                suggestedMin: 0, suggestedMax: 100, ticks: { display: false },
            },
        },
        plugins: { legend: { display: false } },
        maintainAspectRatio: false,
    };

    const tagColor = (tag: string) =>
        tag === 'Aligned' ? 'bg-success/10 text-success'
            : tag === 'Complementary' ? 'bg-accent/10 text-accent'
                : 'bg-warning/10 text-warning';

    const isHigher = analysis ? analysis.biggest.delta > 0 : false;
    const synergyColor = analysis && analysis.synergy >= 66 ? 'text-success'
        : analysis && analysis.synergy >= 40 ? 'text-warning' : 'text-danger';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
            <div className="bg-surface rounded-2xl shadow-popover w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-6 border-b border-subtle">
                    <div>
                        <h3 className="text-xl font-semibold text-primary flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-accent" /> Team Fit Simulator
                        </h3>
                        <p className="text-sm text-secondary">See how this candidate&apos;s personality meshes with an existing team.</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-hover text-tertiary"><X className="w-5 h-5" /></button>
                </div>

                <div className="p-6">
                    {loading ? (
                        <div className="py-20 flex items-center justify-center"><Loader2 className="w-8 h-8 text-accent animate-spin" /></div>
                    ) : !results?.personality_data ? (
                        <p className="py-12 text-center text-tertiary">This candidate has no personality data to simulate.</p>
                    ) : teams.length === 0 ? (
                        <p className="py-12 text-center text-tertiary">No other assessed candidates yet to build a team profile from.</p>
                    ) : (
                        <>
                            <div className="mb-5">
                                <label className="block text-xs font-semibold text-secondary mb-1">Mock-insert into team</label>
                                <select value={teamKey} onChange={(e) => setTeamKey(e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-subtle rounded-lg bg-surface focus:ring-2 focus:ring-accent/30 outline-none">
                                    {teams.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                                </select>
                            </div>

                            <div className="grid md:grid-cols-2 gap-6 items-center">
                                <div className="h-[280px]">{radarData && <Radar data={radarData} options={radarOptions} />}</div>
                                <div>
                                    <div className="flex items-center gap-4 mb-4">
                                        <div className="text-center">
                                            <div className={`text-5xl font-semibold ${synergyColor}`}>
                                                {analysis ? analysis.synergy : 0}<span className="text-2xl">%</span>
                                            </div>
                                            <div className="text-3xs font-medium uppercase tracking-widest text-tertiary">Synergy</div>
                                        </div>
                                        {analysis && (
                                            <p className="text-sm text-secondary flex-1">
                                                Closest alignment on <b>{analysis.closest.label}</b>. Biggest divergence on <b>{analysis.biggest.label}</b> ({isHigher ? 'higher' : 'lower'} than the team) — {analysis.biggest.tag.toLowerCase()}.
                                            </p>
                                        )}
                                    </div>
                                    <div className="space-y-1.5">
                                        {analysis && analysis.deltas.map((d) => (
                                            <div key={d.key} className="flex items-center justify-between text-xs">
                                                <span className="text-secondary font-medium">{d.label}</span>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono text-tertiary">{d.cand} vs {d.team}</span>
                                                    <span className={`px-2 py-0.5 rounded-full font-semibold ${tagColor(d.tag)}`}>{d.tag}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <p className="mt-5 text-2xs text-tertiary">
                                Synergy reflects overall personality proximity to the team average. &quot;Complementary&quot; gaps can be healthy — diversity of traits often strengthens a team.
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
