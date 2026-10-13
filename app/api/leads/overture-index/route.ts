import { NextResponse } from 'next/server';
import { rateLimit, tooMany } from '@/lib/security/http';
import '@/lib/leads/overture-server';
import { packedIndex, reasonOf } from '@/lib/leads/overture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/leads/overture-index — which rows of which Overture file cover
 * which box (lib/leads/overture.ts), so a browser can search the open data
 * without reading ~30 MB of footers first. Public data, no sign-in: it is the
 * same for everybody and says nothing about any workspace. Built once per
 * process and cached, so this costs the server almost nothing after the first.
 */
export async function GET(req: Request) {
  const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'anon';
  const rl = rateLimit(`overture-index:${ip}`, 60, 60 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  try {
    return NextResponse.json(await packedIndex(), {
      headers: { 'cache-control': 'public, max-age=21600, s-maxage=86400, stale-while-revalidate=86400' },
    });
  } catch (e) {
    return NextResponse.json({ error: reasonOf(e) }, { status: 503 });
  }
}
