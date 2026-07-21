'use client';

import { getAccessToken } from '@privy-io/react-auth';
import { rpc } from '@/lib/rpc';

export interface SignRecipientLite { name: string; email: string; status: string }
export interface SignDocument {
  id: string; title: string; status: string; created_at: string; completed_at: string | null;
  signed: number; total: number; recipients: SignRecipientLite[];
}

export async function listSignDocuments(privy: string, workspaceId: string): Promise<SignDocument[]> {
  const { data } = await rpc('get_sign_documents', { p_privy: privy, p_workspace: workspaceId });
  return Array.isArray(data) ? data : [];
}

export async function voidSignDocument(privy: string, workspaceId: string, id: string): Promise<{ error?: string }> {
  const { data, error } = await rpc('void_sign_document', { p_privy: privy, p_workspace: workspaceId, p_id: id });
  if (error) return { error: error.message };
  if (data !== true) return { error: 'Could not void — it may already be signed.' };
  return {};
}

// Multipart create: uploads the PDF and registers recipients in one call.
export async function createSignRequest(
  file: File, title: string, recipients: { name: string; email: string }[],
): Promise<{ id?: string; emailed?: number; error?: string }> {
  const token = await getAccessToken().catch(() => null);
  const fd = new FormData();
  fd.append('file', file);
  fd.append('title', title);
  fd.append('recipients', JSON.stringify(recipients));
  const res = await fetch('/api/sign/create', {
    method: 'POST',
    headers: { ...(token ? { 'x-privy-token': token } : {}) },
    body: fd,
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) return { error: j?.error || `Upload failed (HTTP ${res.status})` };
  return { id: j.id, emailed: j.emailed };
}

// Owner download — opens the private file via a short-lived signed URL.
export async function downloadSignDocument(id: string, which: 'original' | 'signed') {
  const token = await getAccessToken().catch(() => null);
  const res = await fetch(`/api/sign/download?id=${id}&which=${which}`, {
    headers: { ...(token ? { 'x-privy-token': token } : {}) },
    redirect: 'follow',
  });
  if (res.ok && res.url) window.open(res.url, '_blank');
  else window.open(`/api/sign/download?id=${id}&which=${which}`, '_blank');
}
