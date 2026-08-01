import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { authUrl, msConfigured } from '@/lib/excel/graph';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { createAdminClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Start the Microsoft OAuth flow for the Excel sync (0079).
 *
 * Identity comes from the signed Privy token on this top-level navigation,
 * never from a query parameter — a forgeable ?workspaceId would let anyone
 * bind their own OneDrive to someone else's workspace, or bind a victim's
 * drive to a workspace the attacker controls.
 */
export async function GET(req: Request) {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'runbutter.app';
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const baseUrl = `${proto}://${host}`;
  const back = (reason: string) => {
    const u = new URL('/settings/integrations', baseUrl);
    u.searchParams.set('microsoft', reason);
    return NextResponse.redirect(u);
  };

  if (!msConfigured()) return back('notconfigured');

  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    const login = new URL('/auth/login', baseUrl);
    login.searchParams.set('redirectTo', '/settings/integrations');
    return NextResponse.redirect(login);
  }

  const admin = createAdminClient();
  const { data: ws } = await admin.rpc('get_my_workspace', { p_privy: v.userId });
  const workspaceId = (ws as any)?.id;
  if (!workspaceId) return back('noworkspace');

  // Single-use CSRF nonce, carried to Microsoft as `state` and mirrored in an
  // httpOnly cookie. The callback proceeds only if the two match, so a forged
  // callback cannot bind an account we never sent anyone to authorise.
  const nonce = randomBytes(16).toString('hex');
  const redirectUri = `${baseUrl}/api/auth/microsoft/callback`;

  const res = NextResponse.redirect(authUrl(nonce, redirectUri));
  res.cookies.set('ms_oauth_state', nonce, {
    httpOnly: true,
    secure: proto === 'https',
    sameSite: 'lax',   // sent on Microsoft's top-level redirect back to us
    path: '/api/auth/microsoft',
    maxAge: 600,
  });
  return res;
}
