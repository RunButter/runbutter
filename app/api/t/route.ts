import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase';
import { requestContext, cleanUtm } from '@/lib/marketing/request-context';

export const runtime = 'nodejs';

/**
 * POST /api/t — event ingest for the first-party analytics snippet (t.js).
 * Body: { s: siteId, p: path, r: referrer, w: innerWidth, n?: eventName, d?: props }
 * Cookieless: the visitor id is sha256(dailySalt + ip + ua + site) truncated —
 * it rotates every day and stores no PII. Always 204s fast; never breaks the
 * host page. CORS is open (the snippet runs on customers' domains).
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const b = JSON.parse(raw || '{}');
    const siteId = String(b.s || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(siteId)) {
      return new NextResponse(null, { status: 204, headers: CORS }); // silently drop junk
    }

    const admin = createAdminClient();
    const { data: site } = await admin.from('sites').select('id, domain').eq('id', siteId).maybeSingle();
    if (!site) return new NextResponse(null, { status: 204, headers: CORS });

    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
    const ua = req.headers.get('user-agent') || '';
    const day = new Date().toISOString().slice(0, 10);
    const salt = process.env.ANALYTICS_SALT || process.env.KSEF_MASTER_KEY || 'hb-analytics';
    const visitor = crypto.createHash('sha256').update(`${salt}|${day}|${ip}|${ua}|${siteId}`).digest('hex').slice(0, 16);

    // Referrer → hostname only; self-referrals count as direct.
    let referrer = '';
    try {
      const host = b.r ? new URL(String(b.r)).hostname.replace(/^www\./, '') : '';
      if (host && host !== site.domain) referrer = host.slice(0, 100);
    } catch { /* invalid referrer → direct */ }

    const path = String(b.p || '/').slice(0, 200) || '/';

    /*
     * A custom event is the same row with a name on it (0120). Bounded hard,
     * because this endpoint is CORS-open by necessity — the snippet runs on
     * customers' domains — so everything it accepts is attacker-controlled.
     *
     * 'pageview' is reserved: a caller that could send it would be able to
     * inflate its own pageview count through the events API, and worse, a goal
     * matching a custom event named 'pageview' would match every row on the
     * site.
     */
    const rawName = typeof b.n === 'string' ? b.n.trim().slice(0, 60) : '';
    const name = rawName && rawName !== 'pageview' ? rawName : 'pageview';

    /*
     * Props are stored as sent and read by nothing but a human looking at a
     * dashboard — but "read by nothing" is not a reason to accept an unbounded
     * object into a JSONB column from an open endpoint. Twelve keys, short
     * scalar values, no nesting.
     */
    let props: Record<string, string> | null = null;
    if (b.d && typeof b.d === 'object' && !Array.isArray(b.d)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(b.d).slice(0, 12)) {
        if (v === null || v === undefined || typeof v === 'object') continue;
        out[String(k).slice(0, 40)] = String(v).slice(0, 200);
      }
      if (Object.keys(out).length) props = out;
    }
    const device = Number(b.w) > 0 && Number(b.w) < 768 ? 'mobile' : /Mobi|Android/i.test(ua) ? 'mobile' : 'desktop';

    // Country/city come from edge headers when a proxy provides them, browser
    // and OS from the UA. All null-safe: an absent value stays null instead of
    // becoming a guess (see lib/marketing/request-context.ts).
    const ctx = requestContext(req);
    const utm = cleanUtm(b);

    await admin.from('site_events').insert({
      site_id: siteId, path, referrer, visitor, device, name, props,
      country: ctx.country, region: ctx.region, city: ctx.city,
      browser: ctx.browser, os: ctx.os,
      ...utm,
    });
    return new NextResponse(null, { status: 204, headers: CORS });
  } catch {
    return new NextResponse(null, { status: 204, headers: CORS }); // never error at the client
  }
}
