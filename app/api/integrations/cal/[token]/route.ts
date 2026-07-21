import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cal.com webhook receiver. Cal signs each POST with HMAC-SHA256 (hex) of the
// raw body in X-Cal-Signature-256, using the secret configured for this
// workspace. The URL token only names the workspace — the secret is the
// credential. On BOOKING_CREATED/RESCHEDULED we log a meeting, and match the
// attendee to a candidate to also record an interview.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const rl = rateLimit(`cal:${clientIp(req)}`, 120);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const token = (params.token || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(token)) return NextResponse.json({ error: 'bad token' }, { status: 404 });

  const raw = await req.text();
  const admin = createAdminClient();
  const { data: conn } = await admin.rpc('cal_resolve_connection', { p_token: token });
  if (!conn?.workspace_id) return NextResponse.json({ error: 'unknown' }, { status: 404 });
  if (!conn.enabled) return NextResponse.json({ ok: true, skipped: 'disabled' });

  // Verify the signature when a secret is configured (strongly recommended).
  if (conn.secret) {
    const sig = req.headers.get('x-cal-signature-256') || '';
    const expected = createHmac('sha256', conn.secret).update(raw).digest('hex');
    const ok = sig.length === expected.length &&
      timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!ok) return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  let body: any;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  const ev = body?.triggerEvent;
  if (ev !== 'BOOKING_CREATED' && ev !== 'BOOKING_RESCHEDULED') {
    return NextResponse.json({ ok: true, ignored: ev || 'unknown' });   // ack other events
  }

  const p = body?.payload || {};
  const attendee = Array.isArray(p.attendees) ? p.attendees[0] : null;
  const joinUrl = p.videoCallData?.url || p.videoCallUrl || (typeof p.location === 'string' && /^https?:\/\//.test(p.location) ? p.location : null) || null;

  const { data: res, error } = await admin.rpc('cal_log_meeting', {
    p_workspace: conn.workspace_id,
    p_external_id: p.uid || p.bookingId || null,
    p_title: p.title || p.eventTitle || 'Meeting',
    p_name: attendee?.name || null,
    p_email: attendee?.email || null,
    p_starts: p.startTime || null,
    p_ends: p.endTime || null,
    p_join_url: joinUrl,
    p_raw: body,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, matchedCandidate: !!res?.matched_candidate });
}
