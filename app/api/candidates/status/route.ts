import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export async function POST(req: Request) {
    try {
        const { candidateId, status, privyUserId } = await req.json();

        if (!candidateId || !status || !privyUserId) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

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

        return NextResponse.json({ success: true, status });

    } catch (error: any) {
        console.error('Status Update API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
