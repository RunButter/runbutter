import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createAdminClient } from '@/lib/supabase';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { verifyEmail } from '@/lib/marketing/email-hygiene';
import { bookingToken, bookingTokenHash } from '@/lib/booking/token';
import { afterBooked, bookingError, loadPage, pageSlots, publicView, slotIsFree, visitorView } from '@/lib/booking/server';
import type { BookingMail } from '@/lib/booking/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET  /api/booking/<slug>?from=&to=  → { page, slots: ISO[] }
 * POST /api/booking/<slug>            → { booking, token }
 *
 * The visitor has no account. Called SAME-ORIGIN from /book/<slug> (also when
 * that page is framed on a customer's site), so there is no CORS surface.
 * The slots come from lib/booking/slots.ts and a POST is checked against the
 * SAME function before anything is written — the SQL then re-checks overlap
 * under a lock, which is what stops two people taking one slot.
 */

const DAY = 86_400_000;
const slugOk = (s: string) => /^[a-z0-9][a-z0-9-]{2,48}[a-z0-9]$/.test(s);
const fail = (message: string) => { const [status, error] = bookingError(message); return NextResponse.json({ error }, { status }); };

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const rl = rateLimit(`booking-read:${clientIp(req)}`, 120);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  const slug = String(params.slug || '').toLowerCase();
  if (!slugOk(slug)) return fail('PAGE_NOT_FOUND');
  const u = new URL(req.url);
  const now = Date.now();
  const fromQ = Date.parse(u.searchParams.get('from') || '');
  const toQ = Date.parse(u.searchParams.get('to') || '');
  const from = new Date(Number.isFinite(fromQ) ? Math.max(fromQ, now) : now);
  // At most ~two months a request: the page asks month by month.
  const to = new Date(Math.min(Number.isFinite(toQ) ? toQ : from.getTime() + 35 * DAY, from.getTime() + 62 * DAY));
  try {
    const page = await loadPage(createAdminClient(), slug, from, to);
    if (!page) return fail('PAGE_NOT_FOUND');
    return NextResponse.json({ page: publicView(page), slots: pageSlots(page, from, to) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return fail(e?.message || '');
  }
}

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const ip = clientIp(req);
  // A person books once; a script books a hundred. Per minute AND per hour.
  for (const [k, n, w] of [[`booking-write:${ip}`, 5, 60_000], [`booking-write-h:${ip}`, 20, 3_600_000]] as const) {
    const rl = rateLimit(k, n, w);
    if (!rl.ok) return tooMany(rl.retryAfterS);
  }
  const slug = String(params.slug || '').toLowerCase();
  if (!slugOk(slug)) return fail('PAGE_NOT_FOUND');
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  // Honeypot: a field no person sees. A bot that fills it gets a polite nothing.
  if (b?.website) return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 400 });

  const start = new Date(String(b?.start || ''));
  if (!Number.isFinite(start.getTime())) return NextResponse.json({ error: 'Pick a time.' }, { status: 400 });
  const name = String(b?.name || '').trim().slice(0, 120);
  if (!name) return fail('NAME_REQUIRED');

  const verdict = await verifyEmail(String(b?.email || ''));
  if (verdict.undeliverable) return NextResponse.json({ error: verdict.message, field: 'email' }, { status: 400 });
  // A suggestion is a question, asked once — same rule as forms.
  if (verdict.suggestion && b?.confirmEmail !== true) {
    return NextResponse.json({ error: verdict.message, field: 'email', suggestion: `${verdict.local}@${verdict.suggestion}`, confirmable: true }, { status: 400 });
  }

  const admin = createAdminClient();
  try {
    const page = await loadPage(admin, slug, start, new Date(start.getTime() + DAY));
    if (!page) return fail('PAGE_NOT_FOUND');
    // The time must be one the page OFFERS — inside the hours, on the grid.
    // The SQL checks overlap, notice and horizon, not working hours.
    if (!slotIsFree(page, start)) return fail('SLOT_TAKEN');

    const id = randomUUID();
    const token = bookingToken(id);
    const { data, error } = await admin.rpc('booking_book', {
      p_id: id, p_slug: slug, p_start: start.toISOString(), p_token_hash: bookingTokenHash(token),
      p_name: name, p_email: verdict.normalized, p_phone: String(b?.phone || '').slice(0, 40),
      p_company: String(b?.company || '').slice(0, 160), p_notes: String(b?.notes || '').slice(0, 2000),
      p_tz: String(b?.tz || '').slice(0, 64),
    });
    if (error) return fail(error.message);
    const booked = await afterBooked(admin, data as BookingMail);
    return NextResponse.json({ booking: visitorView(booked), token });
  } catch (e: any) {
    return fail(e?.message || '');
  }
}
