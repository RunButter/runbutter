import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2023-10-16' as any,
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// Map the purchased Stripe price back to a plan tier so a Starter buyer doesn't
// get upgraded to Professional. Falls back to 'professional' only if the price
// can't be resolved (preserves prior behaviour rather than silently failing).
async function planForSession(session: Stripe.Checkout.Session): Promise<'starter' | 'professional'> {
    const STARTER = process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID;
    const PRO = process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID;
    try {
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
        const priceId = lineItems.data[0]?.price?.id;
        if (priceId && STARTER && priceId === STARTER) return 'starter';
        if (priceId && PRO && priceId === PRO) return 'professional';
        console.warn(`Unrecognized Stripe price "${priceId}" — defaulting plan to professional`);
    } catch (e) {
        console.error('Could not resolve plan from line items:', e);
    }
    return 'professional';
}

export async function POST(req: NextRequest) {
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
            const plan = await planForSession(session);

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
