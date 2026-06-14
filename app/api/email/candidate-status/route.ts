import { NextResponse } from 'next/server';
import { sendStatusEmail } from '@/lib/status-emails';
import { notifyStageChange } from '@/lib/webhooks';

export const runtime = 'nodejs';

/**
 * POST /api/email/candidate-status
 * Body: { candidateId, status, privyUserId }
 *
 * Sends a candidate a branded status-update email. Used by the candidate
 * detail page (which updates status client-side). The pipeline board goes
 * through /api/candidates/status, which already triggers the same email.
 */
export async function POST(req: Request) {
    try {
        const { candidateId, status, privyUserId } = await req.json();
        if (!candidateId || !status || !privyUserId) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }
        const result = await sendStatusEmail(candidateId, status, privyUserId);

        // Fan out to the company's webhook integrations (best-effort, never throws)
        await notifyStageChange(candidateId, status);

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('candidate-status email route error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
