import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/storage/upload  (multipart: file, workspaceId, privyUserId, prefix?)
//
// Image uploads used to go straight from the browser to Supabase Storage on the
// anon key, which failed with an opaque error whenever the bucket or its
// policies weren't in place — the UI then told people to "run migration 0017",
// a dead end they can't act on. This route uploads with the service role and
// CREATES the bucket on demand, so it works on a fresh database with no
// migration required, and returns the real error when something else is wrong.

const BUCKET = 'branding';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'];

async function ensureBucket(admin: any) {
  const { data } = await admin.storage.getBucket(BUCKET);
  if (data) return;
  // Idempotent: a parallel request may win the race, which is fine.
  await admin.storage.createBucket(BUCKET, { public: true });
}

export async function POST(req: Request) {
  const rl = rateLimit(`upload:${clientIp(req)}`, 30);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 }); }

  const file = form.get('file') as File | null;
  let workspaceId = String(form.get('workspaceId') || '');
  const privyUserId = String(form.get('privyUserId') || '');
  const prefix = String(form.get('prefix') || 'logo').replace(/[^a-z0-9-]/gi, '');

  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });
  if (!privyUserId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Image must be under 5 MB' }, { status: 413 });
  if (file.type && !ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: `Unsupported file type "${file.type}". Use PNG, JPEG, WebP, SVG or GIF.` }, { status: 415 });
  }

  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const admin = createAdminClient();

  // Resolve the caller's workspace server-side when the client didn't send one
  // (RecordForm / post editor don't carry it), so callers stay simple.
  if (!workspaceId) {
    const { data: ws } = await admin.rpc('get_my_workspace', { p_privy: privyUserId });
    workspaceId = (ws as any)?.id || '';
  }
  if (!workspaceId) return NextResponse.json({ error: 'No workspace for this account' }, { status: 400 });

  // Membership check — a signed-in user may only write into their own workspace.
  const { error: memErr } = await admin.rpc('get_workspace_branding', { p_privy: privyUserId, p_workspace: workspaceId });
  if (memErr && /NOT_A_MEMBER/.test(memErr.message)) {
    return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 });
  }

  try { await ensureBucket(admin); } catch { /* fall through — upload reports the real problem */ }

  const ext = (file.name?.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${workspaceId}/${prefix}-${Date.now()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
    upsert: true, cacheControl: '3600', contentType: file.type || 'application/octet-stream',
  });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ ok: true, url: data.publicUrl });
}
