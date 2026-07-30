'use client';

import { getAccessToken } from '@privy-io/react-auth';
import { rpc } from '@/lib/rpc';

// Client side of company files (migration 0065).
//
// Reads go through the RPC proxy; anything that touches the storage bucket goes
// through /api/files/*, because only the server holds the service-role key and
// the bucket is private.

export type ExtractStatus = 'pending' | 'text_layer' | 'ocr' | 'vision' | 'failed' | 'skipped';

export interface FileRow {
  id: string;
  name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  linked_object: string | null;
  linked_id: string | null;
  extract_status: ExtractStatus;
  extract_error: string | null;
  page_count: number | null;
  created_at: string;
  has_content: boolean;
  content_length: number;
}

export interface FileHit {
  id: string;
  name: string;
  linked_object: string | null;
  linked_id: string | null;
  extract_status: ExtractStatus;
  created_at: string;
  rank: number;
  /** Contains «…» around the matched words — see splitSnippet. */
  snippet: string;
}

const notSetUp = (message: string) => /does not exist|schema cache/i.test(message);

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken().catch(() => null);
  return token ? { 'x-privy-token': token } : {};
}

/** Everything in the workspace, or just what's attached to one record. */
export async function loadFiles(
  privyUserId: string, workspaceId: string,
  linkedObject?: string | null, linkedId?: string | null,
): Promise<{ files: FileRow[]; error?: string }> {
  const { data, error } = await rpc('get_files', {
    p_privy: privyUserId, p_workspace: workspaceId,
    p_object: linkedObject ?? null, p_linked: linkedId ?? null,
  });
  if (error) {
    return { files: [], error: notSetUp(error.message) ? 'Files are not set up yet — run migration 0065 in Supabase.' : error.message };
  }
  return { files: Array.isArray(data) ? (data as FileRow[]) : [] };
}

/** Full-text search over extracted content. Postgres FTS, no model, no cost. */
export async function searchFiles(
  privyUserId: string, workspaceId: string, query: string,
): Promise<{ hits: FileHit[]; error?: string }> {
  const { data, error } = await rpc('search_files', {
    p_privy: privyUserId, p_workspace: workspaceId, p_query: query,
  });
  if (error) {
    return { hits: [], error: notSetUp(error.message) ? 'Files are not set up yet — run migration 0065 in Supabase.' : error.message };
  }
  return { hits: Array.isArray(data) ? (data as FileHit[]) : [] };
}

export async function loadFile(privyUserId: string, fileId: string) {
  const { data, error } = await rpc('get_file', { p_privy: privyUserId, p_file: fileId });
  if (error || !data) return { error: error?.message || 'File not found.' };
  return { file: data as FileRow & { content: string | null } };
}

/** Upload one file. Extraction is a separate call — see extractFile. */
export async function uploadFile(
  file: File, privyUserId: string, workspaceId?: string | null,
  linkedObject?: string | null, linkedId?: string | null,
): Promise<{ id?: string; error?: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('privyUserId', privyUserId);
  if (workspaceId) form.append('workspaceId', workspaceId);
  if (linkedObject) form.append('linkedObject', linkedObject);
  if (linkedId) form.append('linkedId', linkedId);

  try {
    const res = await fetch('/api/files/upload', { method: 'POST', headers: await authHeaders(), body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body?.error || `Upload failed (HTTP ${res.status}).` };
    return { id: body.id };
  } catch (e: any) {
    return { error: e?.message || 'Upload failed.' };
  }
}

/** Extract (or re-extract) text. Safe to retry — it only rewrites content and status. */
export async function extractFile(
  fileId: string, privyUserId: string,
): Promise<{ status?: ExtractStatus; chars?: number; note?: string | null; error?: string }> {
  try {
    const res = await fetch('/api/files/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ fileId, privyUserId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body?.error || `Extraction failed (HTTP ${res.status}).` };
    return body;
  } catch (e: any) {
    return { error: e?.message || 'Extraction failed.' };
  }
}

/** Mint a short-lived signed URL. Not a permanent link — fetch it when clicked. */
export async function fileUrl(fileId: string, privyUserId: string): Promise<{ url?: string; error?: string }> {
  try {
    const res = await fetch(`/api/files/${fileId}?privyUserId=${encodeURIComponent(privyUserId)}`, {
      headers: await authHeaders(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body?.error || `Could not open the file (HTTP ${res.status}).` };
    return { url: body.url };
  } catch (e: any) {
    return { error: e?.message || 'Could not open the file.' };
  }
}

export async function deleteFile(fileId: string, privyUserId: string): Promise<{ ok?: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/files/${fileId}?privyUserId=${encodeURIComponent(privyUserId)}`, {
      method: 'DELETE', headers: await authHeaders(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body?.error || `Delete failed (HTTP ${res.status}).` };
    return { ok: true };
  } catch (e: any) {
    return { error: e?.message || 'Delete failed.' };
  }
}

/**
 * Split a ts_headline snippet into plain and matched runs.
 *
 * ts_headline is asked for «» rather than <b> in the migration so that this can
 * be rendered as React nodes — interpolating its HTML would mean trusting
 * document text we did not write.
 */
export function splitSnippet(snippet: string): { text: string; match: boolean }[] {
  const out: { text: string; match: boolean }[] = [];
  const re = /«([^»]*)»/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(snippet))) {
    if (m.index > last) out.push({ text: snippet.slice(last, m.index), match: false });
    out.push({ text: m[1], match: true });
    last = m.index + m[0].length;
  }
  if (last < snippet.length) out.push({ text: snippet.slice(last), match: false });
  return out;
}

export function formatBytes(n: number | null): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** How each extract_status reads in the UI, and whether it is worth retrying. */
export const STATUS_LABEL: Record<ExtractStatus, string> = {
  pending: 'Not indexed',
  text_layer: 'Searchable',
  ocr: 'Searchable (OCR)',
  vision: 'Searchable (AI)',
  failed: 'Failed',
  skipped: 'No text',
};
