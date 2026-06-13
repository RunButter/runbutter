'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import {
    Radio, Plus, Copy, Check, Loader2, MousePointerClick, Users, TrendingUp, Link2,
} from 'lucide-react';

const CHANNELS = [
    { value: 'linkedin', label: 'LinkedIn' },
    { value: 'indeed', label: 'Indeed' },
    { value: 'pracuj_pl', label: 'Pracuj.pl' },
    { value: 'referral', label: 'Referral' },
    { value: 'twitter', label: 'X / Twitter' },
    { value: 'facebook', label: 'Facebook' },
    { value: 'newsletter', label: 'Newsletter' },
    { value: 'other', label: 'Other' },
];

const titleize = (s: string) =>
    (s || 'direct').replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function SourcesPage() {
    const router = useRouter();
    const { ready, authenticated, user } = usePrivy();
    const [loading, setLoading] = useState(true);
    const [positions, setPositions] = useState<any[]>([]);
    const [links, setLinks] = useState<any[]>([]);
    const [attribution, setAttribution] = useState<any[]>([]);

    // generator form
    const [posId, setPosId] = useState('');
    const [channel, setChannel] = useState('linkedin');
    const [campaign, setCampaign] = useState('');
    const [label, setLabel] = useState('');
    const [creating, setCreating] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);

    useEffect(() => {
        if (!ready) return;
        if (!authenticated) { router.push('/auth/login'); return; }
        if (user) loadAll(user.id);
    }, [ready, authenticated, user, router]);

    const loadAll = async (privyUserId: string) => {
        try {
            await supabase.auth.getUser();
            await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });

            const { data: companyUser } = await supabase
                .from('company_users').select('company_id').eq('privy_user_id', privyUserId).single();

            const [posRes, linksRes, attrRes] = await Promise.all([
                companyUser
                    ? supabase.from('positions').select('id, title').eq('company_id', companyUser.company_id).order('created_at', { ascending: false })
                    : Promise.resolve({ data: [] as any[] }),
                supabase.rpc('get_tracking_links', { p_privy_user_id: privyUserId }),
                supabase.rpc('get_source_attribution', { p_privy_user_id: privyUserId }),
            ]);

            setPositions(posRes.data || []);
            if (posRes.data?.[0]) setPosId(posRes.data[0].id);
            setLinks((linksRes as any).data || []);
            setAttribution((attrRes as any).data || []);
        } catch (e) {
            console.error('Error loading source tracking:', e);
        } finally {
            setLoading(false);
        }
    };

    const buildUrl = (link: any) => {
        if (typeof window === 'undefined') return '';
        const u = new URL(`${window.location.origin}/apply/${link.position_id}`);
        u.searchParams.set('lt', link.token);
        if (link.source) u.searchParams.set('source', link.source);
        if (link.utm_source) u.searchParams.set('utm_source', link.utm_source);
        if (link.utm_medium) u.searchParams.set('utm_medium', link.utm_medium);
        if (link.utm_campaign) u.searchParams.set('utm_campaign', link.utm_campaign);
        return u.toString();
    };

    const handleCreate = async () => {
        if (!posId || !user) return;
        setCreating(true);
        try {
            const { data, error } = await supabase.rpc('create_tracking_link', {
                p_privy_user_id: user.id,
                p_position_id: posId,
                p_label: label || null,
                p_source: channel,
                p_utm_source: channel,
                p_utm_medium: 'job_board',
                p_utm_campaign: campaign || null,
            });
            if (error) throw error;
            const posTitle = positions.find((p) => p.id === posId)?.title || '';
            setLinks((prev) => [{ ...data, position_title: posTitle, applicant_count: 0 }, ...prev]);
            setCampaign(''); setLabel('');
        } catch (e: any) {
            console.error('create link failed', e);
            alert(e?.message || 'Failed to create tracking link');
        } finally {
            setCreating(false);
        }
    };

    const copy = async (link: any) => {
        try {
            await navigator.clipboard.writeText(buildUrl(link));
            setCopied(link.id);
            setTimeout(() => setCopied(null), 1500);
        } catch { /* clipboard blocked */ }
    };

    const totals = useMemo(() => {
        const clicks = links.reduce((s, l) => s + (l.click_count || 0), 0);
        const applicants = attribution.reduce((s, a) => s + Number(a.applicants || 0), 0);
        const hired = attribution.reduce((s, a) => s + Number(a.hired || 0), 0);
        return { clicks, applicants, hired, conv: clicks ? Math.round((applicants / clicks) * 100) : 0 };
    }, [links, attribution]);

    const maxApplicants = Math.max(1, ...attribution.map((a) => Number(a.applicants || 0)));

    if (!ready || loading) {
        return <div className="h-full flex items-center justify-center"><Loader2 className="w-10 h-10 text-primary-600 animate-spin" /></div>;
    }

    return (
        <div className="p-5 lg:p-8 max-w-[1200px] mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-black tracking-tight text-gray-900 flex items-center gap-2">
                    <Radio className="w-5 h-5 text-primary-600" /> Source Tracking
                </h1>
                <p className="text-sm text-gray-500">Generate tracking links per job board and see what actually converts.</p>
            </div>

            {/* KPI row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                <Kpi icon={MousePointerClick} label="Total clicks" value={`${totals.clicks}`} />
                <Kpi icon={Users} label="Applicants" value={`${totals.applicants}`} />
                <Kpi icon={TrendingUp} label="Click → apply" value={`${totals.conv}%`} />
                <Kpi icon={Check} label="Hired" value={`${totals.hired}`} />
            </div>

            <div className="grid lg:grid-cols-5 gap-6">
                {/* Generator */}
                <div className="lg:col-span-2">
                    <div className="bg-white rounded-2xl border border-gray-200 ring-1 ring-slate-200/40 p-5 sticky top-4">
                        <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <Plus className="w-4 h-4 text-primary-600" /> New tracking link
                        </h3>
                        {positions.length === 0 ? (
                            <p className="text-sm text-gray-500">Create a position first to generate links.</p>
                        ) : (
                            <div className="space-y-3">
                                <Field label="Position">
                                    <select value={posId} onChange={(e) => setPosId(e.target.value)} className="treasury-input">
                                        {positions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                                    </select>
                                </Field>
                                <Field label="Channel">
                                    <select value={channel} onChange={(e) => setChannel(e.target.value)} className="treasury-input">
                                        {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                                    </select>
                                </Field>
                                <Field label="Campaign (optional)">
                                    <input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="q3-paid" className="treasury-input" />
                                </Field>
                                <Field label="Label (optional)">
                                    <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="LinkedIn paid — senior react" className="treasury-input" />
                                </Field>
                                <button onClick={handleCreate} disabled={creating}
                                    className="btn-primary w-full py-2.5 flex items-center justify-center gap-2">
                                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                                    Generate link
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Links + breakdown */}
                <div className="lg:col-span-3 space-y-6">
                    {/* Source breakdown */}
                    <div className="bg-white rounded-2xl border border-gray-200 ring-1 ring-slate-200/40 p-5">
                        <h3 className="font-bold text-gray-900 mb-4">Where candidates come from</h3>
                        {attribution.length === 0 ? (
                            <p className="text-sm text-gray-400">No applicants yet.</p>
                        ) : (
                            <div className="space-y-3">
                                {attribution.map((a) => (
                                    <div key={a.source}>
                                        <div className="flex justify-between items-center text-xs mb-1">
                                            <span className="font-semibold text-gray-700">{titleize(a.source)}</span>
                                            <span className="text-gray-400 font-mono">
                                                {a.applicants} appl · {a.hired} hired{a.avg_match != null ? ` · ${a.avg_match}% avg` : ''}
                                            </span>
                                        </div>
                                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-primary-500 rounded-full transition-all duration-500"
                                                style={{ width: `${(Number(a.applicants) / maxApplicants) * 100}%` }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Links list */}
                    <div className="bg-white rounded-2xl border border-gray-200 ring-1 ring-slate-200/40 p-5">
                        <h3 className="font-bold text-gray-900 mb-4">Your tracking links</h3>
                        {links.length === 0 ? (
                            <p className="text-sm text-gray-400">No links yet. Generate one on the left.</p>
                        ) : (
                            <div className="space-y-2">
                                {links.map((l) => (
                                    <div key={l.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-100">{titleize(l.source || 'other')}</span>
                                                <span className="text-sm font-semibold text-gray-800 truncate">{l.label || l.position_title || 'Untitled'}</span>
                                            </div>
                                            <div className="text-[11px] text-gray-400 truncate font-mono mt-0.5">{buildUrl(l)}</div>
                                        </div>
                                        <div className="text-center shrink-0 px-2">
                                            <div className="text-sm font-black text-gray-800">{l.click_count || 0}</div>
                                            <div className="text-[9px] uppercase tracking-widest text-gray-300 font-black">clicks</div>
                                        </div>
                                        <div className="text-center shrink-0 px-2">
                                            <div className="text-sm font-black text-gray-800">{l.applicant_count || 0}</div>
                                            <div className="text-[9px] uppercase tracking-widest text-gray-300 font-black">applied</div>
                                        </div>
                                        <button onClick={() => copy(l)}
                                            className="shrink-0 p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-primary-600 hover:border-primary-200 transition">
                                            {copied === l.id ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <style jsx>{`
                .treasury-input {
                    width: 100%;
                    padding: 0.5rem 0.75rem;
                    font-size: 0.875rem;
                    border: 1px solid #d1d5db;
                    border-radius: 0.5rem;
                    outline: none;
                    background: white;
                }
                .treasury-input:focus { box-shadow: 0 0 0 2px rgb(99 102 241 / 0.4); }
            `}</style>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">{label}</span>
            {children}
        </label>
    );
}

function Kpi({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
    return (
        <div className="bg-white rounded-xl border border-gray-200 ring-1 ring-slate-200/40 px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
                <Icon className="w-3 h-3" /> {label}
            </div>
            <div className="text-xl font-black text-gray-900">{value}</div>
        </div>
    );
}
