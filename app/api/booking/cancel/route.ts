import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { afterCancelled, bookingError } from '@/lib/booking/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/booking/cancel { id, reason } — a team member cancels a booking.
 *
 * A route rather than a line in /api/rpc's ALLOWED, because cancelling is not
 * only a row: the Google event goes and the visitor is told why. cancel_booking
 * checks membership and role in SQL against the VERIFIED Privy id.
 */
export async function POST(req: Request) {
  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    return NextResponse.json({ error: v.status === 'unavailable' ? 'Sign-in could not be checked just now. Try again.' : 'Sign in again.' }, { status: v.status === 'unavailable' ? 503 : 401 });
  }
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const id = typeof b?.id === 'string' && /^[0-9a-f-]{36}$/i.test(b.id) ? b.id : null;
  if (!id) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
  const reason = String(b?.reason || '').slice(0, 500);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('cancel_booking', { p_privy: v.userId, p_id: id, p_reason: reason });
  if (error) {
    if (/FORBIDDEN/.test(error.message)) return NextResponse.json({ error: 'Viewers cannot cancel bookings.' }, { status: 403 });
    const [status, msg] = bookingError(error.message);
    return NextResponse.json({ error: msg }, { status });
  }
  await afterCancelled(admin, data as any, reason);
  return NextResponse.json({ ok: true });
}
