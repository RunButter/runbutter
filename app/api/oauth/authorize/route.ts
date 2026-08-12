import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { readJsonCapped, rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { hashToken, mintToken, normalizeScope } from '@/lib/oauth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The consent POST: a signed-in person hands ONE workspace to ONE client.
 *
 * Split from the page so the code is minted server-side behind a VERIFIED Privy
 * token. The browser never sees anything it could forge — it receives an
 * authorization code that is useless without the PKCE verifier the client kept.
 *
 * GET /oauth/authorize renders; this decides. The membership check that matters
 * is in SQL (`oauth_create_authorization`), because the workspace id arrives in
 * this request body and a person must not be walked into granting a workspace
 * they do not belong to.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`oauthauth:${clientIp(req)}`, 30);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const capped = await readJsonCapped(req, 16 * 1024);
  if (!capped.ok) return NextResponse.json({ error: capped.error }, { status: capped.status });
  const b: any = capped.data || {};
  const { privyUserId, workspaceId, clientId, redirectUri, codeChallenge, codeChallengeMethod, scope } = b;

  if (!privyUserId || !workspaceId || !clientId || !redirectUri) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
  }
  // S256 only. `plain` is legal in RFC 7636 and worth nothing.
  if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
    return NextResponse.json({ error: 'Only PKCE S256 is supported.' }, { status: 400 });
  }
  if (!codeChallenge) return NextResponse.json({ error: 'PKCE is required (code_challenge).' }, { status: 400 });

  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const code = mintToken('rbo');
  const admin = createAdminClient();
  const { error } = await admin.rpc('oauth_create_authorization', {
    p_privy: privyUserId,
    p_client_id: clientId,
    p_workspace: workspaceId,
    p_redirect_uri: redirectUri,
    p_code_hash: hashToken(code),
    p_code_challenge: codeChallenge,
    p_scope: normalizeScope(scope),
  });
  if (error) {
    if (/NOT_A_MEMBER/.test(error.message)) return NextResponse.json({ error: 'You are not a member of that workspace.' }, { status: 403 });
    if (/UNKNOWN_CLIENT/.test(error.message)) return NextResponse.json({ error: 'Unknown client.' }, { status: 400 });
    if (/INVALID_REDIRECT_URI/.test(error.message)) return NextResponse.json({ error: 'That redirect URI is not registered for this client.' }, { status: 400 });
    if (/schema cache|does not exist/i.test(error.message)) {
      return NextResponse.json({ error: 'Connecting apps needs migration 0099 — run it in Supabase.' }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // The code goes to the BROWSER, which redirects to the client's redirect_uri.
  // It is single-use, expires in ten minutes, and is worthless without the
  // verifier — so handing it to the page is not handing over a credential.
  return NextResponse.json({ code });
}

/**
 * What the consent screen needs to name the client and check the redirect
 * BEFORE showing a button. A screen that says "an app wants access" without
 * saying which app is a screen people click through.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') || '';
  const redirectUri = url.searchParams.get('redirect_uri') || '';
  if (!clientId) return NextResponse.json({ error: 'client_id is required' }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('oauth_get_client', { p_client_id: clientId, p_redirect_uri: redirectUri });
  if (error) {
    if (/schema cache|does not exist/i.test(error.message)) {
      return NextResponse.json({ error: 'Connecting apps needs migration 0099 — run it in Supabase.' }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Unknown client.' }, { status: 404 });
  return NextResponse.json(data, { headers: { 'cache-control': 'no-store' } });
}
