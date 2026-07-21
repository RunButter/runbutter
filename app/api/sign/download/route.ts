import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'documents';

// Owner download of a signing document's original or signed PDF. The bucket is
// private, so we verify the caller belongs to the workspace, then hand back a
// short-lived signed URL rather than streaming bytes through the app.
export async function GET(req: NextRequest) {
  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    return NextResponse.json({ error: 'Sign in to download this document.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id') || '';
  const which = searchParams.get('which') === 'signed' ? 'signed' : 'original';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Bad document id' }, { status: 400 });

  const admin = createAdminClient();
  const { data: ws } = await admin.rpc('get_my_workspace', { p_privy: v.userId });
  if (!ws?.id) return NextResponse.json({ error: 'No workspace for your account' }, { status: 400 });

  const { data: file, error } = await admin.rpc('get_sign_document_file', { p_privy: v.userId, p_workspace: ws.id, p_id: id });
  if (error || !file) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

  const path = which === 'signed' ? file.signed_path : file.storage_path;
  if (!path) return NextResponse.json({ error: which === 'signed' ? 'Not signed yet' : 'File missing' }, { status: 404 });

  const { data: signed, error: sErr } = await admin.storage.from(BUCKET).createSignedUrl(path, 120);
  if (sErr || !signed?.signedUrl) return NextResponse.json({ error: sErr?.message || 'Could not create link' }, { status: 500 });

  return NextResponse.redirect(signed.signedUrl);
}
