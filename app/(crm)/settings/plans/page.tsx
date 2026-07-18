'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { Check, Loader2, Sparkles } from 'lucide-react';
import CheckoutButton from '@/components/CheckoutButton';
import {
  PLANS, PLAN_ORDER, ALL_FEATURES, FEATURE_LABELS, formatLimit, type SubscriptionPlan,
} from '@/lib/plans';

// Maps a paid plan to its Stripe price id (same env vars the legacy billing uses).
const PRICE_IDS: Partial<Record<SubscriptionPlan, string>> = {
  starter: process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID || 'price_STARTER_PLACEHOLDER',
  professional: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID || 'price_PRO_PLACEHOLDER',
};

export default function PlansPage() {
  const { ready, authenticated, user } = usePrivy();
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated || !user) { setLoading(false); return; }
    supabase
      .from('company_users')
      .select('*, company:companies(*)')
      .eq('privy_user_id', user.id)
      .maybeSingle()
      .then(({ data }) => { if (data?.company) setCompany(data.company); setLoading(false); });
  }, [ready, authenticated, user]);

  const current = (company?.plan && company.plan in PLANS ? company.plan : 'free') as SubscriptionPlan;
  const currentIdx = PLAN_ORDER.indexOf(current);

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-subtle">
        <h1 className="text-sm font-semibold text-primary">Plans &amp; billing</h1>
        <span className="text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-accent/10 text-accent capitalize">{current} plan</span>
        <Link href="/dashboard/billing" className="ml-auto text-[12px] font-medium text-secondary hover:text-primary">Manage billing →</Link>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="h-40 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="max-w-6xl">
            <h2 className="text-xl font-semibold text-primary mb-1">One workspace, priced to grow with you</h2>
            <p className="text-sm text-secondary mb-6">
              Sales, finance, projects and recruiting in one place — upgrade for more seats, records, and modules.
              {!company && ' Sign in to manage your subscription.'}
            </p>

            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
              {PLAN_ORDER.map((key, idx) => {
                const p = PLANS[key];
                const isCurrent = key === current;
                const isUpgrade = idx > currentIdx;
                const popular = key === 'professional';
                const prev = idx > 0 ? PLAN_ORDER[idx - 1] : null;
                const newFeats = ALL_FEATURES.filter((f) => p.features[f] && !(prev && PLANS[prev].features[f]));

                return (
                  <div key={key}
                    className={`relative rounded-2xl p-5 flex flex-col bg-surface ${popular ? 'ring-2 ring-accent/30 shadow-lg' : 'ring-1 ring-subtle'}`}>
                    {popular && (
                      <div className="absolute -top-2.5 left-5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-white bg-accent rounded-full px-2 py-0.5">
                        <Sparkles className="w-3 h-3" /> Popular
                      </div>
                    )}
                    {isCurrent && (
                      <div className="absolute -top-2.5 right-5 text-[10px] font-semibold uppercase tracking-widest text-success bg-success/10 rounded-full px-2 py-0.5">Current</div>
                    )}

                    <h3 className="font-semibold text-primary">{p.name}</h3>
                    <div className="mt-1.5 flex items-baseline gap-1">
                      <span className="text-3xl font-semibold text-primary">{p.price}</span>
                      {p.priceValue > 0 && <span className="text-[12px] font-semibold text-tertiary">/mo</span>}
                    </div>
                    <p className="text-[12px] text-tertiary mb-4">{p.tagline}</p>

                    {/* Hard limits — the Business-OS meters */}
                    <div className="space-y-1.5 mb-4 text-[12px]">
                      <div className="flex justify-between"><span className="text-secondary">Seats</span><span className="font-semibold text-primary tabular-nums">{formatLimit(p.limits.maxSeats)}</span></div>
                      <div className="flex justify-between"><span className="text-secondary">Records / object</span><span className="font-semibold text-primary tabular-nums">{formatLimit(p.limits.maxRecords)}</span></div>
                      <div className="flex justify-between"><span className="text-secondary">Positions · candidates</span><span className="font-semibold text-primary tabular-nums">{formatLimit(p.limits.maxPositions)} · {formatLimit(p.limits.maxCandidates)}</span></div>
                    </div>

                    {/* Feature deltas */}
                    <ul className="space-y-1.5 mb-5 flex-grow">
                      {idx === 0 ? (
                        <li className="flex items-start gap-2 text-[12px] text-secondary"><Check className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />Sales · Finance · Projects · HR core</li>
                      ) : (
                        <>
                          <li className="text-[11px] font-semibold text-tertiary">Everything in {prev ? PLANS[prev].name : ''}, plus:</li>
                          {newFeats.length === 0 && key === 'enterprise' && (
                            <li className="flex items-start gap-2 text-[12px] text-secondary"><Check className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />Unlimited everything</li>
                          )}
                          {newFeats.map((f) => (
                            <li key={f} className="flex items-start gap-2 text-[12px] text-secondary"><Check className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />{FEATURE_LABELS[f]}</li>
                          ))}
                        </>
                      )}
                    </ul>

                    {/* CTA */}
                    {isCurrent ? (
                      <button disabled className="h-10 rounded-xl text-[13px] font-semibold text-tertiary bg-surface-hover cursor-default">Current plan</button>
                    ) : key === 'enterprise' ? (
                      <Link href="/contact" className="h-10 rounded-xl text-[13px] font-semibold text-center inline-flex items-center justify-center bg-inverse text-white hover:bg-inverse transition">Contact sales</Link>
                    ) : isUpgrade && PRICE_IDS[key] ? (
                      <div className="[&>button]:py-2.5 [&>button]:rounded-xl [&>button]:text-[13px]">
                        <CheckoutButton
                          companyId={company?.id || ''}
                          priceId={PRICE_IDS[key]!}
                          companyName={company?.name || 'Workspace'}
                          text={`Upgrade to ${p.name}`}
                          variant={popular ? 'primary' : 'dark'}
                        />
                      </div>
                    ) : (
                      <button disabled className="h-10 rounded-xl text-[13px] font-semibold text-tertiary bg-surface-sunken ring-1 ring-subtle cursor-default">Included below your plan</button>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="mt-5 text-[12px] text-tertiary">Secure payments by Stripe · cancel anytime · prices in USD.</p>
          </div>
        )}
      </div>
    </>
  );
}
