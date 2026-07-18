import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { createCalendarEvent } from '@/lib/google-calendar';
import { sendInterviewEmail } from '@/lib/hr/interview-email';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';

// Schedule an interview — the unified flow the two half-built paths were missing:
//   1. (best-effort) create a Google Meet calendar event on the recruiter's
//      connected calendar, inviting the candidate;
//   2. store the interviews row WITH the Meet link + calendar event id;
//   3. (best-effort) email the candidate their time + Meet link.
// Steps 1 and 3 are best-effort so scheduling still succeeds without a Google
// connection or a Resend key — the row is always written.

export async function POST(req: NextRequest) {
  const rl = rateLimit(`hr-iv:${clientIp(req)}`, 60);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    const msg = v.status === 'unavailable'
      ? 'Authentication is temporarily unavailable. Try again in a moment.'
      : 'Your session is invalid or expired. Sign in again.';
    return NextResponse.json({ error: msg }, { status: v.status === 'unavailable' ? 503 : 401 });
  }
  const privy = v.userId;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const candidateId = typeof body?.candidateId === 'string' ? body.candidateId : '';
  const scheduledAt = typeof body?.scheduledAt === 'string' ? body.scheduledAt : '';
  const durationMinutes = Number.isFinite(body?.durationMinutes) ? Math.max(5, Math.min(480, body.durationMinutes)) : 30;
  const notes = typeof body?.notes === 'string' ? body.notes : '';
  const sendEmail = body?.sendEmail !== false;

  if (!candidateId || !scheduledAt) return NextResponse.json({ error: 'Candidate and date/time are required' }, { status: 400 });
  const start = new Date(scheduledAt);
  if (isNaN(start.getTime())) return NextResponse.json({ error: 'Invalid date/time' }, { status: 400 });

  const db = createAdminClient();

  // Tenant-checked contact card (raises if the candidate isn't in the caller's company).
  const { data: contact, error: cErr } = await db.rpc('hr_candidate_contact', { p_privy: privy, p_candidate_id: candidateId });
  if (cErr || !contact) return NextResponse.json({ error: cErr?.message || 'Candidate not found' }, { status: 400 });

  // 1) best-effort Google Meet
  const end = new Date(start.getTime() + durationMinutes * 60000);
  let meetLink: string | null = null;
  let eventId: string | null = null;
  if (contact.email) {
    const ev = await createCalendarEvent(privy, {
      summary: `Interview: ${contact.full_name}${contact.position_title ? ` — ${contact.position_title}` : ''}`,
      description: `Interview scheduled via RunButter.${notes ? `\n\nNotes: ${notes}` : ''}`,
      start: start.toISOString(),
      end: end.toISOString(),
      attendees: [contact.email],
      conferenceData: true,
    }).catch(() => null);
    if (ev) { meetLink = ev.meetLink ?? null; eventId = ev.eventId ?? null; }
  }

  // 2) store the row (with the Meet link, if we got one)
  const { data: id, error: sErr } = await db.rpc('hr_schedule_interview', {
    p_privy: privy, p_candidate_id: candidateId, p_scheduled_at: start.toISOString(),
    p_duration: durationMinutes, p_notes: notes, p_meet_link: meetLink, p_event_id: eventId,
  });
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });

  // 3) best-effort candidate email
  let emailed = false;
  if (sendEmail) {
    const r = await sendInterviewEmail({
      to: contact.email, candidateName: contact.full_name, company: contact.company_name || 'the company',
      color: contact.brand_color, position: contact.position_title, whenISO: start.toISOString(),
      durationMinutes, meetLink, kind: 'scheduled',
    }).catch(() => ({ ok: false }));
    emailed = !!r.ok && !(r as any).skipped;
  }

  return NextResponse.json({ id, meetLink, meet: !!meetLink, emailed });
}
