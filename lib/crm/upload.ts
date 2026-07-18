'use client';

import { getAccessToken } from '@privy-io/react-auth';

// Single image-upload path for the app. Goes through /api/storage/upload, which
// runs on the service role and creates the storage bucket on demand — so this
// works on a fresh database without anyone running a migration first.
// workspaceId is optional — the server resolves it from the verified identity
// when omitted (RecordForm / post editor don't carry one).
export async function uploadImage(
  privyUserId: string, workspaceId: string | null, file: File, prefix = 'logo',
): Promise<{ url: string | null; error: string | null }> {
  try {
    const token = await getAccessToken().catch(() => null);
    const fd = new FormData();
    fd.append('file', file);
    if (workspaceId) fd.append('workspaceId', workspaceId);
    fd.append('privyUserId', privyUserId);
    fd.append('prefix', prefix);
    const res = await fetch('/api/storage/upload', {
      method: 'POST',
      headers: token ? { 'x-privy-token': token } : undefined,
      body: fd,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { url: null, error: j?.error || `Upload failed (${res.status})` };
    return { url: j.url as string, error: null };
  } catch (e: any) {
    return { url: null, error: e?.message || 'Upload failed' };
  }
}
