import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { updateCalendarEvent, cancelCalendarEvent } from '@/lib/google-calendar';
import { sendInterviewEmail } from '@/lib/hr/interview-email';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';

async function auth(req: NextRequest): Promise<{ privy: string } | Response> {
  const rl = rateLimit(`hr-iv:${clientIp(req)}`, 60);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    const msg = v.status === 'unavailable'
      ? 'Authentication is temporarily unavailable. Try again in a moment.'
      : 'Your session is invalid or expired. Sign in again.';
    return NextResponse.json({ error: msg }, { status: v.status === 'unavailable' ? 503 : 401 });
  }
  return { privy: v.userId };
}

// Reschedule / edit an interview: update the row, patch the calendar event, and
// re-email the candidate their new time. Google + email are best-effort.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await auth(req);
  if (a instanceof Response) return a;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const scheduledAt = typeof body?.scheduledAt === 'string' ? body.scheduledAt : '';
  const durationMinutes = Number.isFinite(body?.durationMinutes) ? Math.max(5, Math.min(480, body.durationMinutes)) : 30;
  const notes = typeof body?.notes === 'string' ? body.notes : '';
  if (!scheduledAt) return NextResponse.json({ error: 'Date/time is required' }, { status: 400 });
  const start = new Date(scheduledAt);
  if (isNaN(start.getTime())) return NextResponse.json({ error: 'Invalid date/time' }, { status: 400 });

  const db = createAdminClient();
  const { data: row, error } = await db.rpc('hr_update_interview', {
    p_privy: a.privy, p_id: params.id, p_scheduled_at: start.toISOString(),
    p_duration: durationMinutes, p_notes: notes,
  });
  if (error || !row) return NextResponse.json({ error: error?.message || 'Interview not found' }, { status: 400 });

  const end = new Date(start.getTime() + durationMinutes * 60000);
  if (row.google_calendar_event_id) {
    await updateCalendarEvent(a.privy, row.google_calendar_event_id, {
      start: start.toISOString(), end: end.toISOString(),
    }).catch(() => false);
  }

  let emailed = false;
  const r = await sendInterviewEmail({
    to: row.candidate_email, candidateName: row.candidate_name, company: row.company_name || 'the company',
    color: row.brand_color, position: row.position_title, whenISO: start.toISOString(),
    durationMinutes, meetLink: row.meet_link ?? null, kind: 'updated',
  }).catch(() => ({ ok: false }));
  emailed = !!r.ok && !(r as any).skipped;

  return NextResponse.json({ ok: true, emailed, meetLink: row.meet_link ?? null });
}

// Cancel: delete the row, remove the calendar event, notify the candidate.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await auth(req);
  if (a instanceof Response) return a;

  const db = createAdminClient();
  const { data: res, error } = await db.rpc('hr_cancel_interview', { p_privy: a.privy, p_id: params.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!res?.ok) return NextResponse.json({ error: 'Interview not found' }, { status: 404 });

  if (res.google_calendar_event_id) {
    await cancelCalendarEvent(a.privy, res.google_calendar_event_id).catch(() => false);
  }

  if (res.candidate_email) {
    await sendInterviewEmail({
      to: res.candidate_email, candidateName: res.candidate_name, company: res.company_name || 'the company',
      color: res.brand_color, position: res.position_title, whenISO: res.scheduled_at,
      durationMinutes: res.duration_minutes ?? 30, meetLink: null, kind: 'cancelled',
    }).catch(() => ({ ok: false }));
  }

  return NextResponse.json({ ok: true });
}
