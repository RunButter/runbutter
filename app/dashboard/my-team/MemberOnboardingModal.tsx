'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { X, ClipboardList, Brain, Loader2, Activity } from 'lucide-react';
import { generateBrief, generateChecklist } from '@/lib/onboarding';
import { rpc } from '@/lib/rpc';

interface Props {
    member: any;
    privyUserId: string;
    onClose: () => void;
    onChange?: () => void;
}

// Monday of the current week as an ISO date (YYYY-MM-DD).
function currentWeekStart(): string {
    const d = new Date();
    const day = (d.getDay() + 6) % 7; // 0 = Monday
    d.setDate(d.getDate() - day);
    return d.toISOString().slice(0, 10);
}

const MOODS: { key: 'happy' | 'balanced' | 'overwhelmed'; label: string; emoji: string; cls: string }[] = [
    { key: 'happy', label: 'Happy', emoji: '😀', cls: 'bg-success/10 border-success/30 text-success' },
    { key: 'balanced', label: 'Balanced', emoji: '😐', cls: 'bg-accent/10 border-accent/30 text-accent' },
    { key: 'overwhelmed', label: 'Overwhelmed', emoji: '😟', cls: 'bg-warning/10 border-warning/30 text-warning' },
];

export default function MemberOnboardingModal({ member, privyUserId, onClose, onChange }: Props) {
    const brief = useMemo(() => generateBrief(member), [member]);
    const checklist = useMemo(() => generateChecklist(member), [member]);

    const [done, setDone] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(true);
    const [savingPulse, setSavingPulse] = useState(false);
    const [mood, setMood] = useState<string | null>(member.latest_mood ?? null);

    useEffect(() => {
        (async () => {
            try {
                const { data } = await rpc('get_onboarding_tasks', {
                    p_privy_user_id: privyUserId, p_candidate_id: member.id,
                });
                const map: Record<string, boolean> = {};
                (data || []).forEach((t: any) => { map[t.task_key] = t.is_done; });
                setDone(map);
            } catch (e) { console.error('load tasks failed', e); }
            finally { setLoading(false); }
        })();
    }, [member.id, privyUserId]);

    const toggle = async (key: string, title: string) => {
        const next = !done[key];
        setDone((d) => ({ ...d, [key]: next }));
        try {
            // rpc() never throws — surface { error } explicitly or the optimistic
            // toggle sticks even when the save failed.
            const { error } = await rpc('set_onboarding_task', {
                p_privy_user_id: privyUserId, p_candidate_id: member.id,
                p_task_key: key, p_title: title, p_is_done: next,
            });
            if (error) throw error;
            onChange?.();
        } catch (e) {
            console.error('toggle task failed', e);
            setDone((d) => ({ ...d, [key]: !next })); // revert
        }
    };

    const logPulse = async (m: string) => {
        setSavingPulse(true);
        setMood(m);
        try {
            const { error } = await rpc('record_pulse', {
                p_privy_user_id: privyUserId, p_candidate_id: member.id,
                p_week_start: currentWeekStart(), p_mood: m, p_note: null,
            });
            if (error) throw error;
            onChange?.();
        } catch (e) {
            console.error('record pulse failed', e);
            setMood(null);
        }
        finally { setSavingPulse(false); }
    };

    const completed = checklist.filter((c) => done[c.key]).length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-surface rounded-2xl shadow-popover w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-6 border-b border-subtle sticky top-0 bg-surface">
                    <div>
                        <h3 className="text-xl font-semibold text-primary">{member.full_name}</h3>
                        <p className="text-sm text-secondary">{member.position_title || 'Team member'} · Onboarding</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-hover text-tertiary"><X className="w-5 h-5" /></button>
                </div>

                <div className="p-6 space-y-8">
                    {/* Manager brief */}
                    <section>
                        <h4 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-tertiary mb-3">
                            <Brain className="w-4 h-4" /> Manager brief
                        </h4>
                        <div className="bg-accent/10 border border-accent/20 rounded-xl p-4 space-y-2">
                            {brief.map((b, i) => (
                                <p key={i} className="text-sm text-secondary leading-relaxed flex gap-2">
                                    <span className="text-accent font-semibold">•</span> {b}
                                </p>
                            ))}
                        </div>
                    </section>

                    {/* Weekly pulse */}
                    <section>
                        <h4 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-tertiary mb-3">
                            <Activity className="w-4 h-4" /> This week&apos;s pulse
                        </h4>
                        <div className="flex gap-2">
                            {MOODS.map((m) => (
                                <button key={m.key} disabled={savingPulse} onClick={() => logPulse(m.key)}
                                    className={`flex-1 py-3 rounded-xl border text-sm font-semibold transition ${mood === m.key ? m.cls : 'bg-surface border-subtle text-secondary hover:border-subtle'}`}>
                                    <div className="text-xl mb-0.5">{m.emoji}</div>
                                    {m.label}
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* Onboarding checklist */}
                    <section>
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-tertiary">
                                <ClipboardList className="w-4 h-4" /> Onboarding checklist
                            </h4>
                            <span className="text-xs font-mono text-tertiary">{completed}/{checklist.length}</span>
                        </div>
                        {loading ? (
                            <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>
                        ) : (
                            <div className="space-y-1.5">
                                {checklist.map((c) => (
                                    <label key={c.key} className="flex items-center gap-3 p-2.5 rounded-lg border border-subtle hover:bg-surface-sunken cursor-pointer">
                                        <input type="checkbox" checked={!!done[c.key]} onChange={() => toggle(c.key, c.title)}
                                            className="w-4 h-4 rounded accent-accent cursor-pointer" />
                                        <span className={`text-sm ${done[c.key] ? 'text-tertiary line-through' : 'text-secondary'}`}>{c.title}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}
