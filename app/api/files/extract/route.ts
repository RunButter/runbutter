import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { BUCKET } from '@/lib/files/storage';
import { extractFile } from '@/lib/files/extract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A scanned document going through OCR is genuinely slow; extract.ts bounds the
// OCR hop at three minutes and this leaves room around it.
export const maxDuration = 240;

/**
 * POST /api/files/extract   { fileId }
 *
 * Reads the stored blob, extracts text, writes it back. Split from the upload
 * so the upload can report success at once and so a failed parse is RETRYABLE —
 * pressing the button again re-runs only this half.
 *
 * get_file is the authorisation: it raises for a file outside the caller's
 * workspaces, which is the only membership check this route needs.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`files-extract:${clientIp(req)}`, 60);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const v = await verifyPrivyToken(req);
  if (v.status === 'invalid') {
    return NextResponse.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* validated below */ }
  const fileId = typeof body?.fileId === 'string' ? body.fileId : '';
  const privy = v.status === 'verified' ? v.userId : String(body?.privyUserId || '');
  if (!fileId) return NextResponse.json({ error: 'fileId is required' }, { status: 400 });
  if (!privy) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }
  const admin = createAdminClient();

  const { data: row, error: getErr } = await admin.rpc('get_file', { p_privy: privy, p_file: fileId });
  if (getErr || !row) {
    const forbidden = /NOT_FOUND_OR_FORBIDDEN/.test(getErr?.message || '');
    return NextResponse.json(
      { error: forbidden || !row ? 'File not found.' : getErr!.message },
      { status: forbidden || !row ? 404 : 500 },
    );
  }
  const file = row as { storage_path: string; name: string; mime_type: string | null };

  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(file.storage_path);
  if (dlErr || !blob) {
    // Record the failure rather than only returning it, so the list stops
    // showing "pending" forever for a file whose blob has gone missing.
    await admin.rpc('set_file_content', {
      p_privy: privy, p_file: fileId, p_content: null, p_status: 'failed',
      p_pages: null, p_error: 'The stored file could not be read.',
    }).then(() => {}, () => {});
    return NextResponse.json({ error: 'The stored file could not be read.' }, { status: 502 });
  }

  const bytes = Buffer.from(await blob.arrayBuffer());
  const out = await extractFile(bytes, file.name, file.mime_type || blob.type || '');

  const { error: setErr } = await admin.rpc('set_file_content', {
    p_privy: privy, p_file: fileId,
    p_content: out.text || null, p_status: out.status,
    p_pages: out.pages, p_error: out.error,
  });
  if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true, status: out.status, chars: out.text.length,
    pages: out.pages, note: out.error,
  });
}
