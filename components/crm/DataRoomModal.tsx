'use client';

import { useEffect, useState } from 'react';
import { Loader2, X, Copy, Check, Share2, Ban, Eye } from 'lucide-react';
import type { FileRow } from '@/lib/files/client';
import { createDataRoom, listDataRooms, revokeDataRoom, type DataRoom } from '@/lib/files/rooms';
import { useDialog } from '@/components/ui/Dialog';

/**
 * Pick some files, get one link.
 *
 * The set is FROZEN when the room is made, which is the whole difference from
 * sharing a folder: a folder keeps sharing whatever lands in it next month, and
 * nobody is thinking about a link they sent in March when they upload payroll
 * in April.
 *
 * Existing rooms are listed with their open count, because "did they read it"
 * is the question that made anybody want this, and with Revoke next to it,
 * because the second question is "can I take it back".
 */
export default function DataRoomModal({ files, privy, workspaceId, onClose }: {
  files: FileRow[]; privy: string | null; workspaceId: string | null; onClose: () => void;
}) {
  const { confirm } = useDialog();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('Data room');
  const [note, setNote] = useState('');
  const [days, setDays] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [rooms, setRooms] = useState<DataRoom[]>([]);

  const reload = () => {
    if (privy && workspaceId) listDataRooms(privy, workspaceId).then(setRooms);
  };
  useEffect(reload, [privy, workspaceId]);

  const toggle = (id: string) =>
    setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function create() {
    if (!privy || !workspaceId || picked.size === 0) return;
    setBusy(true); setError('');
    const res = await createDataRoom(privy, workspaceId, {
      title, note, fileIds: [...picked], days: days ? Number(days) : null,
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setLink(`${window.location.origin}/r/${res.token}`);
    setPicked(new Set());
    reload();
  }

  async function revoke(r: DataRoom) {
    const ok = await confirm({
      title: `Revoke “${r.title}”?`,
      body: 'The link stops working immediately for everyone who has it. This cannot be undone.',
    });
    if (!ok || !privy || !workspaceId) return;
    await revokeDataRoom(privy, workspaceId, r.id);
    reload();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-full flex flex-col bg-surface rounded-2xl ring-1 ring-subtle shadow-lg"
        onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 px-4 flex items-center gap-2 border-b border-subtle">
          <Share2 className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-medium text-primary">Share documents</h2>
          <button onClick={onClose} aria-label="Close"
            className="ml-auto h-7 w-7 inline-flex items-center justify-center rounded-md text-tertiary hover:text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          <div>
            <p className="text-2xs text-tertiary">
              One link to exactly these files. What you pick now is what it shows — uploading more later
              does not add them.
            </p>
            <div className="mt-2 max-h-52 overflow-y-auto rounded-lg ring-1 ring-subtle divide-y divide-subtle">
              {files.map((f) => (
                <label key={f.id} className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-surface-sunken/60">
                  <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} className="accent-current" />
                  <span className="text-xs text-primary truncate">{f.name}</span>
                </label>
              ))}
              {files.length === 0 && <p className="px-2.5 py-4 text-2xs text-tertiary">Upload a file first.</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title"
              className="h-8 px-2 text-xs rounded-lg bg-surface-sunken ring-1 ring-subtle text-primary outline-none focus:ring-2 focus:ring-accent/30" />
            <select value={days} onChange={(e) => setDays(e.target.value)}
              className="h-8 px-2 text-xs rounded-lg bg-surface-sunken ring-1 ring-subtle text-secondary outline-none focus:ring-2 focus:ring-accent/30">
              <option value="">No expiry</option>
              <option value="7">Expires in 7 days</option>
              <option value="30">Expires in 30 days</option>
              <option value="90">Expires in 90 days</option>
            </select>
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="A note for whoever opens it (optional)"
            className="w-full p-2 text-xs rounded-lg bg-surface-sunken ring-1 ring-subtle text-primary placeholder:text-tertiary outline-none focus:ring-2 focus:ring-accent/30 resize-none" />

          <div className="flex items-center gap-2">
            <button onClick={create} disabled={busy || picked.size === 0 || !privy}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-inverse text-inverse-fg text-xs font-semibold disabled:opacity-40">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Create link{picked.size > 0 ? ` (${picked.size})` : ''}
            </button>
            {error && <span className="text-2xs text-danger">{error}</span>}
          </div>

          {link && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-surface-sunken">
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 bg-transparent text-2xs text-secondary outline-none" />
              <button onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                className="h-6 px-2 inline-flex items-center gap-1 rounded text-2xs font-semibold text-accent hover:bg-accent/10">
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}

          {rooms.length > 0 && (
            <div>
              <p className="text-2xs font-semibold text-secondary mb-1">Shared already</p>
              <div className="rounded-lg ring-1 ring-subtle divide-y divide-subtle">
                {rooms.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs truncate ${r.revoked_at ? 'text-tertiary line-through' : 'text-primary'}`}>{r.title}</p>
                      <p className="text-2xs text-tertiary tabular-nums">
                        {r.file_count} file{r.file_count === 1 ? '' : 's'}
                        {' · '}<Eye className="w-3 h-3 inline -mt-0.5" /> {r.opens}
                        {r.last_open ? ` · last ${new Date(r.last_open).toLocaleDateString('en-GB')}` : ' · not opened yet'}
                        {r.expires_at && !r.revoked_at ? ` · expires ${new Date(r.expires_at).toLocaleDateString('en-GB')}` : ''}
                      </p>
                    </div>
                    {!r.revoked_at && (
                      <button onClick={() => revoke(r)} title="Revoke" aria-label={`Revoke ${r.title}`}
                        className="h-6 w-6 inline-flex items-center justify-center rounded text-tertiary hover:text-danger hover:bg-danger/10 shrink-0">
                        <Ban className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
