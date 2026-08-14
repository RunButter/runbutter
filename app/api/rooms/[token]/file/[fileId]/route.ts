import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { BUCKET } from '@/lib/files/storage';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TTL_S = 120;

/**
 * GET /api/rooms/<token>/file/<id> — a short-lived link to ONE document.
 *
 * THE MEMBERSHIP CHECK IS IN SQL, NOT HERE. data_room_file_path returns null
 * unless the file is in that room and belongs to that room's workspace, so this
 * route cannot be talked into signing something else by varying the id — which
 * is exactly what somebody holding a room token would try.
 *
 * Two minutes, matching the app's own file links: long enough to download, too
 * short to be worth passing on.
 */
export async function GET(req: Request, { params }: { params: { token: string; fileId: string } }) {
  const rl = rateLimit(`roomfile:${clientIp(req)}`, 120);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const token = String(params.token || '');
  const fileId = String(params.fileId || '');
  if (!/^[a-f0-9]{32}$/.test(token)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('data_room_file_path', { p_token: token, p_file: fileId });
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const row = data as { path: string; name: string };
  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(row.path, TTL_S, { download: row.name });
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: 'Could not create a link for this file.' }, { status: 500 });
  }
  return NextResponse.json({ url: signed.signedUrl, name: row.name }, { headers: { 'cache-control': 'no-store' } });
}
