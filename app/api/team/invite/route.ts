import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { Resend } from 'resend';

export const runtime = 'nodejs';

const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy');
const ROLES = new Set(['owner', 'admin', 'member', 'recruiter', 'viewer']);

export async function POST(req: NextRequest) {
    try {
        const rl = rateLimit(`invite:${clientIp(req)}`, 30);
        if (!rl.ok) return tooMany(rl.retryAfterS);

        // Identity from the signed Privy token. This used to read privyUserId
        // and companyId out of the request body and then "verify" the caller
        // against those same values — so anyone who knew an admin's Privy DID
        // could invite themselves into that workspace as owner.
        const v = await verifyPrivyToken(req);
        if (v.status !== 'verified') {
            return NextResponse.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401 });
        }
        const privyUserId = v.userId;

        const { email, fullName, role } = await req.json();

        if (!email || !fullName || !role) {
            return NextResponse.json({ error: 'Name, email and role are required.' }, { status: 400 });
        }
        if (!ROLES.has(String(role))) {
            return NextResponse.json({ error: 'That role is not recognised.' }, { status: 400 });
        }

        const supabaseAdmin = createAdminClient();

        // 1. Caller's company + role, resolved server-side from the proven identity
        const { data: caller } = await supabaseAdmin
            .from('company_users')
            .select('role, company_id')
            .eq('privy_user_id', privyUserId)
            .limit(1)
            .maybeSingle();

        if (!caller || (caller.role !== 'owner' && caller.role !== 'admin')) {
            return NextResponse.json({ error: 'Only owners and admins can invite people.' }, { status: 403 });
        }
        // Only an owner may mint another owner.
        if (role === 'owner' && caller.role !== 'owner') {
            return NextResponse.json({ error: 'Only an owner can invite another owner.' }, { status: 403 });
        }
        const companyId = caller.company_id;

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

        // 4. Insert the pending member with a single-use invite token. The token
        //    is what proves the invite on the way back in — the previous flow
        //    matched only on email address, which anyone could guess.
        const inviteToken = randomUUID();
        const { error: insertError } = await supabaseAdmin
            .from('company_users')
            .insert({
                company_id: companyId,
                email: email.toLowerCase().trim(),  // stored normalised; lookups were case-sensitive before
                full_name: fullName,
                role: role,
                invite_token: inviteToken,
                invited_at: new Date().toISOString(),
                invited_by: privyUserId,
            });

        if (insertError) {
            throw new Error(`DB Error: ${insertError.message}`);
        }

        // 5. Send Invite Email via Resend
        const origin = req.headers.get('x-forwarded-host')
            ? `${req.headers.get('x-forwarded-proto') || 'https'}://${req.headers.get('x-forwarded-host')}`
            : (process.env.NEXT_PUBLIC_APP_URL || 'https://runbutter.app');
        const acceptUrl = `${origin}/auth/accept?token=${inviteToken}`;

        if (process.env.RESEND_API_KEY) {
            await resend.emails.send({
                from: 'RunButter <no-reply@runbutter.app>',
                to: email,
                subject: `You've been invited to join ${company?.name} on RunButter`,
                html: `
                    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333; padding: 20px;">
                        <h2 style="color:#111;">You've been invited to ${company?.name}</h2>
                        <p style="line-height:1.6;">You have been invited to collaborate with your team at <b>${company?.name}</b> on RunButter.</p>
                        <p style="line-height:1.6;">Your role: <b>${String(role).toUpperCase()}</b></p>
                        <div style="text-align:center; margin:28px 0;">
                          <a href="${acceptUrl}" style="background-color:#4653CE; color:#fff; padding:12px 28px; text-decoration:none; border-radius:8px; font-weight:600; display:inline-block;">Accept invitation</a>
                        </div>
                        <p style="font-size:12px; color:#6B7280; line-height:1.6;">
                          This link is unique to you and can only be used once. You can sign in with any
                          method — the invitation is tied to the link, not to how you sign in.
                          If the button doesn't work, paste this into your browser:<br/>
                          <span style="word-break:break-all;">${acceptUrl}</span>
                        </p>
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
