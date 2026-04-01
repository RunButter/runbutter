import { NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
    try {
        const { email, name, position, company, assessmentLink } = await req.json();

        if (!email || !name || !position) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        if (!process.env.RESEND_API_KEY) {
            console.log('Skipping welcome email: RESEND_API_KEY not configured.');
            return NextResponse.json({ success: true, message: 'Skipped - no API key' });
        }

        const companyName = company || 'Our Team';
        
        const { data, error } = await resend.emails.send({
            from: 'hirebtr.com <hello@hirebtr.com>',
            to: [email],
            subject: `Next Steps: Application for ${position} at ${companyName}`,
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <h1 style="color: #4F46E5;">Thank you for applying!</h1>
                    </div>
                    <p>Hi ${name},</p>
                    <p>We've successfully received your application and resume for the <strong>${position}</strong> position at <strong>${companyName}</strong>.</p>
                    
                    <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 24px 0;">
                        <h3 style="margin-top: 0; color: #1F2937;">Next Step: Complete Your Assessment</h3>
                        <p style="margin-bottom: 20px;">To move forward in the hiring process, please complete our brief, 15-minute personality and skills assessment.</p>
                        <a href="${assessmentLink}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Start Assessment Now</a>
                    </div>
                    
                    <p>This link is unique to you. If you have any questions, feel free to reply to this email.</p>
                    <p>Best regards,<br/>The ${companyName} Hiring Team</p>
                    <hr style="border: 0; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
                    <p style="font-size: 12px; color: #6B7280; text-align: center;">Powered by hirebtr.com</p>
                </div>
            `
        });

        if (error) {
            console.error('Resend Error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, data });

    } catch (error: any) {
        console.error('Welcome Email Route Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
