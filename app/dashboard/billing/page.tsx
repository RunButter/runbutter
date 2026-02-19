'use client';

import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { CheckCircle, CreditCard, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function PricingPage() {
    const { ready, authenticated } = usePrivy();
    const [loading, setLoading] = useState(false);

    const plans = [
        { name: 'Starter', price: '$99', candidates: 50, positions: 5, features: ['Google Calendar', 'Custom Branding'] },
        { name: 'Professional', price: '$299', candidates: 200, positions: 'Unlimited', features: ['Advanced Analytics', 'Team Access', 'ATS Integration'] },
    ];

    const handleUpgrade = async (plan: string) => {
        setLoading(true);
        try {
            const response = await fetch('/api/stripe/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ planId: plan.toLowerCase(), companyId: 'current-company' })
            });
            const data = await response.json();
            if (data.url) {
                window.location.href = data.url;
            } else {
                throw new Error('No checkout URL returned');
            }
        } catch (error) {
            console.error('Upgrade error:', error);
            alert('Failed to start checkout. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    if (!ready) return null;

    return (
        <div className="min-h-screen bg-gray-50 py-12 px-6">
            <div className="max-w-4xl mx-auto text-center mb-12">
                <h1 className="text-3xl font-bold text-gray-800 mb-4">Upgrade Your Plan</h1>
                <p className="text-gray-600">Scale your recruitment with more positions and candidate slots.</p>
            </div>

            <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                {plans.map((plan) => (
                    <div key={plan.name} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-lg transition">
                        <div className="p-8">
                            <h3 className="text-xl font-bold text-gray-800 mb-2">{plan.name}</h3>
                            <div className="text-4xl font-bold text-gray-900 mb-6">{plan.price}<span className="text-lg font-normal text-gray-500">/mo</span></div>

                            <ul className="space-y-4 mb-8">
                                <li className="flex items-center gap-3 text-gray-600">
                                    <CheckCircle className="w-5 h-5 text-green-500" />
                                    {plan.candidates} candidates/month
                                </li>
                                <li className="flex items-center gap-3 text-gray-600">
                                    <CheckCircle className="w-5 h-5 text-green-500" />
                                    {plan.positions} active positions
                                </li>
                                {plan.features.map(f => (
                                    <li key={f} className="flex items-center gap-3 text-gray-600">
                                        <CheckCircle className="w-5 h-5 text-green-500" />
                                        {f}
                                    </li>
                                ))}
                            </ul>

                            <button
                                onClick={() => handleUpgrade(plan.name)}
                                disabled={loading}
                                className="w-full btn-primary py-3 flex items-center justify-center gap-2"
                            >
                                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
                                Upgrade Now
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-12 text-center text-sm text-gray-500">
                All plans include 14-day free trial. Need more? <Link href="/contact" className="text-primary-600 underline">Contact Sales</Link>
            </div>
        </div>
    );
}
