'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import {
    Radio, Plus, Copy, Check, Loader2, MousePointerClick, Users, TrendingUp, Link2,
} from 'lucide-react';
import { rpc } from '@/lib/rpc';
import { useDialog } from '@/components/ui/Dialog';
import { resolveHrCompanyId } from '@/lib/hr/company';

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
  const { notify } = useDialog();
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

            const companyId = await resolveHrCompanyId(privyUserId);

            const [posRes, linksRes, attrRes] = await Promise.all([
                companyId
                    ? supabase.from('positions').select('id, title').eq('company_id', companyId).order('created_at', { ascending: false })
                    : Promise.resolve({ data: [] as any[] }),
                rpc('get_tracking_links', { p_privy_user_id: privyUserId }),
                rpc('get_source_attribution', { p_privy_user_id: privyUserId }),
            ]);

            setPositions(posRes.data || []);
            if (posRes.data?.[0]) setPosId(posRes.data[0].id);
            if ((linksRes as any).error) console.error('get_tracking_links failed', (linksRes as any).error);
            if ((attrRes as any).error) console.error('get_source_attribution failed', (attrRes as any).error);
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
            const { data, error } = await rpc('create_tracking_link', {
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
            notify(e?.message || 'Failed to create tracking link');
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
        return <div className="h-full flex items-center justify-center"><Loader2 className="w-10 h-10 text-accent animate-spin" /></div>;
    }

    return (
        <div className="p-5 lg:p-8 max-w-[1200px] mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-semibold tracking-tight text-primary flex items-center gap-2">
                    <Radio className="w-5 h-5 text-accent" /> Source Tracking
                </h1>
                <p className="text-sm text-secondary">Generate tracking links per job board and see what actually converts.</p>
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
                    <div className="bg-surface rounded-2xl ring-1 ring-subtle p-5 sticky top-4">
                        <h3 className="font-semibold text-primary mb-4">New tracking link</h3>
                        {positions.length === 0 ? (
                            <p className="text-sm text-secondary">Create a position first to generate links.</p>
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
                    <div className="bg-surface rounded-2xl ring-1 ring-subtle p-5">
                        <h3 className="font-semibold text-primary mb-4">Where candidates come from</h3>
                        {attribution.length === 0 ? (
                            <p className="text-sm text-tertiary">No applicants yet.</p>
                        ) : (
                            <div className="space-y-3">
                                {attribution.map((a) => (
                                    <div key={a.source}>
                                        <div className="flex justify-between items-center text-xs mb-1">
                                            <span className="font-semibold text-secondary">{titleize(a.source)}</span>
                                            <span className="text-tertiary font-mono">
                                                {a.applicants} appl · {a.hired} hired{a.avg_match != null ? ` · ${a.avg_match}% avg` : ''}
                                            </span>
                                        </div>
                                        <div className="h-2 bg-surface-hover rounded-full overflow-hidden">
                                            <div className="h-full bg-accent rounded-full transition-all duration-500"
                                                style={{ width: `${(Number(a.applicants) / maxApplicants) * 100}%` }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Links list */}
                    <div className="bg-surface rounded-2xl ring-1 ring-subtle p-5">
                        <h3 className="font-semibold text-primary mb-4">Your tracking links</h3>
                        {links.length === 0 ? (
                            <p className="text-sm text-tertiary">No links yet. Generate one on the left.</p>
                        ) : (
                            <div className="space-y-2">
                                {links.map((l) => (
                                    <div key={l.id} className="flex items-center gap-3 p-3 rounded-xl border border-subtle hover:bg-surface-sunken transition">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30">{titleize(l.source || 'other')}</span>
                                                <span className="text-sm font-semibold text-primary truncate">{l.label || l.position_title || 'Untitled'}</span>
                                            </div>
                                            <div className="text-2xs text-tertiary truncate font-mono mt-0.5">{buildUrl(l)}</div>
                                        </div>
                                        <div className="text-center shrink-0 px-2">
                                            <div className="text-sm font-semibold text-primary">{l.click_count || 0}</div>
                                            <div className="text-3xs uppercase tracking-widest text-tertiary font-semibold">clicks</div>
                                        </div>
                                        <div className="text-center shrink-0 px-2">
                                            <div className="text-sm font-semibold text-primary">{l.applicant_count || 0}</div>
                                            <div className="text-3xs uppercase tracking-widest text-tertiary font-semibold">applied</div>
                                        </div>
                                        <button onClick={() => copy(l)}
                                            className="shrink-0 p-2 rounded-lg border border-subtle text-secondary hover:text-accent hover:border-accent/30 transition">
                                            {copied === l.id ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
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
                    border: 1px solid hsl(var(--border-subtle));
                    border-radius: 0.5rem;
                    outline: none;
                    background: hsl(var(--surface));
                    color: hsl(var(--text-primary));
                }
                .treasury-input:focus { box-shadow: 0 0 0 2px hsl(var(--accent) / 0.4); }
            `}</style>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="block text-xs font-semibold text-secondary mb-1">{label}</span>
            {children}
        </label>
    );
}

function Kpi({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
    return (
        <div className="bg-surface rounded-xl ring-1 ring-subtle px-4 py-3">
            <div className="flex items-center gap-1.5 text-3xs font-medium uppercase tracking-widest text-tertiary mb-1">
                <Icon className="w-3 h-3" /> {label}
            </div>
            <div className="text-xl font-semibold text-primary">{value}</div>
        </div>
    );
}
