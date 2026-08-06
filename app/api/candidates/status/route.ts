import { NextResponse } from 'next/server';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { createAdminClient } from '@/lib/supabase';
import { sendStatusEmail } from '@/lib/status-emails';
import { notifyStageChange } from '@/lib/webhooks';

export async function POST(req: Request) {
    try {
        const { candidateId, status, privyUserId } = await req.json();

        if (!candidateId || !status || !privyUserId) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }


        // The identity in the body is a CLAIM until this verifies it against the

        // Privy token — everything below acts as that user.

        const auth = await authorizePrivy(req, privyUserId);

        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

        const supabaseAdmin = createAdminClient();

        // 1. Verify permissions (User must belong to the same company as the candidate)
        const { data: candidate } = await supabaseAdmin
            .from('candidates')
            .select('company_id')
            .eq('id', candidateId)
            .single();

        if (!candidate) {
            return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
        }

        const { data: userPermission } = await supabaseAdmin
            .from('company_users')
            .select('role')
            .eq('privy_user_id', privyUserId)
            .eq('company_id', candidate.company_id)
            .single();

        if (!userPermission) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        // 2. Perform the update
        const { error: updateError } = await supabaseAdmin
            .from('candidates')
            .update({
                status: status,
                updated_at: new Date().toISOString()
            })
            .eq('id', candidateId);

        if (updateError) throw updateError;

        // 3. Notify the candidate of their new status (best-effort, non-fatal)
        try {
            await sendStatusEmail(candidateId, status, privyUserId);
        } catch (mailErr) {
            console.error('Status email failed (non-fatal):', mailErr);
        }

        // 4. Fan out to the company's webhook integrations (best-effort, never throws)
        await notifyStageChange(candidateId, status);

        return NextResponse.json({ success: true, status });

    } catch (error: any) {
        console.error('Status Update API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}