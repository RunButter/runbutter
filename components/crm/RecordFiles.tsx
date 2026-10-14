'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Paperclip } from 'lucide-react';
import { fileUrl, loadFiles, type FileRow } from '@/lib/files/client';

/**
 * Files attached to one record — a receipt on an expense (0137), a contract on
 * a company. Draws nothing when there are none, so a record without
 * attachments looks exactly as it did. Opening one mints a two-minute signed
 * URL after a membership check (/api/files/[id]); no link is stored anywhere.
 */
export default function RecordFiles({ privy, workspaceId, object, recordId }: {
  privy: string | null; workspaceId: string | null; object: string; recordId: string;
}) {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!privy || !workspaceId || !recordId) return;
    let live = true;
    loadFiles(privy, workspaceId, object, recordId).then((r) => { if (live) setFiles(r.files); });
    return () => { live = false; };
  }, [privy, workspaceId, object, recordId]);
  if (!files.length) return null;
  const open = async (id: string) => {
    if (!privy) return;
    const r = await fileUrl(id, privy);
    if (r.url) window.open(r.url, '_blank', 'noopener,noreferrer'); else setError(r.error || 'Could not open the file.');
  };
  return (
    <div className="mt-5 rounded-xl ring-1 ring-subtle bg-surface overflow-hidden">
      <p className="h-10 px-4 flex items-center gap-2 text-sm text-primary border-b border-subtle"><Paperclip className="w-4 h-4 text-tertiary" />
        {object === 'expenses' ? (files.length === 1 ? 'Receipt' : 'Receipts') : 'Files'}</p>
      <ul className="divide-y divide-subtle">
        {files.map((f) => (
          <li key={f.id}>
            <button onClick={() => open(f.id)} className="w-full px-4 py-2.5 flex items-center gap-2 text-left text-sm text-secondary hover:bg-surface-hover">
              <span className="min-w-0 flex-1 truncate">{f.name}</span><ExternalLink className="w-3.5 h-3.5 shrink-0" />
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="px-4 py-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
