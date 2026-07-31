import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyUrl, siteOrigin } from '@/lib/marketing/newsletter-links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Click tracking, then redirect.
 *
 * The destination is SIGNED. Without a signature this endpoint is an open
 * redirect: anyone could hand out runbutter.app/api/n/c/<id>?u=https://phish and
 * borrow our domain's reputation. Only URLs we actually put into a newsletter
 * carry a valid signature, so only those are followed — an unsigned or tampered
 * target goes to the site root instead, never to the attacker's URL.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const q = new URL(req.url).searchParams;
  const target = q.get('u') || '';
  const sig = q.get('s') || '';

  let ok = false;
  try { ok = Boolean(target) && verifyUrl(target, sig); } catch { ok = false; }
  if (!ok) return NextResponse.redirect(siteOrigin(), 302);

  let dest: URL;
  try { dest = new URL(target); } catch { return NextResponse.redirect(siteOrigin(), 302); }
  if (dest.protocol !== 'http:' && dest.protocol !== 'https:') {
    return NextResponse.redirect(siteOrigin(), 302);
  }

  try {
    const admin = createAdminClient();
    await admin.rpc('record_newsletter_event', { p_delivery: params.id, p_kind: 'click', p_url: dest.toString() });
  } catch { /* a failed stat must never strand the reader */ }

  return NextResponse.redirect(dest.toString(), 302);
}
