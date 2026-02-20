'use client';

import { useState } from 'react';
import { Loader2, CreditCard } from 'lucide-react';

interface CheckoutButtonProps {
    companyId: string;
    priceId: string;
    companyName: string;
}

export default function CheckoutButton({ companyId, priceId, companyName }: CheckoutButtonProps) {
    const [loading, setLoading] = useState(false);

    const handleCheckout = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/checkout', {
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
        } catch (error) {
            console.error('Checkout error:', error);
            alert('Could not initiate checkout. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <button
            onClick={handleCheckout}
            disabled={loading}
            className="btn-primary flex items-center justify-center gap-2 py-3 px-8 text-lg font-bold shadow-xl hover:translate-y-[-2px] transition-all"
        >
            {loading ? (
                <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    Processing...
                </>
            ) : (
                <>
                    <CreditCard className="w-6 h-6" />
                    Upgrade to Professional
                </>
            )}
        </button>
    );
}
