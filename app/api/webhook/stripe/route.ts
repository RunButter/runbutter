import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripeClient } from '@/lib/billing/stripe';
import { createAdminClient } from '@/lib/supabase';
import { PLANS, type SubscriptionPlan } from '@/lib/plans';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Which plan was bought.
 *
 * METADATA FIRST, because our own checkout route puts the plan there — it is
 * the one source that cannot be wrong about intent. Price ids are the fallback,
 * for a session created outside the app (a Stripe payment link, a manual
 * invoice), and they are matched against BOTH the current variable names and
 * the ATS-era ones so an existing deployment keeps working after an update.
 *
 * The old version of this function returned 'starter' | 'professional' — names
 * the product stopped selling — and defaulted to 'professional' whenever it
 * could not tell, which handed the most expensive tier to anyone whose price it
 * failed to recognise. It now falls back to the CHEAPEST paid tier: the payment
 * definitely happened, so Free would be wrong, and guessing upward is a discount
 * nobody agreed to. Either way the price id is logged, loudly, because that is
 * the fact an operator needs to fix the mapping.
 */
async function planForSession(stripe: Stripe, session: Stripe.Checkout.Session): Promise<SubscriptionPlan> {
    const declared = String(session.metadata?.plan || '').toLowerCase().trim();
    if (declared && declared in PLANS && declared !== 'free') return declared as SubscriptionPlan;

    const TEAM = process.env.NEXT_PUBLIC_STRIPE_TEAM_PRICE_ID || process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID;
    const BUSINESS = process.env.NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID || process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID;

    try {
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
        const priceId = lineItems.data[0]?.price?.id;
        if (priceId && TEAM && priceId === TEAM) return 'team';
        if (priceId && BUSINESS && priceId === BUSINESS) return 'business';
        console.warn(
            `Stripe price "${priceId}" is not mapped to a plan — falling back to Team. ` +
            'Set NEXT_PUBLIC_STRIPE_TEAM_PRICE_ID / NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID to the ids of your current products.',
        );
    } catch (e) {
        console.error('Could not resolve plan from line items:', e);
    }
    return 'team';
}

export async function POST(req: NextRequest) {
    // Both resolved per request. The client throws if constructed without a key,
    // and Next evaluates this module at build time — so a top-level one made
    // "billing not configured" fail the BUILD rather than the request.
    const stripe = stripeClient();
    if (!stripe || !webhookSecret) {
        // 503, not 400: nothing is wrong with Stripe's request. Stripe retries a
        // 5xx, so events survive an instance that is configured later.
        console.error('Stripe webhook received but billing is not configured (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET).');
        return NextResponse.json({ error: 'Billing is not configured on this instance.' }, { status: 503 });
    }

    const body = await req.text();
    const signature = req.headers.get('stripe-signature')!;

    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        const companyId = session.metadata?.company_id;

        if (companyId) {
            const supabase = createAdminClient();
            const plan = await planForSession(stripe, session);

            // Update company subscription status
            const { error } = await supabase
                .from('companies')
                .update({
                    plan,
                    subscription_status: 'active',
                    stripe_customer_id: session.customer as string,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', companyId);

            if (error) {
                console.error('Error updating company subscription:', error);
                return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
            }

            console.log(`Company ${companyId} successfully upgraded to ${plan}`);
        }
    }

    return NextResponse.json({ received: true });
}
