import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// The ONE real checkout route. A second, MOCK route used to live at
// /api/stripe/checkout: it never called Stripe, it just bounced the browser to
// `?success=true&plan=<undefined>`, so an "upgrade" charged nobody and upgraded
// nothing. That route is deleted; everything points here.

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2023-10-16' as any,
});

export async function POST(req: NextRequest) {
    try {
        const { companyId, priceId, companyName, plan, seats } = await req.json();

        if (!companyId || !priceId) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }
        if (String(priceId).includes('PLACEHOLDER')) {
            return NextResponse.json(
                { error: 'Stripe price id is not configured for this plan yet.' },
                { status: 400 }
            );
        }

        // Plans are PER SEAT, so quantity is the seat count, not 1. Hard-coding 1
        // billed a 30-person workspace the same as a solo one.
        const quantity = Math.max(1, Math.min(Number(seats) || 1, 999));

        const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity,
                    // Let the customer set their own seat count at checkout.
                    adjustable_quantity: { enabled: true, minimum: 1, maximum: 999 },
                },
            ],
            mode: 'subscription',
            allow_promotion_codes: true,
            success_url: `${origin}/dashboard/billing?success=true&plan=${encodeURIComponent(plan || '')}&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${origin}/dashboard/billing?canceled=true`,
            metadata: {
                company_id: companyId,
                company_name: companyName ?? '',
                plan: plan ?? '',
            },
            subscription_data: {
                metadata: { company_id: companyId, plan: plan ?? '' },
            },
        });

        return NextResponse.json({ sessionId: session.id, url: session.url });
    } catch (error: any) {
        console.error('Stripe checkout error:', { message: error?.message, type: error?.type });
        return NextResponse.json({ error: `Stripe error: ${error?.message}` }, { status: 500 });
    }
}
