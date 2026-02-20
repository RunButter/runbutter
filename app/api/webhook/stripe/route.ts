import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2023-10-16' as any,
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

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

            // Update company subscription status
            const { error } = await supabase
                .from('companies')
                .update({
                    plan: 'professional', // Or derive from price ID
                    subscription_status: 'active',
                    stripe_customer_id: session.customer as string,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', companyId);

            if (error) {
                console.error('Error updating company subscription:', error);
                return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
            }

            console.log(`Company ${companyId} successfully upgraded to Professional`);
        }
    }

    return NextResponse.json({ received: true });
}
