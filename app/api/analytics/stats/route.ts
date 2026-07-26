import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { umamiConfigured, getUmamiStats, umamiSnippet, UmamiError } from '@/lib/analytics/umami';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/analytics/stats?site=<uuid>&days=30
 *
 * Umami-backed stats for one site, in the same shape the dashboard already
 * renders. Returns `{ available: false }` — not an error — when Umami isn't
 * configured or this site was never linked, so the caller falls back to the
 * built-in Postgres pipeline and older sites keep their history.
 *
 * The Umami credential is instance-wide: it can read and delete every website
 * on the box. So authorisation happens HERE, against Postgres, before any Umami
 * call — get_site_umami re-checks workspace membership, and the Umami id is
 * whatever that row says, never something the client can pass in.
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(`analytics:${clientIp(req)}`, 120);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  // Requires a fully verified session — unlike /api/rpc, which fails open on a
  // JWKS outage using the identity the client claims. There is no claimed
  // identity here to fall back to, and the Umami credential is instance-wide,
  // so an unverifiable caller gets nothing. The client then falls back to the
  // built-in pipeline, so a Privy outage degrades the dashboard rather than
  // emptying it.
  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    return NextResponse.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401 });
  }
  const privy = v.userId;

  const url = new URL(req.url);
  const site = url.searchParams.get('site') || '';
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
  if (!/^[0-9a-f-]{36}$/i.test(site)) {
    return NextResponse.json({ error: 'Unknown site.' }, { status: 400 });
  }
  if (!umamiConfigured()) return NextResponse.json({ available: false, reason: 'not_configured' });

  const admin = createAdminClient();
  const { data: link, error } = await admin.rpc('get_site_umami', { p_privy: privy, p_site: site });
  if (error) {
    // Migration 0059 hasn't been run — that's "fall back", not "fail".
    const missing = /does not exist|schema cache/i.test(error.message);
    return NextResponse.json(
      missing ? { available: false, reason: 'migration_pending' } : { error: error.message },
      { status: missing ? 200 : 403 },
    );
  }

  const websiteId = (link as any)?.umami_website_id;
  if (!websiteId) return NextResponse.json({ available: false, reason: 'not_linked' });

  try {
    const stats = await getUmamiStats(websiteId, days);
    return NextResponse.json({ available: true, stats, snippet: umamiSnippet(websiteId) });
  } catch (e: any) {
    const status = e instanceof UmamiError && e.status === 404 ? 404 : 502;
    return NextResponse.json({ error: e?.message || 'Umami is unreachable.' }, { status });
  }
}
