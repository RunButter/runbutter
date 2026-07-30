import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { BUCKET } from '@/lib/files/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGNED_URL_TTL_S = 120;

/**
 * GET /api/files/:id  → { url } — a signed URL valid for two minutes.
 *
 * A URL rather than the bytes: the browser then streams a 200 MB file straight
 * from storage instead of through this function. Short-lived because the link
 * carries no further authorisation once minted — long enough to click, not long
 * enough to be a shareable back door.
 *
 * The token is sent as a header, so this cannot be a plain <a href>; the client
 * fetches the URL and then opens it.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const rl = rateLimit(`files-get:${clientIp(req)}`, 120);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const v = await verifyPrivyToken(req);
  if (v.status === 'invalid') {
    return NextResponse.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401 });
  }
  const privy = v.status === 'verified' ? v.userId : new URL(req.url).searchParams.get('privyUserId') || '';
  if (!privy) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }
  const admin = createAdminClient();

  const { data: row, error } = await admin.rpc('get_file', { p_privy: privy, p_file: params.id });
  if (error || !row) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  const file = row as { storage_path: string; name: string };

  const { data, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(file.storage_path, SIGNED_URL_TTL_S, { download: file.name });
  if (signErr || !data?.signedUrl) {
    return NextResponse.json({ error: signErr?.message || 'Could not create a link for this file.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url: data.signedUrl, name: file.name, expires_in: SIGNED_URL_TTL_S });
}

/**
 * DELETE /api/files/:id
 *
 * Row first, then blob. delete_file hands back the storage path precisely so
 * the object can be removed too — deleting only the row would leave storage we
 * keep paying for and can no longer see.
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const rl = rateLimit(`files-del:${clientIp(req)}`, 60);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const v = await verifyPrivyToken(req);
  if (v.status === 'invalid') {
    return NextResponse.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401 });
  }
  const privy = v.status === 'verified' ? v.userId : new URL(req.url).searchParams.get('privyUserId') || '';
  if (!privy) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }
  const admin = createAdminClient();

  const { data, error } = await admin.rpc('delete_file', { p_privy: privy, p_file: params.id });
  if (error) {
    const forbidden = /NOT_FOUND_OR_FORBIDDEN/.test(error.message);
    return NextResponse.json({ error: forbidden ? 'File not found.' : error.message }, { status: forbidden ? 404 : 500 });
  }

  const path = (data as any)?.storage_path;
  // A storage failure here is not worth failing the request over — the row is
  // gone, which is what the user asked for. Logged so it can be swept up.
  if (path) {
    const { error: rmErr } = await admin.storage.from(BUCKET).remove([path]);
    if (rmErr) console.warn('files: row deleted but blob remains', path, rmErr.message);
  }

  return NextResponse.json({ ok: true });
}
