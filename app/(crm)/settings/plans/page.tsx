'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Check, Sparkles, CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import CheckoutButton from '@/components/CheckoutButton';
import {
  PLANS, PLAN_ORDER, ALL_FEATURES, FEATURE_LABELS, formatLimit, normalizePlan, type SubscriptionPlan,
} from '@/lib/plans';
import { rpc } from '@/lib/rpc';
import { getWorkspace } from '@/lib/crm/data';
import AppLoading from '@/components/ui/AppLoading';
import PlanUsage from '@/components/crm/PlanUsage';

// The ONE billing screen. There used to be two — this one and /dashboard/billing
// — and they disagreed: this one billed the OLDEST company you belong to and sent
// neither the plan nor the seat count to checkout, the other billed the workspace
// you were looking at. /dashboard/billing now redirects here, and Stripe's
// success/cancel URLs land here too.
//
// Env var names keep the ATS-era STARTER/PRO wording as a fallback so an instance
// that has not moved its variables over keeps taking payments — NEXT_PUBLIC_* are
// inlined at build time. These must be PER-SEAT prices in Stripe.
const PRICE_IDS: Partial<Record<SubscriptionPlan, string>> = {
  team: process.env.NEXT_PUBLIC_STRIPE_TEAM_PRICE_ID || process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID || 'price_TEAM_PLACEHOLDER',
  business: process.env.NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID || process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID || 'price_BUSINESS_PLACEHOLDER',
};

export default function PlansPage() {
  // useSearchParams needs a Suspense boundary or the static build bails out.
  return <Suspense fallback={<AppLoading />}><Plans /></Suspense>;
}

