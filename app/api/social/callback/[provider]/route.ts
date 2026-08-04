import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { providerFor, PROVIDER_IDS, exchangeCode, sealTokens, type ProviderId } from '@/lib/social/providers';
import { verifyState, redirectUri } from '@/lib/social/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/social/callback/<provider>?code=…&state=…
 *
 * Where the platform sends the user back. Unauthenticated by necessity — it is
 * a top-level browser navigation from linkedin.com, which carries no header we
 * could check — so the SIGNED STATE is the whole security boundary. It names
 * the workspace and the person, it is HMAC-signed with a server secret, and it
 * expires in ten minutes. Nothing else in the request is trusted.
 *
 * Always redirects back into the app rather than rendering JSON: the person is
 * looking at a browser tab, and an error is only useful where they can act on
 * it.
 */
function back(ok: boolean, message: string) {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  const q = new URLSearchParams(ok ? { social: 'connected' } : { social: 'error', reason: message.slice(0, 200) });
  return NextResponse.redirect(`${base}/settings/integrations?${q}`);
}

export async function GET(req: Request, { params }: { params: { provider: string } }) {
  if (!PROVIDER_IDS.includes(params.provider as ProviderId)) {
    return back(false, 'Unknown provider.');
  }
  const provider = providerFor(params.provider);
  const url = new URL(req.url);

  // The platform reports a refusal here, not by failing the exchange. Saying
  // "you cancelled" beats a generic failure for the commonest outcome.
  const denied = url.searchParams.get('error');
  if (denied) return back(false, url.searchParams.get('error_description') || denied);

  const state = verifyState(url.searchParams.get('state'));
  if (!state || state.provider !== provider.id) {
    return back(false, 'That connection link expired or was tampered with. Try again.');
  }
  const code = url.searchParams.get('code');
  if (!code) return back(false, 'The platform did not return an authorization code.');

  try {
    // The verifier IS the state string — see lib/social/oauth.ts for why that
    // is sound (unforgeable without the server secret, so nothing to store).
    const tokens = await exchangeCode(provider.id, code, redirectUri(provider.id), url.searchParams.get('state') || '');
    const who = await provider.identify(tokens.accessToken);
    if (!who.externalId) return back(false, `${provider.label} did not identify the account.`);

    const sealed = sealTokens(tokens);
    const db = createAdminClient();
    const { error } = await db.rpc('save_social_account', {
      p_workspace: state.workspaceId, p_provider: provider.id, p_external_id: who.externalId,
      p_display_name: who.displayName, p_avatar_url: who.avatarUrl ?? null,
      p_access_cipher: sealed.access_cipher, p_access_iv: sealed.access_iv, p_access_tag: sealed.access_tag,
      p_refresh_cipher: sealed.refresh_cipher, p_refresh_iv: sealed.refresh_iv, p_refresh_tag: sealed.refresh_tag,
      p_expires_at: sealed.expires_at, p_scope: sealed.scope, p_privy: state.privyUserId,
    });
    if (error) return back(false, error.message);
    return back(true, '');
  } catch (e: any) {
    return back(false, e?.message || 'Could not complete the connection.');
  }
}
