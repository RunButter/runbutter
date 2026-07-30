// Storage details shared by the file routes. Server-side only.

/**
 * PRIVATE bucket. Deliberately not the public 'branding' bucket: these are
 * contracts, invoices and payroll, and a public URL to any of them is a leak
 * that no amount of RPC checking would undo. Reads are signed, short-lived and
 * re-authorised per request.
 */
export const BUCKET = 'files';

/** Created on demand, like the branding bucket, so a fresh database just works. */
export async function ensureFilesBucket(admin: any) {
  const { data } = await admin.storage.getBucket(BUCKET);
  if (data) return;
  // Idempotent — a parallel request may win the race, which is fine.
  await admin.storage.createBucket(BUCKET, { public: false });
}

/**
 * Workspace-prefixed, timestamped object key.
 *
 * The original filename is kept (it's what people recognise) but sanitised: a
 * name with a slash in it would silently create a nested path, and a name with
 * '..' is worse. The database row keeps the untouched display name regardless.
 */
export function storagePath(workspaceId: string, name: string): string {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  const ext = (dot > 0 ? name.slice(dot + 1) : '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  return `${workspaceId}/${Date.now()}-${base}${ext ? `.${ext}` : ''}`;
}
