import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';

// Disconnect Google Calendar: revoke the grant at Google, then delete our copy
// of the tokens. Users must be able to withdraw access from inside the product
// (it's what our privacy policy promises and what OAuth verification checks),
// not only from Google's account settings.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`gdisc:${clientIp(req)}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    return NextResponse.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401 });
  }

  const db = createAdminClient();
  const { data: cu } = await db
    .from('company_users')
    .select('id')
    .eq('privy_user_id', v.userId)
    .order('created_at', { ascending: true })   // deterministic: no ORDER BY = arbitrary company
    .limit(1)
    .maybeSingle();
  if (!cu?.id) return NextResponse.json({ ok: true, alreadyDisconnected: true });

  const { data: token } = await db
    .from('integration_tokens')
    .select('id, access_token, refresh_token')
    .eq('user_id', cu.id)
    .eq('provider', 'google')
    .maybeSingle();
  if (!token) return NextResponse.json({ ok: true, alreadyDisconnected: true });

  // Tell Google to drop the grant. Best-effort: if it fails we still delete our
  // tokens, so the app can no longer act on the user's calendar either way.
  const revokeWith = token.refresh_token || token.access_token;
  if (revokeWith) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(revokeWith)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
  }

  const { error } = await db.from('integration_tokens').delete().eq('id', token.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
