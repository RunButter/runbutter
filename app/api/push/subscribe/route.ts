import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { sendPush } from '@/lib/push/send';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/push/subscribe — register this browser for notifications.
 * DELETE — unregister it.
 *
 * Its own route rather than /api/rpc because the subscription carries the
 * device's encryption keys, and because registering is the one moment worth
 * proving it works: a `test: true` body sends one notification straight back,
 * so the person finds out now rather than wondering for a week whether they
 * granted permission correctly.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`push:${clientIp(req)}`, 30);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, workspaceId, subscription, label, test } = b || {};
  if (!privyUserId || !workspaceId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: 'Incomplete subscription' }, { status: 400 });
  }

  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const admin = createAdminClient();
  const { error } = await admin.rpc('save_push_subscription', {
    p_privy: privyUserId, p_workspace: workspaceId,
    p_endpoint: String(subscription.endpoint),
    p_p256dh: String(subscription.keys.p256dh),
    p_auth: String(subscription.keys.auth),
    p_label: String(label || '').slice(0, 80),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (test) {
    const res = await sendPush(workspaceId, {
      title: 'Notifications are on',
      body: 'This is what one looks like.',
      url: '/home', tag: 'push-test',
    }, privyUserId);
    return NextResponse.json({ ok: true, test: res });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, endpoint } = b || {};
  if (!privyUserId || !endpoint) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const { error } = await createAdminClient().rpc('delete_push_subscription', {
    p_privy: privyUserId, p_endpoint: String(endpoint),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
