'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import {
    Check, CreditCard, CheckCircle2, Loader2, ArrowRight, ShieldCheck, Sparkles, XCircle,
} from 'lucide-react';
import CheckoutButton from '@/components/CheckoutButton';
import {
    PLANS, PLAN_ORDER, ALL_FEATURES, FEATURE_LABELS, formatLimit, normalizePlan,
    type SubscriptionPlan,
} from '@/lib/plans';

// Env var names keep the older STARTER/PRO wording so existing Render config
// keeps working after the Team/Business rename. These MUST be per-seat
// (per-unit) prices in Stripe, or seat quantity won't bill correctly.
const PRICE_IDS: Partial<Record<SubscriptionPlan, string>> = {
    team: process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID || 'price_STARTER_PLACEHOLDER',
    business: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID || 'price_PRO_PLACEHOLDER',
};

export default function BillingPage() {
    const { ready, authenticated, user } = usePrivy();
    const params = useSearchParams();
    const [loading, setLoading] = useState(true);
    const [company, setCompany] = useState<any>(null);
    const [seats, setSeats] = useState(1);

    useEffect(() => {
        if (!ready) return;
        if (!authenticated || !user) { setLoading(false); return; }
        (async () => {
            // limit(1), NOT maybeSingle(): a user can belong to several companies
            // and maybeSingle() throws "multiple rows returned" for them.
            const { data } = await supabase
                .from('company_users')
                .select('*, company:companies(*)')
                .eq('privy_user_id', user.id)
                .order('created_at', { ascending: true })   // deterministic: no ORDER BY = arbitrary company
                .limit(1);
            const row = data?.[0];
            if (row?.company) {
                setCompany(row.company);
                // Seat count for the checkout quantity: how many people are in
                // this workspace today.
                const { count } = await supabase
                    .from('company_users')
                    .select('id', { count: 'exact', head: true })
                    .eq('company_id', row.company.id);
                if (count && count > 0) setSeats(count);
            }
            setLoading(false);
        })();
    }, [ready, authenticated, user]);

    const current = normalizePlan(company?.plan);
    const currentIdx = PLAN_ORDER.indexOf(current);
    const justPaid = params.get('success') === 'true';
    const canceled = params.get('canceled') === 'true';

    if (loading) {
        return <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-tertiary" /></div>;
    }

    return (
        <div className="p-6">
            <div className="max-w-6xl mx-auto">
                <div className="mb-6">
                    <h1 className="text-2xl font-semibold text-primary tracking-tight">Plans &amp; billing</h1>
                    <p className="text-sm text-secondary mt-1">
                        Priced per seat, so it scales with your team. Self-hosting is free and always includes everything.
                    </p>
                </div>

                {justPaid && (
                    <div className="mb-5 flex items-start gap-2.5 rounded-xl bg-success/10 ring-1 ring-success/30 px-4 py-3">
                        <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                        <p className="text-[13px] text-success">
                            Payment received. Your plan updates as soon as Stripe confirms the subscription; refresh in a moment if it still shows the old tier.
                        </p>
                    </div>
                )}
                {canceled && (
                    <div className="mb-5 flex items-start gap-2.5 rounded-xl bg-surface ring-1 ring-subtle px-4 py-3">
                        <XCircle className="w-4 h-4 text-tertiary shrink-0 mt-0.5" />
                        <p className="text-[13px] text-secondary">Checkout canceled. Nothing was charged.</p>
                    </div>
                )}

                {/* Current subscription */}
                <div className="mb-6 rounded-xl bg-surface ring-1 ring-subtle shadow-card p-5 flex flex-wrap items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-surface-sunken ring-1 ring-subtle flex items-center justify-center shrink-0">
                        <CreditCard className="w-4 h-4 text-tertiary" />
                    </div>
                    <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">Current plan</div>
                        <div className="text-sm font-semibold text-primary">
                            {PLANS[current].name}
                            <span className="ml-2 font-normal text-secondary capitalize">
                                {company?.subscription_status || (current === 'free' ? 'no subscription' : 'active')}
                            </span>
                        </div>
                    </div>
                    <div className="ml-auto flex items-center gap-2 text-[12px] text-secondary">
                        <ShieldCheck className="w-3.5 h-3.5 text-tertiary" />
                        {seats} {seats === 1 ? 'seat' : 'seats'} in this workspace
                    </div>
                </div>

                {/* Plans */}
                <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
                    {PLAN_ORDER.map((key, idx) => {
                        const p = PLANS[key];
                        const isCurrent = key === current;
                        const isUpgrade = idx > currentIdx;
                        const popular = key === 'business';
                        const prev = idx > 0 ? PLAN_ORDER[idx - 1] : null;
                        const newFeats = ALL_FEATURES.filter((f) => p.features[f] && !(prev && PLANS[prev].features[f]));
                        const priceId = PRICE_IDS[key];

                        return (
                            <div key={key}
                                className={`relative rounded-xl bg-surface p-5 flex flex-col shadow-card ${popular ? 'ring-2 ring-accent/40' : 'ring-1 ring-subtle'}`}>
                                {popular && (
                                    <span className="absolute -top-2.5 left-5 inline-flex items-center gap-1 rounded-full bg-inverse px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-inverse-fg">
                                        <Sparkles className="w-3 h-3" /> Popular
                                    </span>
                                )}
                                {isCurrent && (
                                    <span className="absolute -top-2.5 right-5 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-success">Current</span>
                                )}

                                <h3 className="text-sm font-semibold text-primary">{p.name}</h3>
                                <div className="mt-1.5 flex items-baseline gap-1">
                                    <span className="text-3xl font-semibold text-primary tabular-nums">{p.price}</span>
                                    {p.priceValue > 0 && (
                                        <span className="text-[12px] font-semibold text-tertiary">{p.perSeat ? '/seat /mo' : '/mo'}</span>
                                    )}
                                </div>
                                <p className="text-[12px] text-tertiary mb-4">{p.tagline}</p>

                                <div className="space-y-1.5 mb-4 text-[12px]">
                                    <Row label="Seats" value={formatLimit(p.limits.maxSeats)} />
                                    <Row label="Records" value={formatLimit(p.limits.maxRecords)} />
                                    <Row label="Automations" value={formatLimit(p.limits.maxAutomations)} />
                                </div>

                                <ul className="space-y-1.5 mb-5 flex-grow">
                                    {idx === 0 ? (
                                        <li className="flex items-start gap-2 text-[12px] text-secondary">
                                            <Check className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />Sales, finance, projects and hiring core
                                        </li>
                                    ) : (
                                        <>
                                            <li className="text-[11px] font-semibold text-tertiary">Everything in {prev ? PLANS[prev].name : ''}, plus:</li>
                                            {newFeats.length === 0 && (
                                                <li className="flex items-start gap-2 text-[12px] text-secondary">
                                                    <Check className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />Unlimited everything
                                                </li>
                                            )}
                                            {newFeats.slice(0, 6).map((f) => (
                                                <li key={f} className="flex items-start gap-2 text-[12px] text-secondary">
                                                    <Check className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />{FEATURE_LABELS[f]}
                                                </li>
                                            ))}
                                        </>
                                    )}
                                </ul>

                                {isCurrent ? (
                                    <button disabled className="h-10 rounded-md bg-surface-hover text-[13px] font-semibold text-tertiary cursor-default">Current plan</button>
                                ) : key === 'enterprise' ? (
                                    <Link href="/contact" className="h-10 inline-flex items-center justify-center gap-1.5 rounded-md bg-inverse text-inverse-fg text-[13px] font-semibold shadow-sm hover:bg-inverse/90 transition-colors">
                                        Contact sales <ArrowRight className="w-3.5 h-3.5" />
                                    </Link>
                                ) : isUpgrade && priceId ? (
                                    <CheckoutButton
                                        companyId={company?.id || ''}
                                        priceId={priceId}
                                        companyName={company?.name || 'Workspace'}
                                        plan={key}
                                        seats={seats}
                                        text={`Upgrade to ${p.name}`}
                                        variant={popular ? 'dark' : 'white'}
                                    />
                                ) : (
                                    <button disabled className="h-10 rounded-md bg-surface-sunken ring-1 ring-subtle text-[13px] font-semibold text-tertiary cursor-default">Included below your plan</button>
                                )}
                            </div>
                        );
                    })}
                </div>

                <p className="mt-5 text-[12px] text-tertiary">
                    Secure payments by Stripe. Cancel anytime, prices in USD. Seat count is taken from your workspace and can be adjusted at checkout.
                </p>
            </div>
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between">
            <span className="text-secondary">{label}</span>
            <span className="font-semibold text-primary tabular-nums">{value}</span>
        </div>
    );
}
