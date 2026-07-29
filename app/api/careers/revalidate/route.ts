import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/careers/revalidate  { company: <uuid> }
 *
 * Drop the cached careers page for a workspace right now.
 *
 * WHY THIS EXISTS: /careers/[slug] is cached with `revalidate`, which is right
 * for a page that gets linked from job boards — but it meant hiding a role took
 * up to five minutes to actually disappear from the public URL. For a control
 * whose entire purpose is "make this not public", eventual consistency is the
 * wrong default: the owner clicks Hide, checks the link, and still sees the role.
 *
 * The slug is looked up server-side from the company id, so a caller cannot
 * revalidate (or probe the existence of) another workspace's page.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`careers-revalidate:${clientIp(req)}`, 60);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    return NextResponse.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const company = String(body?.company || '');
  if (!/^[0-9a-f-]{36}$/i.test(company)) return NextResponse.json({ error: 'Unknown company.' }, { status: 400 });

  const admin = createAdminClient();
  // get_careers_settings re-checks workspace membership, so this is the
  // authorisation step as well as the slug lookup.
  const { data, error } = await admin.rpc('get_careers_settings', { p_privy: v.userId, p_company: company });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  const slug = (data as any)?.slug;
  // No slug means no public page to invalidate — not an error worth surfacing.
  if (!slug) return NextResponse.json({ ok: true, revalidated: false });

  revalidatePath(`/careers/${slug}`);
  // Each role has its own cached page (0063), so purge the whole subtree —
  // otherwise hiding a role clears it from the list but leaves its detail page
  // live and linkable.
  revalidatePath(`/careers/${slug}/[positionId]`, 'page');
  return NextResponse.json({ ok: true, revalidated: true, slug });
}
