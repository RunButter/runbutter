'use client';

import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import {
    Check,
    CreditCard,
    Zap,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Building2,
    Star,
    Globe,
    ArrowRight,
    ShieldCheck
} from 'lucide-react';
import CheckoutButton from '@/components/CheckoutButton';
import Link from 'next/link';

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

    // Stripe Price IDs - REPLACE THESE WITH YOUR ACTUAL STRIPE PRICE IDs
    const STARTER_PRICE_ID = process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID || 'price_STARTER_PLACEHOLDER';
    const PRO_PRICE_ID = process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID || 'price_PRO_PLACEHOLDER';

    const pricingTiers = [
        {
            name: 'Starter',
            price: '$99',
            interval: '/mo',
            description: 'Perfect for small teams and growing startups.',
            features: [
                'Up to 50 candidates/month',
                '5 active positions',
                'Google Calendar integration',
                'Custom branding'
            ],
            priceId: STARTER_PRICE_ID,
            buttonText: 'Get Started',
            highlight: false,
            tier: 'starter'
        },
        {
            name: 'Professional',
            price: '$299',
            interval: '/mo',
            description: 'Ideal for scaling companies with high hiring volume.',
            features: [
                'Up to 200 candidates/month',
                'Unlimited positions',
                'Advanced analytics',
                'ATS integrations',
                'Priority support'
            ],
            priceId: PRO_PRICE_ID,
            buttonText: 'Upgrade Now',
            highlight: true,
            tier: 'professional'
        },
        {
            name: 'Enterprise',
            price: 'Custom',
            interval: '',
            description: 'Enterprise-grade features and security for large scale.',
            features: [
                'Unlimited everything',
                'Custom assessments',
                'API access',
                'Dedicated support',
                'SLA guarantee'
            ],
            priceId: null,
            buttonText: 'Contact Sales',
            highlight: false,
            tier: 'enterprise',
            link: 'mailto:sales@hirebtr.com' // User can change this to a contact form
        }
    ];

    return (
        <div className="max-w-7xl mx-auto px-6 py-12">
            <div className="text-center mb-16">
                <h1 className="text-4xl font-black text-gray-900 flex items-center justify-center gap-3 mb-4">
                    <CreditCard className="w-10 h-10 text-primary-600" />
                    Transparent Pricing
                </h1>
                <p className="text-xl text-gray-500 font-medium max-w-2xl mx-auto">
                    Choose the plan that fits your helpbtr.com hiring needs. No hidden fees, just high-performance hiring.
                </p>
            </div>

            {/* Current Subscription Status */}
            <div className="mb-12 bg-white rounded-3xl p-8 border border-gray-100 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-primary-50 rounded-2xl flex items-center justify-center text-primary-600">
                        <Building2 className="w-8 h-8" />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-gray-900">Current Subscription</h3>
                        <p className="text-gray-500 font-medium capitalize">{company?.plan || 'Free'} Plan • {company?.subscription_status || 'Inactive'}</p>
                    </div>
                </div>
                {company?.plan === 'professional' && (
                    <div className="flex items-center gap-3 text-green-600 font-bold bg-green-50 px-6 py-3 rounded-2xl border border-green-100">
                        <ShieldCheck className="w-5 h-5" />
                        Professional Features Active
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {pricingTiers.map((tier) => (
                    <div
                        key={tier.name}
                        className={`relative flex flex-col p-8 rounded-3xl transition-all duration-300 ${tier.highlight
                            ? 'bg-gradient-to-b from-primary-600 to-indigo-700 text-white shadow-2xl scale-105 z-10'
                            : 'bg-white border-2 border-gray-100 text-gray-900 hover:border-primary-200 shadow-sm'
                            }`}
                    >
                        {tier.highlight && (
                            <div className="absolute top-0 right-8 transform -translate-y-1/2">
                                <span className="bg-orange-500 text-white text-[10px] font-black uppercase tracking-widest px-4 py-1.5 rounded-full shadow-lg flex items-center gap-2">
                                    <Star className="w-3 h-3 fill-current" />
                                    Most Popular
                                </span>
                            </div>
                        )}

                        <div className="mb-8">
                            <h3 className={`text-xl font-black mb-2 ${tier.highlight ? 'text-white' : 'text-gray-900'}`}>{tier.name}</h3>
                            <p className={`text-sm font-medium ${tier.highlight ? 'text-indigo-100' : 'text-gray-500'}`}>{tier.description}</p>
                        </div>

                        <div className="mb-8">
                            <div className="flex items-baseline gap-1">
                                <span className="text-5xl font-black">{tier.price}</span>
                                <span className={`text-sm font-bold uppercase tracking-widest ${tier.highlight ? 'text-indigo-200' : 'text-gray-400'}`}>
                                    {tier.interval}
                                </span>
                            </div>
                        </div>

                        <div className="space-y-4 mb-10 flex-grow">
                            {tier.features.map((feature) => (
                                <div key={feature} className="flex items-start gap-3 text-sm font-bold">
                                    <CheckCircle2 className={`w-5 h-5 shrink-0 ${tier.highlight ? 'text-indigo-300' : 'text-primary-500'}`} />
                                    <span className={tier.highlight ? 'text-indigo-50' : 'text-gray-700'}>{feature}</span>
                                </div>
                            ))}
                        </div>

                        {!tier.priceId ? (
                            <a
                                href={tier.link}
                                className={`w-full py-4 rounded-2xl font-black text-center transition flex items-center justify-center gap-2 ${tier.highlight
                                    ? 'bg-white text-primary-700 hover:bg-indigo-50 shadow-xl'
                                    : 'bg-gray-900 text-white hover:bg-gray-800'
                                    }`}
                            >
                                {tier.buttonText}
                                <ArrowRight className="w-4 h-4" />
                            </a>
                        ) : (
                            <CheckoutButton
                                companyId={company?.id}
                                priceId={tier.priceId}
                                companyName={company?.name}
                                text={tier.buttonText}
                                variant={tier.highlight ? 'white' : 'dark'}
                            />
                        )}
                    </div>
                ))}
            </div>

            <div className="mt-20 grid grid-cols-1 md:grid-cols-2 gap-8 items-center bg-gray-50 p-10 rounded-[40px] border border-gray-100">
                <div className="space-y-6">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary-100 text-primary-700 rounded-full text-[10px] font-black uppercase tracking-widest">
                        <Zap className="w-3 h-3 fill-current" />
                        Product Focus
                    </div>
                    <h2 className="text-3xl font-black text-gray-900 leading-tight">Scale your team with confidence</h2>
                    <p className="text-gray-600 font-medium leading-relaxed">
                        Our platform is built for high-performance teams who value speed and precision. Whether you are a small startup or a large enterprise, we have the tools to help you find the right talent.
                    </p>
                    <div className="flex items-center gap-8">
                        <div className="flex flex-col">
                            <span className="text-3xl font-black text-primary-600">98%</span>
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Client Satisfaction</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-3xl font-black text-primary-600">5k+</span>
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Candidates Assessed</span>
                        </div>
                    </div>
                </div>
                <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-xl relative overflow-hidden group">
                    <Globe className="absolute -right-20 -bottom-20 w-64 h-64 text-primary-50 opacity-50 group-hover:scale-110 transition-transform duration-700" />
                    <div className="relative z-10">
                        <h4 className="text-lg font-black text-gray-900 mb-4 flex items-center gap-3">
                            <AlertCircle className="w-5 h-5 text-primary-500" />
                            Infrastructure Ready
                        </h4>
                        <div className="space-y-4">
                            <p className="text-sm text-gray-500 font-medium leading-relaxed">
                                We use enterprise-grade security and Stripe for all payment processing. Your data is encrypted and secure.
                            </p>
                            <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                                <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Payment Security</span>
                                <div className="flex gap-2">
                                    <div className="w-8 h-5 bg-gray-100 rounded" />
                                    <div className="w-8 h-5 bg-gray-100 rounded" />
                                    <div className="w-8 h-5 bg-gray-100 rounded" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
