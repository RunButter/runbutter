'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { FileText, Plus, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { loadDocs, saveDoc, deleteDoc, type DocMeta } from '@/lib/crm/docs';
import { useDialog } from '@/components/ui/Dialog';

const fmt = (s: string) => new Date(s).toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' });

export default function DocsPage() {
  const { confirm: confirmDialog } = useDialog();
  const router = useRouter();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const canEdit = !!privy;

  const [rows, setRows] = useState<DocMeta[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    loadDocs(privy).then((r) => { setRows(r.rows); setLive(r.live); setLoading(false); });
  }, [privy]);
  useEffect(() => { if (ready) reload(); }, [ready, reload]);

  const create = async () => {
    if (!privy) return;
    setCreating(true);
    const res = await saveDoc(privy, null, 'Untitled', '');
    setCreating(false);
    if (res.id) router.push(`/docs/${res.id}`);
  };
  const remove = async (e: React.MouseEvent, d: DocMeta) => {
    e.stopPropagation();
    if (!privy || !await confirmDialog(`Delete "${d.title}"?`)) return;
    await deleteDoc(privy, d.id); reload();
  };

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-subtle">
        <h1 className="text-sm font-semibold text-primary flex items-center gap-2"><FileText className="w-4 h-4 text-tertiary" /> Docs</h1>
        <span className="text-[11px] font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{rows.length}</span>
        <span className={`text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>{live ? 'Live' : 'Sample'}</span>
        <button onClick={create} disabled={!canEdit || creating} className="ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm disabled:opacity-40" title={!canEdit ? 'Sign in to add' : ''}>{creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} New doc</button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <p className="text-[13px] text-secondary mb-4 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-accent" /> Write documents with AI — using your own provider key (Settings → AI keys).</p>
          {loading ? (
            <div className="h-32 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl ring-1 ring-subtle bg-surface px-6 py-12 text-center">
              <FileText className="w-9 h-9 text-tertiary mx-auto mb-3" />
              <p className="text-[13px] text-secondary mb-3">No documents yet.</p>
              <button onClick={create} disabled={!canEdit} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">Create your first</button>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {rows.map((d) => (
                <div key={d.id} onClick={() => router.push(`/docs/${d.id}`)} className="group cursor-pointer rounded-xl bg-surface ring-1 ring-subtle shadow-card p-4 hover:ring-strong hover:shadow-elevated transition-all">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[14px] font-semibold text-primary truncate">{d.title || 'Untitled'}</div>
                    <button onClick={(e) => remove(e, d)} disabled={!canEdit} className="p-1 rounded-md text-tertiary hover:text-danger hover:bg-danger/10 opacity-0 group-hover:opacity-100 transition-opacity disabled:hidden"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  <p className="text-[12px] text-secondary mt-1 line-clamp-2 whitespace-pre-wrap">{d.snippet || 'Empty document'}</p>
                  <div className="text-[11px] text-tertiary mt-2">Updated {fmt(d.updated_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
