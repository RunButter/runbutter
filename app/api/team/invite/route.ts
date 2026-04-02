import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy');

export async function POST(req: Request) {
    try {
        const { email, fullName, role, companyId, privyUserId } = await req.json();

        if (!email || !fullName || !role || !companyId || !privyUserId) {
            return NextResponse.json({ error: 'Missing required configuration fields.' }, { status: 400 });
        }

        const supabaseAdmin = createAdminClient();

        // 1. Verify caller is an admin or owner
        const { data: caller } = await supabaseAdmin
            .from('company_users')
            .select('role')
            .eq('privy_user_id', privyUserId)
            .eq('company_id', companyId)
            .single();

        if (!caller || (caller.role !== 'owner' && caller.role !== 'admin')) {
            return NextResponse.json({ error: 'Unauthorized. You must be an Admin to invite members.' }, { status: 403 });
        }

        // 2. Enforce Pro limits
        const { data: company } = await supabaseAdmin
            .from('companies')
            .select('plan, name')
            .eq('id', companyId)
            .single();
            
        if (company?.plan === 'free') {
            return NextResponse.json({ error: 'Multi-user teams require a Premium plan.' }, { status: 403 });
        }

        // 3. Check if email is already in company
        const { data: existingUser } = await supabaseAdmin
            .from('company_users')
            .select('id')
            .eq('email', email)
            .eq('company_id', companyId)
            .maybeSingle();

        if (existingUser) {
            return NextResponse.json({ error: 'User is already a part of this organization.' }, { status: 400 });
        }

        // 4. Insert pending user
        const { error: insertError } = await supabaseAdmin
            .from('company_users')
            .insert({
                company_id: companyId,
                email: email,
                full_name: fullName,
                role: role
            });

        if (insertError) {
            throw new Error(`DB Error: ${insertError.message}`);
        }

        // 5. Send Invite Email via Resend
        if (process.env.RESEND_API_KEY) {
            await resend.emails.send({
                from: 'HireBtr <no-reply@hirebtr.com>',
                to: email,
                subject: `You've been invited to join ${company?.name} on HireBtr`,
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2>Welcome to HireBtr!</h2>
                        <p>You have been invited to collaborate with your team at <b>${company?.name}</b>.</p>
                        <p>Your assigned role is: <b>${role.toUpperCase()}</b></p>
                        <br/>
                        <a href="https://hirebtr.com/auth/login" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Accept Invitation & Setup Account</a>
                        <p style="margin-top: 20px; color: #666; font-size: 12px;">Ensure you sign up using this exact email address (${email}) so your portal automatically links.</p>
                    </div>
                `
            });
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error('Invite API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
