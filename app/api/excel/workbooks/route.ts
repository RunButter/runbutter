import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { getToken, listWorkbooks } from '@/lib/excel/graph';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Workbooks the connected Microsoft account can open, for the picker.
 *
 * A route rather than an RPC because it needs the OAuth token, which never
 * leaves the server. The workspace is resolved from the verified session, not
 * taken from the request: being able to name a workspace must not be enough to
 * browse someone's OneDrive.
 */
export async function GET(req: Request) {
  const rl = rateLimit(`xlwb:${clientIp(req)}`, 30);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });

  const admin = createAdminClient();
  const { data: ws } = await admin.rpc('get_my_workspace', { p_privy: v.userId });
  const workspaceId = (ws as any)?.id;
  if (!workspaceId) return NextResponse.json({ error: 'No workspace found for your account.' }, { status: 400 });

  try {
    const { token } = await getToken(workspaceId);
    const q = new URL(req.url).searchParams.get('q') || '';
    return NextResponse.json({ files: await listWorkbooks(token, q) });
  } catch (e: any) {
    if (e?.message === 'NOT_CONNECTED') {
      return NextResponse.json({ error: 'Microsoft is not connected, or the connection expired.', reconnect: true }, { status: 409 });
    }
    return NextResponse.json({ error: e?.message || 'Could not reach Microsoft.' }, { status: 502 });
  }
}
