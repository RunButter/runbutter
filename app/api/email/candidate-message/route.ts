import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase';
import { renderTemplate } from '@/lib/render-template';

export const runtime = 'nodejs';

/**
 * POST /api/email/candidate-message
 * Body: { candidateId, subject, body, privyUserId }
 *
 * Sends a recruiter-composed (optionally template-based) email to a candidate.
 * Substitutes {{first_name}}, {{name}}, {{position}}, {{company}}, sends via
 * Resend, and logs the message to candidate history.
 */
export async function POST(req: Request) {
    try {
        const { candidateId, subject, body, privyUserId } = await req.json();
        if (!candidateId || !subject || !body || !privyUserId) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const admin = createAdminClient();

        const { data: candidate } = await admin
            .from('candidates')
            .select('full_name, email, company_id, position_id')
            .eq('id', candidateId)
            .single();
        if (!candidate?.email) {
            return NextResponse.json({ error: 'Candidate has no email' }, { status: 404 });
        }

        // Authorization: actor must belong to the candidate's company.
        const { data: perm } = await admin
            .from('company_users')
            .select('id')
            .eq('privy_user_id', privyUserId)
            .eq('company_id', candidate.company_id)
            .single();
        if (!perm) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

        const [{ data: position }, { data: company }] = await Promise.all([
            candidate.position_id
                ? admin.from('positions').select('title').eq('id', candidate.position_id).single()
                : Promise.resolve({ data: null as any }),
            admin.from('companies').select('name, brand_color').eq('id', candidate.company_id).single(),
        ]);

        const vars = {
            first_name: (candidate.full_name || 'there').split(' ')[0],
            name: candidate.full_name || 'there',
            position: position?.title || 'the role',
            company: company?.name || 'our company',
        };
        const finalSubject = renderTemplate(subject, vars);
        const finalBodyText = renderTemplate(body, vars);
        const color = company?.brand_color || '#4F46E5';

        if (!process.env.RESEND_API_KEY) {
            return NextResponse.json({ ok: true, skipped: true, reason: 'no_api_key' });
        }

        const resend = new Resend(process.env.RESEND_API_KEY);
        const { error } = await resend.emails.send({
            from: 'runbutter.app <hello@runbutter.app>',
            to: [candidate.email],
            subject: finalSubject,
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                    <div style="height: 4px; background: ${color}; border-radius: 4px; margin-bottom: 24px;"></div>
                    <div style="line-height: 1.6; white-space: pre-wrap;">${finalBodyText
                        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                    <hr style="border: 0; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
                    <p style="font-size: 12px; color: #6B7280; text-align: center;">Powered by runbutter.app</p>
                </div>
            `,
        });
        if (error) {
            console.error('candidate-message Resend error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Log to history (best-effort).
        await admin.rpc('log_candidate_message', {
            p_privy_user_id: privyUserId, p_candidate_id: candidateId,
            p_subject: finalSubject, p_body: finalBodyText,
        });

        return NextResponse.json({ ok: true });
    } catch (error: any) {
        console.error('candidate-message route error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
