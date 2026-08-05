import { NextRequest, NextResponse } from 'next/server';
import { stripeClient } from '@/lib/billing/stripe';

// The ONE real checkout route. A second, MOCK route used to live at
// /api/stripe/checkout: it never called Stripe, it just bounced the browser to
// `?success=true&plan=<undefined>`, so an "upgrade" charged nobody and upgraded
// nothing. That route is deleted; everything points here.

export async function POST(req: NextRequest) {
    // Resolved per request, not at module scope: a top-level client throws when
    // STRIPE_SECRET_KEY is unset, and Next evaluates this module at build time.
    const stripe = stripeClient();
    if (!stripe) {
        return NextResponse.json(
            { error: 'Billing is not configured on this instance.' },
            { status: 503 },
        );
    }

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
        // A product id where a price id belongs. Stripe answers this with
        // "No such price: 'prod_…'", which reads as a missing object rather than
        // as the wrong KIND of object — and the two ids sit next to each other on
        // the same dashboard page, so it is the easy mistake to make. Say what to
        // do instead of forwarding a message that sends people looking for a
        // price that was never deleted.
        if (/^prod_/.test(String(priceId))) {
            return NextResponse.json(
                {
                    error: 'That is a Stripe PRODUCT id (prod_…), not a price id. Open the product in Stripe, ' +
                        'find its Pricing section, and copy the API id beginning with price_ into ' +
                        'NEXT_PUBLIC_STRIPE_TEAM_PRICE_ID or NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID.',
                },
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
