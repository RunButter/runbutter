// Sends a branded status-update email to a candidate when their pipeline
// stage changes. Server-only (uses the admin client + Resend).
//
// Only a curated set of candidate-facing statuses trigger an email — internal
// states like "applied" are skipped to avoid noise. Safe no-op if RESEND_API_KEY
// is missing or the actor isn't authorized for the candidate's company.

import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase';

interface TemplateCtx {
    name: string;
    position: string;
    company: string;
    color: string;
}

// status -> email content. Statuses absent here are intentionally not emailed.
const TEMPLATES: Record<string, (c: TemplateCtx) => { subject: string; heading: string; body: string }> = {
    screening: (c) => ({
        subject: `Your application for ${c.position} is under review`,
        heading: 'Your application is under review',
        body: `Good news — your application for <strong>${c.position}</strong> at <strong>${c.company}</strong> is now being reviewed by the hiring team. We'll be in touch with next steps soon.`,
    }),
    assessment_sent: (c) => ({
        subject: `Action needed: complete your assessment for ${c.position}`,
        heading: 'Time for your assessment',
        body: `You're progressing for the <strong>${c.position}</strong> role at <strong>${c.company}</strong>. The next step is a short personality & skills assessment — please check your earlier email for your unique assessment link.`,
    }),
    interview_scheduled: (c) => ({
        subject: `You're moving to interviews — ${c.position}`,
        heading: "Great news — you're moving forward!",
        body: `The team at <strong>${c.company}</strong> would like to interview you for the <strong>${c.position}</strong> role. We'll follow up shortly with the scheduling details.`,
    }),
    offered: (c) => ({
        subject: `An offer is on its way — ${c.position}`,
        heading: 'You have an offer! 🎉',
        body: `We're delighted to let you know that <strong>${c.company}</strong> is preparing an offer for the <strong>${c.position}</strong> role. Someone from the team will reach out with the details very soon.`,
    }),
    hired: (c) => ({
        subject: `Welcome aboard at ${c.company}!`,
        heading: 'Welcome to the team! 🎉',
        body: `It's official — welcome to <strong>${c.company}</strong> as our new <strong>${c.position}</strong>! We're thrilled to have you. Your onboarding details will follow shortly.`,
    }),
    rejected: (c) => ({
        subject: `Update on your application for ${c.position}`,
        heading: 'Update on your application',
        body: `Thank you for your interest in the <strong>${c.position}</strong> role at <strong>${c.company}</strong>, and for the time you invested in applying. After careful consideration we won't be moving forward at this stage. We were genuinely impressed and encourage you to apply for future roles that fit your skills.`,
    }),
};

export interface StatusEmailResult {
    ok: boolean;
    skipped?: boolean;
    reason?: string;
}

export async function sendStatusEmail(
    candidateId: string,
    status: string,
    privyUserId: string
): Promise<StatusEmailResult> {
    const template = TEMPLATES[status];
    if (!template) return { ok: true, skipped: true, reason: 'status_not_notifiable' };
    if (!process.env.RESEND_API_KEY) return { ok: true, skipped: true, reason: 'no_api_key' };

    const admin = createAdminClient();

    const { data: candidate } = await admin
        .from('candidates')
        .select('full_name, email, company_id, position_id')
        .eq('id', candidateId)
        .single();
    if (!candidate?.email) return { ok: true, skipped: true, reason: 'no_candidate_email' };

    // Authorization: actor must belong to the candidate's company.
    const { data: perm } = await admin
        .from('company_users')
        .select('id')
        .eq('privy_user_id', privyUserId)
        .eq('company_id', candidate.company_id)
        .single();
    if (!perm) return { ok: false, reason: 'unauthorized' };

    const [{ data: position }, { data: company }] = await Promise.all([
        candidate.position_id
            ? admin.from('positions').select('title').eq('id', candidate.position_id).single()
            : Promise.resolve({ data: null as any }),
        admin.from('companies').select('name, brand_color').eq('id', candidate.company_id).single(),
    ]);

    const ctx: TemplateCtx = {
        name: (candidate.full_name || 'there').split(' ')[0],
        position: position?.title || 'the role',
        company: company?.name || 'the company',
        color: company?.brand_color || '#4F46E5',
    };
    const { subject, heading, body } = template(ctx);

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
        from: 'runbutter.app <hello@runbutter.app>',
        to: [candidate.email],
        subject,
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <h1 style="color: ${ctx.color};">${heading}</h1>
                </div>
                <p>Hi ${ctx.name},</p>
                <p style="line-height: 1.6;">${body}</p>
                <p style="margin-top: 24px;">If you have any questions, just reply to this email.</p>
                <p>Best regards,<br/>The ${ctx.company} Hiring Team</p>
                <hr style="border: 0; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
                <p style="font-size: 12px; color: #6B7280; text-align: center;">Powered by runbutter.app</p>
            </div>
        `,
    });

    if (error) {
        console.error('Status email Resend error:', error);
        return { ok: false, reason: error.message };
    }
    return { ok: true };
}
