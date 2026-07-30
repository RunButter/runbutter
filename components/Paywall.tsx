'use client';

import React from 'react';
import { Lock, CreditCard, ChevronRight } from 'lucide-react';
import Link from 'next/link';

interface PaywallProps {
    children: React.ReactNode;
    isLocked: boolean;
    featureName: string;
}

export default function Paywall({ children, isLocked, featureName }: PaywallProps) {
    if (!isLocked) return <>{children}</>;

    return (
        <div className="relative group">
            {/* Blurred Content */}
            <div className="filter blur-sm select-none pointer-events-none opacity-50 transition-all duration-700">
                {children}
            </div>

            {/* Lock Overlay */}
            <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
                <div className="bg-surface/90 backdrop-blur-xl border border-subtle p-10 rounded-3xl shadow-popover max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-accent-soft rounded-2xl flex items-center justify-center mx-auto mb-5 border border-subtle">
                        <Lock className="w-8 h-8 text-accent" />
                    </div>

                    <h2 className="text-2xl font-semibold text-primary mb-2 tracking-tight">Premium feature</h2>
                    <p className="text-secondary mb-6 text-sm">
                        {featureName} is included from the <span className="font-medium text-primary">Professional</span> plan. Upgrade to unlock it.
                    </p>

                    <div className="space-y-3">
                        <Link
                            href="/dashboard/billing"
                            className="btn-primary w-full py-3 flex items-center justify-center gap-2 group/btn"
                        >
                            <CreditCard className="w-5 h-5" />
                            Upgrade to unlock
                            <ChevronRight className="w-5 h-5 group-hover/btn:translate-x-0.5 transition-transform" />
                        </Link>
                        <p className="text-2xs text-tertiary">
                            Instant activation · Billed annually or monthly
                        </p>
                    </div>
                </div>
            </div>

            {/* Warning Barrier */}
            <div className="absolute inset-0 z-10 bg-transparent cursor-not-allowed" />
        </div>
    );
}
