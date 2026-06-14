import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { deliverWebhook } from '@/lib/webhooks';

export const runtime = 'nodejs';

/**
 * POST /api/webhooks/test
 * Body: { privyUserId, url, type }
 *
 * Sends a sample payload to a webhook URL so a recruiter can confirm it works
 * from the Settings page. Gated to authenticated company users; only ever POSTs
 * a fixed test message (the response body is never returned to the caller).
 */
export async function POST(req: Request) {
    try {
        const { privyUserId, url, type } = await req.json();
        if (!privyUserId || !url) {
            return NextResponse.json({ error: 'privyUserId and url are required' }, { status: 400 });
        }

        // Only real company users may use the server to send a test.
        const admin = createAdminClient();
        const { data: perm } = await admin
            .from('company_users')
            .select('id')
            .eq('privy_user_id', privyUserId)
            .maybeSingle();
        if (!perm) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

        const ok = await deliverWebhook(type || 'generic', url, 'application.created', {
            candidateName: 'Jane Doe (test)',
            position: 'Senior Engineer',
            company: 'Your Company',
            candidateUrl: process.env.NEXT_PUBLIC_APP_URL || undefined,
        });

        return ok
            ? NextResponse.json({ ok: true })
            : NextResponse.json({ ok: false, error: 'The endpoint did not accept the test (non-2xx or unreachable).' }, { status: 502 });
    } catch (error: any) {
        console.error('webhook test route error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
