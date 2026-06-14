import { NextResponse } from 'next/server';
import { notifyNewApplication } from '@/lib/webhooks';

export const runtime = 'nodejs';

/**
 * POST /api/webhooks/applicant
 * Body: { candidateId }
 *
 * Fired (fire-and-forget) by the public application flow after a candidate is
 * created, so the company's configured webhooks (Slack/Discord/Zapier/etc.) get
 * a "new application" notification. The company is resolved server-side from the
 * candidate row; this only triggers webhooks the company itself registered.
 */
export async function POST(req: Request) {
    try {
        const { candidateId } = await req.json();
        if (!candidateId) {
            return NextResponse.json({ error: 'candidateId is required' }, { status: 400 });
        }
        await notifyNewApplication(candidateId);
        return NextResponse.json({ ok: true });
    } catch (error: any) {
        console.error('applicant webhook route error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
