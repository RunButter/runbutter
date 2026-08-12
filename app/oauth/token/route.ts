import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { hashToken, s256, mintToken, oauthError, ACCESS_TTL_SECONDS } from '@/lib/oauth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The token endpoint: authorization_code and refresh_token.
 *
 * FORM-ENCODED, not JSON. RFC 6749 §4.1.3 requires it and clients send it that
 * way; a handler that only reads JSON fails with an error message about a
 * missing grant_type, which sends everybody looking in the wrong place.
 *
 * The PKCE check itself lives in SQL (`oauth_redeem_code`), not here, so a
 * caller cannot skip it by forgetting to pass the verifier. What happens here
 * is only the hashing.
 */
async function readForm(req: Request): Promise<Record<string, string>> {
  const ct = (req.headers.get('content-type') || '').split(';')[0].trim();
  if (ct === 'application/x-www-form-urlencoded') {
    const text = await req.text();
    return Object.fromEntries(new URLSearchParams(text));
  }
  if (ct === 'application/json') {
    try { return (await req.json()) as any; } catch { return {}; }
  }
  return {};
}

export async function POST(req: Request) {
  const rl = rateLimit(`oauthtok:${clientIp(req)}`, 60);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const f = await readForm(req);
  const grant = String(f.grant_type || '');
  const clientId = String(f.client_id || '');
  if (!clientId) return oauthError('invalid_client', 'client_id is required');

  const admin = createAdminClient();
  const access = mintToken('rbt');
  const refresh = mintToken('rbr');

  if (grant === 'authorization_code') {
    const code = String(f.code || '');
    const verifier = String(f.code_verifier || '');
    const redirect = String(f.redirect_uri || '');
    if (!code) return oauthError('invalid_request', 'code is required');
    if (!verifier) return oauthError('invalid_request', 'code_verifier is required (PKCE)');
    if (!redirect) return oauthError('invalid_request', 'redirect_uri is required');

    const { data, error } = await admin.rpc('oauth_redeem_code', {
      p_code_hash: hashToken(code),
      p_client_id: clientId,
      p_redirect_uri: redirect,
      // The SQL stores the CHALLENGE; we send the challenge derived from the
      // verifier the client just presented, so the comparison in SQL is
      // challenge-to-challenge and the verifier itself is never stored.
      p_challenge_from_verifier: s256(verifier),
      p_token_hash: hashToken(access),
      p_refresh_hash: hashToken(refresh),
      p_ttl_seconds: ACCESS_TTL_SECONDS,
    });
    if (error) {
      if (/schema cache|does not exist/i.test(error.message)) return oauthError('server_error', 'OAuth needs migration 0099.', 503);
      return oauthError('server_error', error.message, 500);
    }
    const d: any = data || {};
    // A grant failure comes back as a VALUE, not an exception, because the
    // replay path revokes tokens first and `raise` would roll that back.
    if (d.error) return oauthError('invalid_grant', d.error);
    return NextResponse.json({
      access_token: access,
      token_type: 'Bearer',
      expires_in: d.expires_in ?? ACCESS_TTL_SECONDS,
      refresh_token: refresh,
      scope: d.scope === 'read' ? 'mcp:read' : 'mcp:full',
    }, { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } });
  }

  if (grant === 'refresh_token') {
    const token = String(f.refresh_token || '');
    if (!token) return oauthError('invalid_request', 'refresh_token is required');
    const { data, error } = await admin.rpc('oauth_refresh_token', {
      p_refresh_hash: hashToken(token),
      p_client_id: clientId,
      p_token_hash: hashToken(access),
      p_new_refresh_hash: hashToken(refresh),
      p_ttl_seconds: ACCESS_TTL_SECONDS,
    });
    if (error) return oauthError('server_error', error.message, 500);
    const d: any = data || {};
    if (d.error) return oauthError('invalid_grant', d.error);
    return NextResponse.json({
      access_token: access,
      token_type: 'Bearer',
      expires_in: d.expires_in ?? ACCESS_TTL_SECONDS,
      // Rotated on every use, the same rule the X integration follows (0082):
      // a refresh token that never changes is a permanent credential sitting in
      // somebody's config file.
      refresh_token: refresh,
      scope: d.scope === 'read' ? 'mcp:read' : 'mcp:full',
    }, { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } });
  }

  return oauthError('unsupported_grant_type', `Unsupported grant_type: ${grant || '(missing)'}`);
}
