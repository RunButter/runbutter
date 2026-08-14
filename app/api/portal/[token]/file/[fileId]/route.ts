import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { BUCKET } from '@/lib/files/storage';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TTL_S = 120;

/**
 * A short-lived link to one document attached to this portal.
 *
 * The membership check is in SQL (client_portal_file_path returns null unless
 * the file is on the portal AND in its workspace), so varying the id cannot
 * make this route sign something else.
 */
export async function GET(req: Request, { params }: { params: { token: string; fileId: string } }) {
  const rl = rateLimit(`portalfile:${clientIp(req)}`, 120);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const token = String(params.token || '');
  if (!/^[a-f0-9]{32}$/.test(token)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('client_portal_file_path', { p_token: token, p_file: String(params.fileId || '') });
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const row = data as { path: string; name: string };
  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET).createSignedUrl(row.path, TTL_S, { download: row.name });
  if (signErr || !signed?.signedUrl) return NextResponse.json({ error: 'Could not create a link.' }, { status: 500 });
  return NextResponse.json({ url: signed.signedUrl, name: row.name }, { headers: { 'cache-control': 'no-store' } });
}
