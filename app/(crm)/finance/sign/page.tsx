'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { PenLine, Loader2, Plus, X, Trash2, Download, FileCheck2, Clock, Ban, UploadCloud } from 'lucide-react';
import { getWorkspace, type WorkspaceContext } from '@/lib/crm/data';
import { listSignDocuments, createSignRequest, voidSignDocument, downloadSignDocument, type SignDocument } from '@/lib/sign/client';
import { useDialog } from '@/components/ui/Dialog';
import AppLoading from '@/components/ui/AppLoading';

const STATUS_TONE: Record<string, string> = {
  sent: 'bg-warning/10 text-warning ring-warning/30',
  signed: 'bg-success/10 text-success ring-success/30',
  voided: 'bg-surface-hover text-tertiary ring-subtle',
  declined: 'bg-danger/10 text-danger ring-danger/30',
};

export default function SignPage() {
  const { confirm: confirmDialog, notify } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [rows, setRows] = useState<SignDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const canManage = ws?.role === 'owner' || ws?.role === 'admin' || ws?.role === 'member' || ws?.role === 'recruiter';

  const load = useCallback(async () => {
    if (!privy) { setLoading(false); return; }
    const w = await getWorkspace(privy);
    setWs(w);
    if (w) setRows(await listSignDocuments(privy, w.id));
    setLoading(false);
  }, [privy]);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  const voidDoc = async (d: SignDocument) => {
    if (!privy || !ws) return;
    if (!await confirmDialog({ title: `Void "${d.title}"?`, body: 'Pending signers can no longer sign it.', danger: true, confirmLabel: 'Void' })) return;
    const res = await voidSignDocument(privy, ws.id, d.id);
    if (res.error) { notify(res.error); return; }
    setRows(await listSignDocuments(privy, ws.id));
  };

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 px-5 lg:px-7">
        <h1 className="text-md font-medium text-primary">Signatures</h1>
        <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{rows.length}</span>
        {canManage && (
          <button onClick={() => setCreating(true)} className="ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm">
            <Plus className="w-3.5 h-3.5" /> Send for signing
          </button>
        )}
      </header>

      <div className="flex-1 overflow-auto p-6 2xl:p-8">
        <div className="max-w-5xl space-y-4">
          <p className="text-sm text-secondary -mt-1">Send a PDF for e-signature. Each signer gets a private link; once everyone signs, the completed PDF with a signature certificate lands in every inbox.</p>

          {loading ? (
            <AppLoading />
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-subtle p-12 text-center">
              <FileCheck2 className="w-8 h-8 text-tertiary mx-auto mb-3" />
              <h3 className="text-sm font-medium text-secondary">Nothing out for signature</h3>
              <p className="text-xs text-tertiary mt-1">Send a contract, offer or NDA and track it here.</p>
            </div>
          ) : (
            <div className="rounded-xl ring-1 ring-subtle bg-surface divide-y divide-subtle">
              {rows.map((d) => (
                <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-8 h-8 rounded-lg bg-surface-sunken text-tertiary flex items-center justify-center shrink-0">
                    {d.status === 'signed' ? <FileCheck2 className="w-4 h-4 text-success" /> : <Clock className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-primary truncate">{d.title}</div>
                    <div className="text-xs text-tertiary truncate">
                      {d.signed}/{d.total} signed · {d.recipients.map((r) => r.name).join(', ')}
                    </div>
                  </div>
                  <span className={`text-3xs font-medium uppercase tracking-wide px-2 py-0.5 rounded-md ring-1 shrink-0 ${STATUS_TONE[d.status] || STATUS_TONE.sent}`}>{d.status}</span>
                  {d.status === 'signed' && (
                    <button onClick={() => downloadSignDocument(d.id, 'signed')} title="Download signed PDF"
                      className="p-1.5 rounded-md text-tertiary hover:text-accent hover:bg-surface-hover"><Download className="w-4 h-4" /></button>
                  )}
                  {canManage && d.status === 'sent' && (
                    <button onClick={() => voidDoc(d)} title="Void" className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10"><Ban className="w-4 h-4" /></button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {creating && <CreateModal onClose={() => setCreating(false)} onDone={async () => { setCreating(false); if (privy && ws) setRows(await listSignDocuments(privy, ws.id)); }} notify={notify} />}
    </>
  );
}

function CreateModal({ onClose, onDone, notify }: { onClose: () => void; onDone: () => void; notify: (m: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [recipients, setRecipients] = useState<{ name: string; email: string }[]>([{ name: '', email: '' }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | null) => {
    if (f && f.type !== 'application/pdf') { setErr('Please choose a PDF.'); return; }
    setErr('');
    setFile(f);
    if (f && !title) setTitle(f.name.replace(/\.pdf$/i, ''));
  };

  const setRec = (i: number, patch: Partial<{ name: string; email: string }>) =>
    setRecipients((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    if (!file) { setErr('Attach a PDF.'); return; }
    const clean = recipients.filter((r) => /.+@.+\..+/.test(r.email));
    if (!clean.length) { setErr('Add at least one recipient email.'); return; }
    setBusy(true); setErr('');
    const res = await createSignRequest(file, title || file.name, clean);
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    notify(res.emailed ? `Sent — ${res.emailed} signing link${res.emailed === 1 ? '' : 's'} emailed.` : 'Signing request created.');
    onDone();
  };

  const input = 'w-full h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[88vh] flex flex-col bg-surface rounded-xl ring-1 ring-subtle shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-subtle">
          <h3 className="text-base font-medium text-primary">Send a document for signing</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-auto p-4 2xl:p-6 space-y-4">
          {err && <div className="rounded-lg bg-danger/10 ring-1 ring-danger/30 px-3 py-2 text-xs text-danger">{err}</div>}

          <div>
            <span className="block text-xs font-semibold text-secondary mb-1">PDF</span>
            <button onClick={() => inputRef.current?.click()} className="w-full rounded-lg border border-dashed border-subtle bg-surface-sunken hover:border-strong px-3 py-6 flex flex-col items-center gap-1.5 text-center">
              <UploadCloud className="w-5 h-5 text-tertiary" />
              <span className="text-sm text-primary">{file ? file.name : 'Choose a PDF'}</span>
              <span className="text-2xs text-tertiary">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : 'Up to 15 MB'}</span>
            </button>
            <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0] || null)} />
          </div>

          <label className="block">
            <span className="block text-xs font-semibold text-secondary mb-1">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mutual NDA" className={input} />
          </label>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-secondary">Signers</span>
              <button onClick={() => setRecipients((rs) => [...rs, { name: '', email: '' }])} className="text-xs font-semibold text-accent hover:underline">+ Add signer</button>
            </div>
            <div className="space-y-2">
              {recipients.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={r.name} onChange={(e) => setRec(i, { name: e.target.value })} placeholder="Name" className={input + ' flex-1'} />
                  <input value={r.email} onChange={(e) => setRec(i, { email: e.target.value })} placeholder="email@company.com" type="email" className={input + ' flex-[1.4]'} />
                  {recipients.length > 1 && (
                    <button onClick={() => setRecipients((rs) => rs.filter((_, idx) => idx !== i))} className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-2 text-2xs text-tertiary">Everyone signs independently. The document completes once all have signed.</p>
          </div>
        </div>

        <div className="h-14 shrink-0 flex items-center justify-end gap-2 px-4 border-t border-subtle">
          <button onClick={onClose} className="h-8 px-3 rounded-md text-sm font-medium text-secondary hover:bg-surface-hover">Cancel</button>
          <button onClick={submit} disabled={busy || !file} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />} Send for signing
          </button>
        </div>
      </div>
    </div>
  );
}
