'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { FileText, Plus, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { loadDocs, saveDoc, deleteDoc, type DocMeta } from '@/lib/crm/docs';

const fmt = (s: string) => new Date(s).toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' });

export default function DocsPage() {
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
    if (!privy || !confirm(`Delete "${d.title}"?`)) return;
    await deleteDoc(privy, d.id); reload();
  };

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200/70">
        <h1 className="text-sm font-bold text-slate-800 flex items-center gap-2"><FileText className="w-4 h-4 text-slate-400" /> Docs</h1>
        <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 rounded-md px-1.5 py-0.5 tabular-nums">{rows.length}</span>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{live ? 'Live' : 'Sample'}</span>
        <button onClick={create} disabled={!canEdit || creating} className="ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 shadow-sm disabled:opacity-40" title={!canEdit ? 'Sign in to add' : ''}>{creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} New doc</button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <p className="text-[13px] text-slate-500 mb-4 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-primary-500" /> Write documents with AI — using your own provider key (Settings → AI keys).</p>
          {loading ? (
            <div className="h-32 flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl ring-1 ring-slate-200/60 bg-white px-6 py-12 text-center">
              <FileText className="w-9 h-9 text-slate-300 mx-auto mb-3" />
              <p className="text-[13px] text-slate-500 mb-3">No documents yet.</p>
              <button onClick={create} disabled={!canEdit} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-40">Create your first</button>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {rows.map((d) => (
                <div key={d.id} onClick={() => router.push(`/docs/${d.id}`)} className="group cursor-pointer rounded-xl bg-white ring-1 ring-slate-200/60 p-4 hover:ring-slate-300 hover:shadow-sm transition-all">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[14px] font-bold text-slate-800 truncate">{d.title || 'Untitled'}</div>
                    <button onClick={(e) => remove(e, d)} disabled={!canEdit} className="p-1 rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-opacity disabled:hidden"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  <p className="text-[12px] text-slate-500 mt-1 line-clamp-2 whitespace-pre-wrap">{d.snippet || 'Empty document'}</p>
                  <div className="text-[11px] text-slate-400 mt-2">Updated {fmt(d.updated_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
