import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export async function POST(req: Request) {
    try {
        const { email, privyUserId } = await req.json();

        if (!email || !privyUserId) {
            return NextResponse.json({ claimed: false });
        }

        const supabaseAdmin = createAdminClient();

        // Find a pending invite for this email
        const { data: invite } = await supabaseAdmin
            .from('company_users')
            .select('id')
            .eq('email', email.toLowerCase().trim())
            .is('privy_user_id', null)
            .maybeSingle();

        if (invite) {
            // Claim it by attaching the specific privy user ID!
            const { error: updateError } = await supabaseAdmin
                .from('company_users')
                .update({ privy_user_id: privyUserId })
                .eq('id', invite.id);

            if (updateError) throw updateError;
            return NextResponse.json({ claimed: true });
        }

        return NextResponse.json({ claimed: false });

    } catch (error: any) {
        console.error('Claim API Error:', error);
        return NextResponse.json({ error: error.message, claimed: false }, { status: 500 });
    }
}
