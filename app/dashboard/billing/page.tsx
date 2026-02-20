'use client';

import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import {
    Check,
    CreditCard,
    ShieldCheck,
    Zap,
    CheckCircle2,
    AlertCircle,
    Loader2
} from 'lucide-react';
import CheckoutButton from '@/components/CheckoutButton';

export default function BillingPage() {
    const { ready, authenticated, user } = usePrivy();
    const [loading, setLoading] = useState(true);
    const [company, setCompany] = useState<any>(null);

    useEffect(() => {
        async function loadCompany() {
            if (ready && authenticated && user) {
                const { data, error } = await supabase
                    .from('company_users')
                    .select('*, company:companies(*)')
                    .eq('privy_user_id', user.id)
                    .maybeSingle();

                if (data?.company) {
                    setCompany(data.company);
                }
                setLoading(false);
            }
        }
        loadCompany();
    }, [ready, authenticated, user]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
        );
    }

    // Stripe Test Price ID - This would usually be in environment variables
    const PRO_PRICE_ID = 'price_1T30hHLJFoF9r61Qplaceholder'; // User should replace this

    return (
        <div className="max-w-5xl mx-auto px-6 py-12">
            <div className="mb-12">
                <h1 className="text-3xl font-black text-gray-900 flex items-center gap-3">
                    <CreditCard className="w-8 h-8 text-primary-600" />
                    Billing & Subscription
                </h1>
                <p className="text-gray-500 mt-2 font-medium">Manage your plan and seats for helpbtr.com</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Current Plan Card */}
                <div className="lg:col-span-1">
                    <div className="bg-white rounded-3xl p-8 border-2 border-primary-100 shadow-sm h-full">
                        <h3 className="text-xs font-black text-primary-600 uppercase tracking-widest mb-6">Current Plan</h3>
                        <div className="text-4xl font-black text-gray-900 mb-2 capitalize">
                            {company?.plan || 'Free'}
                        </div>
                        <p className="text-sm text-gray-500 mb-8 font-medium">
                            {company?.plan === 'professional'
                                ? 'High-performance recruitment features enabled.'
                                : 'Limited to basic recruitment tools.'}
                        </p>

                        <div className="space-y-4">
                            <div className="flex items-center gap-3 text-sm font-bold text-gray-700">
                                <CheckCircle2 className="w-5 h-5 text-green-500" />
                                {company?.plan === 'professional' ? 'Unlimited Candidates' : 'Up to 10 Candidates'}
                            </div>
                            <div className="flex items-center gap-3 text-sm font-bold text-gray-700">
                                <CheckCircle2 className="w-5 h-5 text-green-500" />
                                {company?.plan === 'professional' ? 'AI Assessment Reports' : 'Basic Metrics'}
                            </div>
                            <div className="flex items-center gap-3 text-sm font-bold text-gray-700 text-gray-400">
                                {company?.plan === 'professional' ? (
                                    <>
                                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                                        Priority Support
                                    </>
                                ) : (
                                    <>
                                        <div className="w-5 h-5 rounded-full border-2 border-gray-200" />
                                        No Priority Support
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Upgrade Card */}
                <div className="lg:col-span-2">
                    <div className="bg-gradient-to-br from-indigo-600 to-primary-700 rounded-3xl p-10 text-white shadow-2xl relative overflow-hidden h-full flex flex-col justify-between">
                        {/* Background pattern decor */}
                        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-20 -mt-20 blur-3xl pointer-events-none" />

                        <div className="relative z-10">
                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 rounded-full text-xs font-black uppercase tracking-widest mb-6">
                                <Zap className="w-3 h-3 fill-current" />
                                Highly Recommended
                            </div>
                            <h2 className="text-4xl font-black mb-4">Upgrade to Professional</h2>
                            <p className="text-indigo-100 mb-8 max-w-lg font-medium leading-relaxed">
                                Unlock advanced AI scoring, unlimited candidate screening, and deep personality insights to find your next high-performance hire.
                            </p>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10 text-sm font-bold">
                                <div className="flex items-center gap-2">
                                    <Check className="w-5 h-5 text-indigo-200" /> Real-time Radar Charts
                                </div>
                                <div className="flex items-center gap-2">
                                    <Check className="w-5 h-5 text-indigo-200" /> Multi-seat Recruiters
                                </div>
                                <div className="flex items-center gap-2">
                                    <Check className="w-5 h-5 text-indigo-200" /> AI Personality Synthesis
                                </div>
                                <div className="flex items-center gap-2">
                                    <Check className="w-5 h-5 text-indigo-200" /> White-labeled Assessments
                                </div>
                            </div>
                        </div>

                        <div className="relative z-10 flex flex-col sm:flex-row items-center gap-6">
                            {company && company.plan !== 'professional' ? (
                                <CheckoutButton
                                    companyId={company.id}
                                    priceId={PRO_PRICE_ID}
                                    companyName={company.name}
                                />
                            ) : (
                                <div className="bg-white/20 px-8 py-3 rounded-xl font-black flex items-center gap-2">
                                    <ShieldCheck className="w-5 h-5" />
                                    Your plan is active
                                </div>
                            )}
                            <div className="text-center sm:text-left">
                                <span className="text-2xl font-black">$49</span>
                                <span className="text-xs font-bold text-indigo-200 uppercase tracking-widest block">per month</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-12 p-6 bg-gray-50 rounded-2xl border border-gray-200 flex items-start gap-4">
                <AlertCircle className="w-6 h-6 text-gray-400 shrink-0 mt-0.5" />
                <div className="text-xs text-gray-500 font-medium leading-relaxed">
                    <p className="font-bold text-gray-700 mb-1 leading-none">Safe & Secure Payments</p>
                    Transactions are processed via Stripe for 100% security. We do not store your credit card information.
                    Subscriptions can be canceled at any time through the Stripe customer portal.
                </div>
            </div>
        </div>
    );
}
