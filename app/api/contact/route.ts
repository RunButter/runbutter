import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role to bypass RLS for logging
);

export async function POST(req: Request) {
    try {
        const { name, email, subject, message } = await req.json();

        if (!name || !email || !message) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // 1. Log to database (fallback if email fails)
        const { error: dbError } = await supabase
            .from('contact_messages')
            .insert([{ name, email, subject, message }]);

        if (dbError) console.error('DB Logging Error:', dbError);

        // 2. Send email via Resend
        if (process.env.RESEND_API_KEY) {
            const { data, error: emailError } = await resend.emails.send({
                from: 'hirebtr.com <onboarding@resend.dev>', // Resend default for unverified domains
                to: ['hello@hirebtr.com'],
                subject: `[Contact Form] ${subject || 'New Inquiry from ' + name}`,
                replyTo: email,
                html: `
                    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; rounded: 12px;">
                        <h2 style="color: #4F46E5;">New Contact Form Submission</h2>
                        <p><strong>Name:</strong> ${name}</p>
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>Subject:</strong> ${subject || 'N/A'}</p>
                        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                        <p style="white-space: pre-wrap;">${message}</p>
                    </div>
                `
            });

            if (emailError) {
                console.error('Email Error:', emailError);
                return NextResponse.json({ error: 'Message logged but email failed to send' }, { status: 500 });
            }

            return NextResponse.json({ success: true, data });
        } else {
            // If no API key, we still logged it to DB
            return NextResponse.json({
                success: true,
                message: 'Logged to database. (Email sending skipped: No API Key)'
            });
        }

    } catch (error: any) {
        console.error('Contact API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
