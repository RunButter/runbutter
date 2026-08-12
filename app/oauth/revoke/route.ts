import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { hashToken } from '@/lib/oauth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * RFC 7009 — revocation.
 *
 * An unknown or already-revoked token is a SUCCESS, deliberately: a revocation
 * endpoint that distinguishes them is an oracle for guessing which tokens
 * exist. The spec says 200 either way and means it.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`oauthrev:${clientIp(req)}`, 60);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const ct = (req.headers.get('content-type') || '').split(';')[0].trim();
  let f: Record<string, string> = {};
  if (ct === 'application/x-www-form-urlencoded') f = Object.fromEntries(new URLSearchParams(await req.text()));
  else { try { f = (await req.json()) as any; } catch { f = {}; } }

  const token = String(f.token || '');
  const clientId = String(f.client_id || '');
  if (token && clientId) {
    const admin = createAdminClient();
    await admin.rpc('oauth_revoke_token', { p_hash: hashToken(token), p_client_id: clientId });
  }
  return new NextResponse(null, { status: 200, headers: { 'cache-control': 'no-store' } });
}
