'use client';

import { useState } from 'react';
import { Loader2, CreditCard } from 'lucide-react';
import { useDialog } from '@/components/ui/Dialog';

interface CheckoutButtonProps {
    companyId: string;
    priceId: string;
    companyName: string;
    /** Plan key, echoed back on the success URL and stored on the subscription. */
    plan?: string;
    /** Seat count — plans are per seat, so this becomes the Stripe quantity. */
    seats?: number;
    text?: string;
    variant?: 'primary' | 'white' | 'dark';
}

export default function CheckoutButton({
    companyId,
    priceId,
    companyName,
    plan,
    seats,
    text,
    variant = 'primary'
}: CheckoutButtonProps) {
    const { notify } = useDialog();
    const [loading, setLoading] = useState(false);

    const handleCheckout = async () => {
        if (!priceId || priceId.includes('PLACEHOLDER')) {
            notify('Stripe Price ID is missing or invalid. Please configure your Price IDs in the billing page or environment variables.');
            return;
        }

        setLoading(true);
        try {
            // /api/checkout is the REAL Stripe session. This used to post to a
            // mock route that never touched Stripe and just redirected to a fake
            // success page, so no upgrade ever charged or applied.
            const response = await fetch('/api/checkout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    companyId,
                    priceId,
                    companyName,
                    plan,
                    seats,
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
            notify(`Could not initiate checkout: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    // On the design system: h-10, rounded-md off --radius, shadow-sm, no bouncy
    // translate. `white` is the readable variant on an inverse-filled card.
    const variantStyles =
        variant === 'white' ? 'bg-surface text-primary ring-1 ring-subtle hover:bg-surface-hover shadow-sm'
            : 'bg-inverse text-inverse-fg hover:bg-inverse/90 shadow-sm';

    return (
        <button
            onClick={handleCheckout}
            disabled={loading}
            className={`w-full h-10 inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none ${variantStyles}`}
        >
            {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Connecting…</>
            ) : (
                <><CreditCard className="w-4 h-4" /> {text || 'Upgrade'}</>
            )}
        </button>
    );
}