function Plans() {
  const { ready, authenticated, user } = usePrivy();
  const params = useSearchParams();
  const [company, setCompany] = useState<{ id: string; name: string; plan: string } | null>(null);
  const [seats, setSeats] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated || !user) { setLoading(false); return; }
    (async () => {
      // The ACTIVE workspace, like every other screen — billing the company you
      // are not looking at is its own kind of wrong.
      const ws = await getWorkspace(user.id).catch(() => null);
      if (ws?.id) {
        setCompany({ id: ws.id, name: ws.name, plan: ws.plan });
        const { data: members } = await rpc('get_members', { p_privy: user.id, p_workspace: ws.id });
        const n = Array.isArray(members) ? members.length : 0;
        if (n > 0) setSeats(n);
      }
      setLoading(false);
    })();
  }, [ready, authenticated, user]);

  const current = normalizePlan(company?.plan);
  const currentIdx = PLAN_ORDER.indexOf(current);
  const justPaid = params.get('success') === 'true';
  const canceled = params.get('canceled') === 'true';

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 page-x">
        <h1 className="text-md font-medium text-primary">Plans &amp; billing</h1>
        <span className="text-3xs font-medium uppercase tracking-widest px-1.5 py-0.5 rounded bg-accent/10 text-accent capitalize">{current} plan</span>
        {company && (
          <span className="ml-auto text-xs text-secondary tabular-nums">{seats} {seats === 1 ? 'seat' : 'seats'}</span>
        )}
      </header>

      <div className="flex-1 overflow-auto page-pad">
        {loading ? (
          <AppLoading />
        ) : (
          <div className="w-full space-y-6">
            {justPaid && (
              <div className="flex items-start gap-2.5 rounded-xl bg-success/10 ring-1 ring-success/30 px-4 py-3">
                <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                <p className="text-sm text-success">Payment received. Your plan updates as soon as Stripe confirms it — refresh in a moment if it still shows the old one.</p>
              </div>
            )}
            {canceled && (
              <div className="flex items-start gap-2.5 rounded-xl bg-surface ring-1 ring-subtle px-4 py-3">
                <XCircle className="w-4 h-4 text-tertiary shrink-0 mt-0.5" />
                <p className="text-sm text-secondary">Checkout canceled. Nothing was charged.</p>
              </div>
            )}
            {!company && <p className="text-sm text-secondary">Sign in to manage your subscription.</p>}

            {/* Above the tiers: "am I outgrowing this" is the question somebody
                opens this page with. */}
            {company?.id && user && (
              <PlanUsage privy={user.id} workspaceId={company.id} plan={company.plan} />
            )}

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
                    className={`relative rounded-2xl p-5 flex flex-col bg-surface shadow-card ${popular ? 'ring-2 ring-accent/30' : 'ring-1 ring-subtle'}`}>
                    {popular && (
                      <div className="absolute -top-2.5 left-5 inline-flex items-center gap-1 text-3xs font-medium uppercase tracking-widest text-accent-fg bg-accent rounded-full px-2 py-0.5">
                        <Sparkles className="w-3 h-3" /> Popular
                      </div>
                    )}
                    {isCurrent && (
                      <div className="absolute -top-2.5 right-5 text-3xs font-medium uppercase tracking-widest text-success bg-success/10 rounded-full px-2 py-0.5">Current</div>
                    )}

                    <h3 className="text-base font-medium text-primary">{p.name}</h3>
                    <div className="mt-1.5 flex items-baseline gap-1">
                      <span className="text-3xl font-semibold text-primary tabular-nums">{p.price}</span>
                      {p.priceValue > 0 && (
                        <span className="text-xs font-semibold text-tertiary">{p.perSeat ? '/seat /mo' : '/mo'}</span>
                      )}
                    </div>
                    <p className="text-xs text-tertiary mb-4">{p.tagline}</p>

                    <div className="space-y-1.5 mb-4 text-xs">
                      <Row label="Seats" value={formatLimit(p.limits.maxSeats)} />
                      <Row label="Records / object" value={formatLimit(p.limits.maxRecords)} />
                      <Row label="Open positions" value={formatLimit(p.limits.maxPositions)} />
                      <Row label="Candidates" value={formatLimit(p.limits.maxCandidates)} />
                    </div>

                    <ul className="space-y-1.5 mb-5 flex-grow">
                      {idx === 0 ? (
                        <li className="flex items-start gap-2 text-xs text-secondary"><Check className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />Sales · Finance · Projects · HR core</li>
                      ) : (
                        <>
                          <li className="text-2xs font-semibold text-tertiary">Everything in {prev ? PLANS[prev].name : ''}, plus:</li>
                          {newFeats.length === 0 && (
                            <li className="flex items-start gap-2 text-xs text-secondary"><Check className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />Unlimited everything</li>
                          )}
                          {newFeats.map((f) => (
                            <li key={f} className="flex items-start gap-2 text-xs text-secondary"><Check className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />{FEATURE_LABELS[f]}</li>
                          ))}
                        </>
                      )}
                    </ul>

                    {isCurrent ? (
                      <button disabled className="h-10 rounded-xl text-sm font-semibold text-tertiary bg-surface-hover cursor-default">Current plan</button>
                    ) : key === 'enterprise' ? (
                      <Link href="/contact" className="h-10 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-1.5 bg-inverse text-inverse-fg hover:bg-inverse/90 transition">
                        Contact sales <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    ) : isUpgrade && priceId ? (
                      <div className="[&>button]:py-2.5 [&>button]:rounded-xl [&>button]:text-sm">
                        <CheckoutButton
                          companyId={company?.id || ''}
                          priceId={priceId}
                          companyName={company?.name || 'Workspace'}
                          plan={key}
                          seats={seats}
                          text={`Upgrade to ${p.name}`}
                          variant={popular ? 'primary' : 'dark'}
                        />
                      </div>
                    ) : (
                      <button disabled className="h-10 rounded-xl text-sm font-semibold text-tertiary bg-surface-sunken ring-1 ring-subtle cursor-default">Included below your plan</button>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-tertiary">Secure payments by Stripe · cancel anytime · prices in USD. Seats come from your workspace and can be changed at checkout.</p>
          </div>
        )}
      </div>
    </>
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
