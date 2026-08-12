import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { readJsonCapped, rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { isRegistrableRedirect, oauthError } from '@/lib/oauth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * RFC 7591 — dynamic client registration.
 *
 * OPEN, WITH NO ADMIN STEP, and that is the point rather than an oversight:
 * claude.ai has never heard of this deployment and this deployment has never
 * heard of claude.ai. An allowlist would mean every self-hoster filing a
 * request with us before their own MCP server worked.
 *
 * It is safe because a registered client can do NOTHING alone. It has no
 * secret, cannot read a workspace, and cannot obtain a token without a
 * signed-in human choosing a workspace on /oauth/authorize and pressing a
 * button. Registration buys a client_id and a promise about redirect_uris.
 *
 * Rate-limited because rows are cheap to create and this is unauthenticated.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`oauthreg:${clientIp(req)}`, 20, 60 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const capped = await readJsonCapped(req, 16 * 1024);
  if (!capped.ok) return oauthError('invalid_client_metadata', capped.error, capped.status);
  const b: any = capped.data || {};

  const uris: string[] = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u: any) => typeof u === 'string') : [];
  if (uris.length === 0) return oauthError('invalid_redirect_uri', 'redirect_uris is required');
  if (uris.length > 10) return oauthError('invalid_redirect_uri', 'Too many redirect_uris');
  const bad = uris.find((u) => !isRegistrableRedirect(u));
  if (bad) return oauthError('invalid_redirect_uri', `Not a usable redirect_uri: ${bad}`);

  // Only `none` is supported, and saying so explicitly is better than accepting
  // a request that claims a secret and then silently issuing a public client.
  if (b.token_endpoint_auth_method && b.token_endpoint_auth_method !== 'none') {
    return oauthError('invalid_client_metadata',
      'Only public clients are supported (token_endpoint_auth_method: "none"), with PKCE.');
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('oauth_register_client', {
    p_client_name: String(b.client_name || '').slice(0, 120),
    p_redirect_uris: uris,
    p_client_uri: typeof b.client_uri === 'string' ? b.client_uri.slice(0, 500) : null,
    p_logo_uri: typeof b.logo_uri === 'string' ? b.logo_uri.slice(0, 500) : null,
  });
  if (error) {
    if (/INVALID_REDIRECT_URI/.test(error.message)) return oauthError('invalid_redirect_uri', error.message);
    if (/schema cache|does not exist/i.test(error.message)) {
      return oauthError('server_error', 'OAuth needs migration 0099 — run it in Supabase.', 503);
    }
    return oauthError('server_error', error.message, 500);
  }

  // 201, per RFC 7591 §3.2.1. A 200 here makes some clients treat it as a
  // read and never store the client_id.
  return NextResponse.json(data, { status: 201, headers: { 'cache-control': 'no-store' } });
}
