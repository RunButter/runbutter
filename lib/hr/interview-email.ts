// Candidate-facing interview emails (scheduled / rescheduled / cancelled).
// Server-only (Resend). Safe no-op when RESEND_API_KEY is missing so local /
// self-host setups without email still schedule fine.

import { Resend } from 'resend';

export type InterviewEmailKind = 'scheduled' | 'updated' | 'cancelled';

interface Args {
  to: string;
  candidateName: string;
  company: string;
  color: string;
  position: string;
  whenISO: string;
  durationMinutes: number;
  meetLink: string | null;
  kind: InterviewEmailKind;
}

export interface InterviewEmailResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  // Unambiguous, timezone-labelled — the calendar invite carries the real
  // localised time; this line is just a human-readable confirmation.
  return d.toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  }) + ' (UTC)';
}

export async function sendInterviewEmail(a: Args): Promise<InterviewEmailResult> {
  if (!process.env.RESEND_API_KEY) return { ok: true, skipped: true, reason: 'no_api_key' };
  if (!a.to) return { ok: true, skipped: true, reason: 'no_email' };

  const first = (a.candidateName || 'there').split(' ')[0];
  const color = a.color || '#4F46E5';
  const when = fmtWhen(a.whenISO);
  const role = a.position || 'the role';

  const copy: Record<InterviewEmailKind, { subject: string; heading: string; intro: string }> = {
    scheduled: {
      subject: `Interview scheduled — ${role} at ${a.company}`,
      heading: 'Your interview is scheduled',
      intro: `Great news — the team at <strong>${a.company}</strong> has scheduled your interview for the <strong>${role}</strong> role.`,
    },
    updated: {
      subject: `Interview rescheduled — ${role} at ${a.company}`,
      heading: 'Your interview time has changed',
      intro: `Your interview with <strong>${a.company}</strong> for the <strong>${role}</strong> role has been rescheduled. Here are the updated details.`,
    },
    cancelled: {
      subject: `Interview cancelled — ${role} at ${a.company}`,
      heading: 'Your interview has been cancelled',
      intro: `Your interview with <strong>${a.company}</strong> for the <strong>${role}</strong> role has been cancelled. We'll be in touch if there's a new time to propose.`,
    },
  };
  const { subject, heading, intro } = copy[a.kind];

  const detailRows =
    a.kind === 'cancelled'
      ? ''
      : `
        <table role="presentation" style="width:100%; border-collapse:collapse; margin:20px 0; background:#F9FAFB; border-radius:10px;">
          <tr><td style="padding:12px 16px; color:#6B7280; font-size:13px;">When</td>
              <td style="padding:12px 16px; text-align:right; font-weight:600;">${when}</td></tr>
          <tr><td style="padding:12px 16px; color:#6B7280; font-size:13px;">Duration</td>
              <td style="padding:12px 16px; text-align:right; font-weight:600;">${a.durationMinutes} minutes</td></tr>
        </table>`;

  const meetButton =
    a.meetLink && a.kind !== 'cancelled'
      ? `<div style="text-align:center; margin:24px 0;">
           <a href="${a.meetLink}" style="display:inline-block; background:${color}; color:#fff; text-decoration:none; padding:12px 28px; border-radius:8px; font-weight:600;">Join Google Meet</a>
           <p style="font-size:12px; color:#9CA3AF; margin-top:10px;">or copy this link: ${a.meetLink}</p>
         </div>`
      : a.kind !== 'cancelled'
        ? `<p style="line-height:1.6;">The interviewer will share the meeting link with you separately.</p>`
        : '';

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: 'runbutter.app <hello@runbutter.app>',
    to: [a.to],
    subject,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <div style="text-align:center; margin-bottom:8px;"><h1 style="color:${color}; font-size:22px;">${heading}</h1></div>
        <p>Hi ${first},</p>
        <p style="line-height:1.6;">${intro}</p>
        ${detailRows}
        ${meetButton}
        <p style="margin-top:24px;">If you have any questions, just reply to this email.</p>
        <p>Best regards,<br/>The ${a.company} Hiring Team</p>
        <hr style="border:0; border-top:1px solid #E5E7EB; margin:24px 0;" />
        <p style="font-size:12px; color:#6B7280; text-align:center;">Powered by runbutter.app</p>
      </div>`,
  });

  if (error) {
    console.error('Interview email Resend error:', error);
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}
