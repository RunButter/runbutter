import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { providerFor, PROVIDER_IDS, type ProviderId } from '@/lib/social/providers';
import { signState, redirectUri } from '@/lib/social/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENV_HINT: Record<ProviderId, string> = {
  linkedin: 'LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET',
  x: 'X_CLIENT_ID / X_CLIENT_SECRET',
};

/**
 * GET /api/social/connect/<provider>
 *
 * Starts the OAuth dance and returns the authorize URL as JSON. Not a 302,
 * because the caller is a fetch from the settings panel and a redirect to
 * linkedin.com out of an XHR is not something the browser can act on.
 *
 * THE WORKSPACE IS DERIVED SERVER-SIDE, never taken from the request. It is
 * baked into a signed state that the callback then trusts, and what gets
 * written there is a credential that posts publicly — so this is the one place
 * the binding is decided, and a client does not get a say in it.
 */
export async function GET(req: Request, { params }: { params: { provider: string } }) {
  const rl = rateLimit(`social-connect:${clientIp(req)}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  if (!PROVIDER_IDS.includes(params.provider as ProviderId)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
  }
  const provider = providerFor(params.provider);
  if (!provider.configured()) {
    return NextResponse.json({
      error: `${provider.label} publishing is not set up on this server. Add ${ENV_HINT[provider.id]} to the environment.`,
    }, { status: 501 });
  }

  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    return NextResponse.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: ws } = await admin.rpc('get_my_workspace', { p_privy: v.userId });
  const workspaceId = (ws as any)?.id;
  if (!workspaceId) return NextResponse.json({ error: 'No workspace found for your account.' }, { status: 400 });

  try {
    const state = signState({ workspaceId, privyUserId: v.userId, provider: provider.id });
    return NextResponse.json({ url: provider.authorizeUrl(state, redirectUri(provider.id)) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not start the connection.' }, { status: 500 });
  }
}
