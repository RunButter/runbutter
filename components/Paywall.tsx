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
                <div className="bg-surface/80 backdrop-blur-xl border border-white p-10 rounded-3xl shadow-popover max-w-lg w-full text-center transform transition-all duration-500 scale-100 group-hover:scale-[1.02]">
                    <div className="w-20 h-20 bg-primary-50 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner border border-primary-100">
                        <Lock className="w-10 h-10 text-accent animate-pulse" />
                    </div>

                    <h2 className="text-3xl font-semibold text-primary mb-3 tracking-tight italic uppercase">Premium Feature</h2>
                    <p className="text-secondary mb-8 font-medium leading-relaxed uppercase text-xs tracking-widest">
                        {featureName} is only available on Professional and Enterprise plans.
                    </p>

                    <div className="space-y-3">
                        <Link
                            href="/dashboard/billing"
                            className="w-full btn-primary py-4 text-lg flex items-center justify-center gap-2 group/btn shadow-[0_10px_20px_rgba(79,70,229,0.2)]"
                        >
                            <CreditCard className="w-5 h-5" />
                            Upgrade to Unlock
                            <ChevronRight className="w-5 h-5 group-hover/btn:translate-x-1 transition-transform" />
                        </Link>
                        <p className="text-[10px] text-tertiary font-medium uppercase tracking-tighter">
                            Instant activation • Billed annually or monthly
                        </p>
                    </div>
                </div>
            </div>

            {/* Warning Barrier */}
            <div className="absolute inset-0 z-10 bg-transparent cursor-not-allowed" />
        </div>
    );
}
