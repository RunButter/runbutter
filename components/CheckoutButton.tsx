'use client';

import { useState } from 'react';
import { Loader2, CreditCard } from 'lucide-react';

interface CheckoutButtonProps {
    companyId: string;
    priceId: string;
    companyName: string;
    text?: string;
    variant?: 'primary' | 'white' | 'dark';
}

export default function CheckoutButton({
    companyId,
    priceId,
    companyName,
    text,
    variant = 'primary'
}: CheckoutButtonProps) {
    const [loading, setLoading] = useState(false);

    const handleCheckout = async () => {
        if (!priceId || priceId.includes('PLACEHOLDER')) {
            alert('Stripe Price ID is missing or invalid. Please configure your Price IDs in the billing page or environment variables.');
            return;
        }

        setLoading(true);
        try {
            const response = await fetch('/api/stripe/checkout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    companyId,
                    priceId,
                    companyName,
                }),
            });

            const data = await response.json();

            if (data.url) {
                window.location.href = data.url;
            } else {
                throw new Error(data.error || 'Failed to create checkout session');
            }
        } catch (error: any) {
            console.error('Checkout error:', error);
            alert(`Could not initiate checkout: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const getVariantStyles = () => {
        switch (variant) {
            case 'white':
                return 'bg-surface text-accent hover:bg-surface-hover shadow-popover';
            case 'dark':
                return 'bg-gray-900 text-white hover:bg-gray-800';
            default:
                return 'btn-primary shadow-popover hover:translate-y-[-2px] transition-all';
        }
    };

    return (
        <button
            onClick={handleCheckout}
            disabled={loading}
            className={`w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold transition-all disabled:opacity-50 ${getVariantStyles()}`}
        >
            {loading ? (
                <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Connecting...
                </>
            ) : (
                <>
                    <CreditCard className="w-5 h-5" />
                    {text || 'Upgrade Now'}
                </>
            )}
        </button>
    );
}
