'use client';

import React from 'react';
import Link from 'next/link';
import { Lock, CreditCard, ChevronRight } from 'lucide-react';
import { isFeatureAllowed, minPlanFor, PLANS, type PlanFeature, type SubscriptionPlan } from '@/lib/plans';

interface Props {
    plan?: string | null;
    feature: PlanFeature;
    label?: string;
    children: React.ReactNode;
}

/**
 * Renders children if the plan includes `feature`, otherwise a blurred upgrade
 * lock naming the cheapest plan that unlocks it.
 *
 * AN UNKNOWN PLAN IS NOT "free". This used to read `plan || 'free'`, so every
 * way of failing to LEARN the plan — a read that returned nothing, a workspace
 * row whose column had not synced, a request that failed — presented as the
 * cheapest tier and put an upgrade wall in front of a paying customer. That is
 * exactly what happened to an Enterprise account on Source tracking: the HR
 * dashboard read `companies.plan` through a browser client against a table
 * migration 0077 had revoked, got nothing back, and locked the owner out of a
 * feature they had paid for.
 *
 * So: only gate on a plan we actually know. The cost of getting this wrong in
 * one direction is a free user seeing a page for a moment; in the other it is a
 * customer who is paying being told to pay again. Those are not comparable, and
 * the code should not treat them as if they were.
 */
export default function PlanGate({ plan, feature, label, children }: Props) {
    const known = String(plan ?? '').trim();
    if (!known) return <>{children}</>;
    const p = known as SubscriptionPlan;
    if (isFeatureAllowed(p, feature)) return <>{children}</>;

    const needed = minPlanFor(feature);
    const neededName = needed ? PLANS[needed].name : 'a paid';

    return (
        <div className="relative min-h-[60vh]">
            <div className="filter blur-sm select-none pointer-events-none opacity-40">{children}</div>
            <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
                <div className="bg-surface/90 backdrop-blur-xl border border-subtle p-10 rounded-3xl shadow-popover max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-accent-soft rounded-2xl flex items-center justify-center mx-auto mb-5 border border-subtle">
                        <Lock className="w-8 h-8 text-accent" />
                    </div>
                    <h2 className="text-2xl font-medium text-primary mb-2 tracking-tight">{label || 'Premium feature'}</h2>
                    <p className="text-secondary mb-6 text-sm">
                        This is included from the <span className="font-medium text-primary">{neededName}</span> plan. Upgrade to unlock it.
                    </p>
                    <Link href="/dashboard/billing" className="btn-primary w-full py-3 flex items-center justify-center gap-2">
                        <CreditCard className="w-5 h-5" /> Upgrade to {neededName}
                        <ChevronRight className="w-5 h-5" />
                    </Link>
                </div>
            </div>
        </div>
    );
}
