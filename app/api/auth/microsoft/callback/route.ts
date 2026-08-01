import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { exchangeCode } from '@/lib/excel/graph';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { createAdminClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sameNonce = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function GET(req: Request) {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'runbutter.app';
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const baseUrl = `${proto}://${host}`;
  const settings = new URL('/settings/integrations', baseUrl);
  const back = (reason: string) => {
    settings.searchParams.set('microsoft', reason);
    const res = NextResponse.redirect(settings);
    res.cookies.set('ms_oauth_state', '', { path: '/api/auth/microsoft', maxAge: 0 });
    return res;
  };

  try {
    const { searchParams } = new URL(req.url);
    if (searchParams.get('error')) {
      // The most common one is the user simply clicking Cancel — not an error
      // worth an alarming message.
      return back(searchParams.get('error') === 'access_denied' ? 'cancelled' : 'error');
    }

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    if (!code || !state) return back('error');

    const expected = req.headers.get('cookie')?.match(/(?:^|;\s*)ms_oauth_state=([^;]+)/)?.[1];
    if (!expected || !sameNonce(expected, state)) return back('error');

    // Identity from OUR session on this request — never from anything
    // Microsoft echoed back.
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

    await exchangeCode(code, `${baseUrl}/api/auth/microsoft/callback`, workspaceId, v.userId);
    return back('connected');
  } catch (e: any) {
    console.error('microsoft callback:', e?.message || e);
    return back('error');
  }
}
