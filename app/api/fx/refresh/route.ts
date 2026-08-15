import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { parseEcb, ECB_DAILY, ECB_HIST90 } from '@/lib/finance/ecb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/fx/refresh — pull the European Central Bank's reference rates.
 *
 * ── THE SOURCE IS THE CENTRAL BANK, NOT A RATES API ─────────────────────────
 * Every commercial FX API bills per lookup for numbers the ECB publishes free,
 * unmetered and without a key, because the ECB is who sets them. Same rule as
 * OFAC for sanctions screening and VIES for VAT: go to the primary source and
 * cache it locally. There is also no vendor here to go out of business, change
 * its pricing, or start rate-limiting a self-hoster.
 *
 * ── TWO FEEDS, AND `?days=90` IS THE ONE YOU WANT FIRST ─────────────────────
 * The daily feed is one day. The 90-day feed is what makes historical invoices
 * convertible at all — and since conversion uses the rate on the transaction's
 * OWN date, a fresh install with only today's rates cannot value anything older
 * than today. Run it once with ?days=90, then daily.
 *
 * ── AUTH ────────────────────────────────────────────────────────────────────
 * `CRON_SECRET`, the same one the finance reminders and the Excel sweep use
 * (NOT the service-role `x-cron-secret` — see the two-cron-secrets note in the
 * docs). Rates are public data, so the secret is not protecting them; it is
 * protecting an unauthenticated endpoint that makes an outbound request and
 * writes, which is not a thing to leave open.
 */

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not set. This endpoint writes and makes an outbound request, so it refuses to run unauthenticated.' },
      { status: 503 });
  }
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || url.searchParams.get('key') || '';
  if (given !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const wantHistory = url.searchParams.get('days') === '90';
  const feed = wantHistory ? ECB_HIST90 : ECB_DAILY;

  let xml: string;
  try {
    const res = await fetch(feed, {
      // The ECB serves this to anyone, but an absent User-Agent is the single
      // most common cause of a silent block on a government host — the exact
      // failure OFAC's feed already taught us.
      headers: { 'User-Agent': 'RunButter/1.0 (+https://runbutter.app)' },
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ error: `ECB returned ${res.status}` }, { status: 502 });
    xml = await res.text();
  } catch (e: any) {
    return NextResponse.json({ error: `Could not reach the ECB: ${e?.message || 'network error'}` }, { status: 502 });
  }

  const days = parseEcb(xml);
  if (!days.length) {
    // A parse that returns nothing is reported as a failure, never as "0 rates
    // updated" — the second reads like a quiet success and would leave every
    // conversion silently unavailable.
    return NextResponse.json({ error: 'The ECB feed parsed to no rates. The format may have changed.' }, { status: 502 });
  }

  const admin = createAdminClient();
  let stored = 0;
  const failed: string[] = [];
  for (const d of days) {
    const { data, error } = await admin.rpc('save_fx_rates', { p_day: d.day, p_rates: d.rates });
    if (error) failed.push(`${d.day}: ${error.message}`);
    else stored += Number(data ?? 0);
  }

  return NextResponse.json({
    ok: failed.length === 0,
    feed: wantHistory ? '90-day' : 'daily',
    days: days.length,
    rates_stored: stored,
    latest: days[0]?.day,
    ...(failed.length ? { failed } : {}),
  }, { status: failed.length ? 502 : 200 });
}
