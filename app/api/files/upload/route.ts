import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { BUCKET, ensureFilesBucket, storagePath } from '@/lib/files/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/files/upload  (multipart: file, linkedObject?, linkedId?)
//
// Uploads into a PRIVATE bucket and records the row. Extraction is a separate
// call (/api/files/extract) on purpose: the upload itself is fast and should
// report success immediately, while parsing a 300-page scan is not.
//
// The bucket is private because this is where contracts and payroll end up.
// Reading a file goes through /api/files/[id], which mints a short-lived signed
// URL after re-checking workspace membership.

const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request) {
  const rl = rateLimit(`files-upload:${clientIp(req)}`, 60);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const v = await verifyPrivyToken(req);
  if (v.status === 'invalid') {
    return NextResponse.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401 });
  }

  let form: FormData;
  try { form = await req.formData(); } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
  }

  const file = form.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: `${file.name} is empty.` }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `${file.name} is larger than 50 MB.` }, { status: 413 });
  }

  const claimed = String(form.get('privyUserId') || '');
  const privy = v.status === 'verified' ? v.userId : claimed;
  if (!privy) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const linkedObject = String(form.get('linkedObject') || '').trim() || null;
  const linkedId = String(form.get('linkedId') || '').trim() || null;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }
  const admin = createAdminClient();

  let workspace = String(form.get('workspaceId') || '');
  if (!workspace) {
    const { data: ws } = await admin.rpc('get_my_workspace', { p_privy: privy });
    workspace = (ws as any)?.id || '';
  }
  if (!workspace) return NextResponse.json({ error: 'No workspace for this account' }, { status: 400 });

  try { await ensureFilesBucket(admin); } catch { /* upload below reports the real problem */ }

  const path = storagePath(workspace, file.name);
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
    upsert: false, contentType: file.type || 'application/octet-stream',
  });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // create_file is the membership check — it raises NOT_A_MEMBER for a
  // workspace the caller doesn't belong to. If it refuses, take the blob back
  // out: an orphaned object nobody can list is storage we keep paying for.
  const { data: id, error } = await admin.rpc('create_file', {
    p_privy: privy, p_workspace: workspace, p_name: file.name, p_path: path,
    p_mime: file.type || null, p_size: file.size,
    p_object: linkedObject, p_linked: linkedId,
  });

  if (error) {
    await admin.storage.from(BUCKET).remove([path]).then(() => {}, () => {});
    if (/NOT_A_MEMBER/.test(error.message)) {
      return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 });
    }
    if (/does not exist|schema cache/i.test(error.message)) {
      return NextResponse.json({ error: 'Files are not set up yet — run migration 0065 in Supabase.' }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id, name: file.name, path, size: file.size });
}
