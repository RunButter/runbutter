import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { bookingTokenHash } from '@/lib/booking/token';
import { afterCancelled, afterRescheduled, bookingError, loadPage, pageSlots, slotIsFree, visitorView } from '@/lib/booking/server';
import type { BookingMail } from '@/lib/booking/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/booking/manage — the visitor's own booking, opened by the link in
 * their email (/book/manage?b=<id>&t=<token>). No account: the token is the key.
 *
 *   { action: 'get',        booking, token }
 *   { action: 'slots',      booking, token, from, to }
 *   { action: 'cancel',     booking, token, reason }
 *   { action: 'reschedule', booking, token, start }
 *
 * The SQL matches sha256(token) and never returns the host's id, address or
 * the Google event to this route's caller (booking_by_token strips them).
 */

const DAY = 86_400_000;
const uuid = (v: any) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
const fail = (message: string) => { const [status, error] = bookingError(message); return NextResponse.json({ error }, { status }); };

export async function POST(req: Request) {
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const action = String(b?.action || '');
  const ip = clientIp(req);
  const rl = action === 'get' || action === 'slots' ? rateLimit(`booking-read:${ip}`, 120) : rateLimit(`booking-write:${ip}`, 10);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const id = uuid(b?.booking);
  const token = typeof b?.token === 'string' ? b.token.slice(0, 200) : '';
  if (!id || !token) return fail('NOT_FOUND');
  const hash = bookingTokenHash(token);
  const admin = createAdminClient();

  try {
    const { data: current, error: e1 } = await admin.rpc('booking_by_token', { p_id: id, p_token_hash: hash });
    if (e1) return fail(e1.message);
    if (!current) return fail('NOT_FOUND');
    const cur = current as any;

    if (action === 'get') {
      return NextResponse.json({ booking: visitorView(cur), page: cur.page || null });
    }

    if (action === 'slots') {
      if (!cur.page?.slug || cur.status !== 'confirmed') return NextResponse.json({ slots: [] });
      const now = Date.now();
      const fromQ = Date.parse(String(b?.from || ''));
      const toQ = Date.parse(String(b?.to || ''));
      const from = new Date(Number.isFinite(fromQ) ? Math.max(fromQ, now) : now);
      const to = new Date(Math.min(Number.isFinite(toQ) ? toQ : from.getTime() + 35 * DAY, from.getTime() + 62 * DAY));
      const page = await loadPage(admin, cur.page.slug, from, to);
      if (!page) return NextResponse.json({ slots: [] });
      // Their own booking does not block the times around it.
      return NextResponse.json({ slots: pageSlots(page, from, to, { start: cur.starts_at, end: cur.ends_at }) });
    }

    if (action === 'cancel') {
      const reason = String(b?.reason || '').slice(0, 500);
      const { data, error } = await admin.rpc('booking_cancel_visitor', { p_id: id, p_token_hash: hash, p_reason: reason });
      if (error) return fail(error.message);
      await afterCancelled(admin, data as any, reason);
      return NextResponse.json({ booking: visitorView({ ...cur, status: 'cancelled' }) });
    }

    if (action === 'reschedule') {
      const start = new Date(String(b?.start || ''));
      if (!Number.isFinite(start.getTime())) return NextResponse.json({ error: 'Pick a time.' }, { status: 400 });
      if (!cur.page?.slug) return fail('PAGE_NOT_FOUND');
      const page = await loadPage(admin, cur.page.slug, start, new Date(start.getTime() + DAY));
      if (!page) return fail('PAGE_NOT_FOUND');
      if (!slotIsFree(page, start, { start: cur.starts_at, end: cur.ends_at })) return fail('SLOT_TAKEN');
      const { data, error } = await admin.rpc('booking_reschedule', { p_id: id, p_token_hash: hash, p_start: start.toISOString() });
      if (error) return fail(error.message);
      await afterRescheduled(admin, data as BookingMail);
      return NextResponse.json({ booking: visitorView(data) });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return fail(e?.message || '');
  }
}
