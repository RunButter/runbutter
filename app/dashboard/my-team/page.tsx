'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { Users, Loader2, AlertTriangle, Heart, ClipboardList, Layers } from 'lucide-react';
import MemberOnboardingModal from './MemberOnboardingModal';
import { vibeLabel } from '@/lib/onboarding';
import { rpc } from '@/lib/rpc';

const MOOD_EMOJI: Record<string, string> = { happy: '😀', balanced: '😐', overwhelmed: '😟' };

const scoreColor = (v: number | null) =>
    v == null ? 'text-tertiary' : v >= 66 ? 'text-emerald-600' : v >= 33 ? 'text-amber-500' : 'text-rose-500';

export default function MyTeamPage() {
    const router = useRouter();
    const { ready, authenticated, user } = usePrivy();
    const [loading, setLoading] = useState(true);
    const [team, setTeam] = useState<any[]>([]);
    const [selected, setSelected] = useState<any>(null);

    useEffect(() => {
        if (!ready) return;
        if (!authenticated) { router.push('/auth/login'); return; }
        if (user) load(user.id);
    }, [ready, authenticated, user, router]);

    const load = async (privyUserId: string) => {
        try {
            await supabase.auth.getUser();
            await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
            const { data, error } = await rpc('get_my_team', { p_privy_user_id: privyUserId });
            if (error) throw error;
            setTeam(data || []);
        } catch (e) {
            console.error('Error loading team:', e);
        } finally {
            setLoading(false);
        }
    };

    // Culture map: group hired members by position, aggregate Big-5 "vibe".
    const cultureMap = useMemo(() => {
        const groups = new Map<string, any[]>();
        team.forEach((m) => {
            const key = m.position_id || 'none';
            const arr = groups.get(key) || []; arr.push(m); groups.set(key, arr);
        });
        const avg = (rows: any[], key: string) => {
            const vals = rows.map((r) => r.personality_data?.[key]).filter((v: any) => v != null) as number[];
            return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
        };
        return [...groups.values()].map((rows) => {
            const big5 = {
                openness: avg(rows, 'openness'),
                conscientiousness: avg(rows, 'conscientiousness'),
                extraversion: avg(rows, 'extraversion'),
                agreeableness: avg(rows, 'agreeableness'),
                neuroticism: avg(rows, 'neuroticism'),
            };
            return {
                name: rows[0].position_title || 'Unassigned',
                headcount: rows.length,
                vibe: vibeLabel(big5),
                avgMatch: Math.round(rows.reduce((s, r) => s + (r.overall_score || 0), 0) / rows.length),
            };
        }).sort((a, b) => b.headcount - a.headcount);
    }, [team]);

    const alerts = team.filter((m) => m.has_alert);

    if (!ready || loading) {
        return <div className="h-full flex items-center justify-center"><Loader2 className="w-10 h-10 text-accent animate-spin" /></div>;
    }

    return (
        <div className="p-5 lg:p-8 max-w-[1200px] mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-semibold tracking-tight text-primary flex items-center gap-2">
                    <Users className="w-5 h-5 text-accent" /> My Team
                </h1>
                <p className="text-sm text-secondary">Your hired team — onboarding, culture fit, and wellbeing.</p>
            </div>

            {team.length === 0 ? (
                <div className="text-center py-20 text-tertiary">
                    <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    No hires yet. Mark a candidate as <span className="font-semibold">Hired</span> and they&apos;ll appear here.
                </div>
            ) : (
                <>
                    {/* Retention alerts */}
                    {alerts.length > 0 && (
                        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                            <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm mb-2">
                                <AlertTriangle className="w-4 h-4" /> Retention alerts ({alerts.length})
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {alerts.map((m) => (
                                    <button key={m.id} onClick={() => setSelected(m)}
                                        className="text-xs font-semibold px-3 py-1 rounded-full bg-surface border border-amber-200 text-amber-700 hover:bg-amber-100">
                                        {m.full_name} — overwhelmed 2 weeks
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Culture map */}
                    <section className="mb-8">
                        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-tertiary mb-3">
                            <Layers className="w-4 h-4" /> Culture map
                        </h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {cultureMap.map((g) => (
                                <div key={g.name} className="bg-surface rounded-2xl border border-subtle ring-1 ring-subtle p-4">
                                    <div className="flex items-center justify-between">
                                        <span className="font-semibold text-primary truncate">{g.name}</span>
                                        <span className="text-xs font-mono text-tertiary">{g.headcount} {g.headcount === 1 ? 'person' : 'people'}</span>
                                    </div>
                                    <div className="mt-1 text-xs text-accent font-semibold">{g.vibe}</div>
                                    <div className="mt-2 text-[11px] text-tertiary">Avg match {g.avgMatch}%</div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Roster */}
                    <section>
                        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-tertiary mb-3">
                            <Users className="w-4 h-4" /> Team roster
                        </h2>
                        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
                            {team.map((m) => (
                                <button key={m.id} onClick={() => setSelected(m)}
                                    className="text-left bg-surface rounded-2xl border border-subtle ring-1 ring-subtle p-5 hover:shadow-lg hover:border-primary-200 transition-all duration-200">
                                    <div className="flex items-start justify-between gap-3 mb-3">
                                        <div className="min-w-0">
                                            <div className="font-semibold text-primary truncate flex items-center gap-2">
                                                {m.full_name}
                                                {m.has_alert && <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />}
                                            </div>
                                            <div className="text-xs text-secondary truncate">{m.position_title || '—'}</div>
                                        </div>
                                        <div className="text-center shrink-0">
                                            <div className={`text-2xl font-semibold ${scoreColor(m.overall_score)}`}>{m.overall_score ?? '—'}</div>
                                            <div className="text-[9px] font-semibold uppercase tracking-widest text-tertiary">Match</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between pt-3 border-t border-subtle text-xs">
                                        <span className="flex items-center gap-1.5 text-secondary">
                                            <Heart className="w-3.5 h-3.5" />
                                            {m.latest_mood ? `${MOOD_EMOJI[m.latest_mood]} ${m.latest_mood}` : 'No pulse yet'}
                                        </span>
                                        <span className="flex items-center gap-1.5 text-secondary">
                                            <ClipboardList className="w-3.5 h-3.5" />
                                            {m.task_total > 0 ? `${m.task_done}/${m.task_total} done` : 'Onboarding'}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>
                </>
            )}

            {selected && user && (
                <MemberOnboardingModal
                    member={selected}
                    privyUserId={user.id}
                    onClose={() => setSelected(null)}
                    onChange={() => user && load(user.id)}
                />
            )}
        </div>
    );
}
