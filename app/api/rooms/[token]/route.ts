import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { sendPush } from '@/lib/push/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/rooms/<token> — what is in a shared data room.
 *
 * Returns NAMES and SIZES. Never a URL and never a storage path: a link is
 * minted one file at a time by the sibling route, which re-checks that the file
 * is in this room. That split is what makes a room token a capability for
 * exactly the documents somebody chose, rather than a foothold.
 *
 * Its own route rather than /api/rpc for the same reason the snapshot reader
 * has one: that proxy rejects a tokenless request, and an investor reading a
 * deck has never signed in.
 *
 * Bad, revoked and expired tokens are all 404. Telling them apart would confirm
 * a room once existed.
 */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  const rl = rateLimit(`room:${clientIp(req)}`, 60);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const token = String(params.token || '');
  if (!/^[a-f0-9]{32}$/.test(token)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('get_data_room_public', { p_token: token });
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // "They opened it" — the notification that makes a shared link worth sending.
  // Throttling lives in SQL (0114): this fires on the first open in an hour and
  // returns null for the refreshes, so the route cannot get the policy wrong.
  //
  // Awaited rather than fire-and-forget: this runs on a serverless request that
  // may be frozen the moment the response is written, and a promise left
  // dangling there is one that sometimes never resolves. sendPush never throws
  // and does not touch the response, so the cost is a few milliseconds.
  try {
    const { data: notice } = await admin.rpc('data_room_open_notice', { p_token: token });
    if (notice) {
      await sendPush((notice as any).workspace_id, {
        title: 'Someone opened your documents',
        body: (notice as any).title || 'Data room',
        url: '/files', tag: `room-${token.slice(0, 8)}`,
      }, (notice as any).privy);
    }
  } catch { /* a notification must never cost the reader their documents */ }

  return NextResponse.json(data, { headers: { 'cache-control': 'no-store' } });
}
