import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { umamiConfigured, createUmamiWebsite, umamiSnippet } from '@/lib/analytics/umami';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/analytics/site  { site: <uuid> }
 *
 * Provision the Umami website record for a site we already own, and store the
 * id it hands back. Split out from site creation so linking is retryable: if
 * Umami is down when someone adds a website, the site still exists, still
 * collects via the built-in pipeline, and can be linked later.
 *
 * Idempotency is enforced by Postgres, not by us — get_site_umami is checked
 * first, so a double-click can't leave two Umami websites for one domain with
 * only the second reachable.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`analytics-link:${clientIp(req)}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    return NextResponse.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401 });
  }
  if (!umamiConfigured()) {
    return NextResponse.json({ error: 'Umami is not configured on this deployment.' }, { status: 501 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const site = String(body?.site || '');
  if (!/^[0-9a-f-]{36}$/i.test(site)) return NextResponse.json({ error: 'Unknown site.' }, { status: 400 });

  const admin = createAdminClient();
  const { data: link, error: linkErr } = await admin.rpc('get_site_umami', { p_privy: v.userId, p_site: site });
  if (linkErr) {
    const missing = /does not exist|schema cache/i.test(linkErr.message);
    return NextResponse.json(
      { error: missing ? 'Run migration 0059 before connecting Umami.' : linkErr.message },
      { status: missing ? 400 : 403 },
    );
  }

  const existing = (link as any)?.umami_website_id;
  if (existing) return NextResponse.json({ ok: true, umami_website_id: existing, snippet: umamiSnippet(existing) });

  const domain = String((link as any)?.domain || '');
  if (!domain) return NextResponse.json({ error: 'That site has no domain to register.' }, { status: 400 });

  try {
    const website = await createUmamiWebsite(domain);
    if (!website?.id) throw new Error('Umami did not return a website id.');
    const { error: saveErr } = await admin.rpc('link_site_umami', {
      p_privy: v.userId, p_site: site, p_umami_id: website.id,
    });
    // The website now exists in Umami but we failed to record it. Say so
    // explicitly — silently returning success would orphan it, and the next
    // attempt would create a duplicate.
    if (saveErr) {
      return NextResponse.json({
        error: `Umami created the site (${website.id}) but linking it here failed: ${saveErr.message}`,
      }, { status: 500 });
    }
    return NextResponse.json({ ok: true, umami_website_id: website.id, snippet: umamiSnippet(website.id) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not reach Umami.' }, { status: 502 });
  }
}
