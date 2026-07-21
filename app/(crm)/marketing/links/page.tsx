'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Link2, Loader2, Plus, X, Trash2, Copy, Check, ExternalLink } from 'lucide-react';
import { getWorkspace, type WorkspaceContext } from '@/lib/crm/data';
import { rpc } from '@/lib/rpc';
import { useDialog } from '@/components/ui/Dialog';

interface ShortLink { id: string; code: string; target_url: string; title: string | null; clicks: number; created_at: string }

export default function LinksPage() {
  const { confirm: confirmDialog, notify } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [rows, setRows] = useState<ShortLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState('');
  const [origin, setOrigin] = useState('https://runbutter.app');
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const load = useCallback(async () => {
    if (!privy) { setLoading(false); return; }
    const w = await getWorkspace(privy);
    setWs(w);
    if (w) { const { data } = await rpc('get_short_links', { p_privy: privy, p_workspace: w.id }); setRows(Array.isArray(data) ? data : []); }
    setLoading(false);
  }, [privy]);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  const remove = async (l: ShortLink) => {
    if (!privy || !ws) return;
    if (!await confirmDialog({ title: `Delete /l/${l.code}?`, body: 'The link stops working immediately.', danger: true, confirmLabel: 'Delete' })) return;
    await rpc('delete_short_link', { p_privy: privy, p_workspace: ws.id, p_id: l.id });
    load();
  };

  const copy = (code: string) => { navigator.clipboard?.writeText(`${origin}/l/${code}`); setCopied(code); setTimeout(() => setCopied(''), 1500); };

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-subtle">
        <h1 className="text-sm font-semibold text-primary flex items-center gap-2"><Link2 className="w-4 h-4 text-accent" /> Short links</h1>
        <span className="text-[11px] font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{rows.length}</span>
        {privy && ws && (
          <button onClick={() => setAdding(true)} className="ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-semibold text-white bg-accent hover:bg-accent/90 shadow-sm">
            <Plus className="w-3.5 h-3.5" /> New link
          </button>
        )}
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl space-y-4">
          <p className="text-[13px] text-secondary -mt-1">Branded short links with click tracking. Share <span className="font-mono">{origin.replace(/^https?:\/\//, '')}/l/…</span> anywhere.</p>

          {loading ? (
            <div className="h-32 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-subtle p-12 text-center">
              <Link2 className="w-8 h-8 text-tertiary mx-auto mb-3" />
              <h3 className="text-sm font-medium text-secondary">No short links yet</h3>
              <p className="text-[12px] text-tertiary mt-1">Shorten a URL and track how many people click it.</p>
            </div>
          ) : (
            <div className="rounded-xl ring-1 ring-subtle bg-surface divide-y divide-subtle">
              {rows.map((l) => (
                <div key={l.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-primary truncate">/l/{l.code}{l.title && <span className="text-tertiary font-normal"> · {l.title}</span>}</div>
                    <div className="text-[12px] text-tertiary truncate">{l.target_url}</div>
                  </div>
                  <span className="text-[12px] font-semibold text-secondary tabular-nums shrink-0">{l.clicks.toLocaleString()} <span className="text-tertiary font-normal">clicks</span></span>
                  <button onClick={() => copy(l.code)} title="Copy" className="p-1.5 rounded-md text-tertiary hover:text-accent hover:bg-surface-hover">{copied === l.code ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}</button>
                  <a href={`${origin}/l/${l.code}`} target="_blank" rel="noreferrer" title="Open" className="p-1.5 rounded-md text-tertiary hover:text-accent hover:bg-surface-hover"><ExternalLink className="w-4 h-4" /></a>
                  <button onClick={() => remove(l)} aria-label="Delete" className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {adding && ws && privy && <AddModal privy={privy} wsId={ws.id} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} notify={notify} />}
    </>
  );
}

function AddModal({ privy, wsId, onClose, onDone, notify }: { privy: string; wsId: string; onClose: () => void; onDone: () => void; notify: (m: string) => void }) {
  const [target, setTarget] = useState('');
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    let url = target.trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    if (!/^https?:\/\/.+\..+/.test(url)) { setErr('Enter a valid URL.'); return; }
    setBusy(true); setErr('');
    const { error } = await rpc('create_short_link', { p_privy: privy, p_workspace: wsId, p_target: url, p_title: title, p_code: code.trim() });
    setBusy(false);
    if (error) { setErr(error.message.replace(/_/g, ' ').toLowerCase()); return; }
    notify('Short link created.');
    onDone();
  };

  const input = 'w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-surface rounded-xl ring-1 ring-subtle shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 flex items-center justify-between px-4 border-b border-subtle">
          <h3 className="text-sm font-semibold text-primary">New short link</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          {err && <div className="rounded-lg bg-danger/10 ring-1 ring-danger/30 px-3 py-2 text-[12px] text-danger">{err}</div>}
          <label className="block"><span className="block text-[12px] font-semibold text-secondary mb-1">Destination URL *</span>
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="https://example.com/page" className={input + ' font-mono text-[12px]'} /></label>
          <label className="block"><span className="block text-[12px] font-semibold text-secondary mb-1">Label <span className="text-tertiary">(optional)</span></span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Launch tweet" className={input} /></label>
          <label className="block"><span className="block text-[12px] font-semibold text-secondary mb-1">Custom code <span className="text-tertiary">(optional)</span></span>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase())} placeholder="auto-generated if blank" className={input + ' font-mono text-[12px]'} /></label>
        </div>
        <div className="h-14 flex items-center justify-end gap-2 px-4 border-t border-subtle">
          <button onClick={onClose} className="h-8 px-3 rounded-md text-[13px] font-medium text-secondary hover:bg-surface-hover">Cancel</button>
          <button onClick={submit} disabled={busy || !target.trim()} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-[13px] font-semibold text-white bg-accent hover:bg-accent/90 disabled:opacity-50">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create
          </button>
        </div>
      </div>
    </div>
  );
}
