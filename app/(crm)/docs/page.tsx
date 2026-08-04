'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { FileText, Plus, Loader2, Sparkles, Trash2, StickyNote } from 'lucide-react';
import { loadDocs, saveDoc, deleteDoc, type DocMeta, type DocKind } from '@/lib/crm/docs';
import { useDialog } from '@/components/ui/Dialog';
import DataBadge from '@/components/ui/DataBadge';

const fmt = (s: string) => new Date(s).toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' });

// A note starts as a checklist because that is what people open one for. A doc
// starts empty because anything prefilled is something to delete first.
const SEED: Record<DocKind, { title: string; body: string }> = {
  doc:  { title: 'Untitled', body: '' },
  note: { title: 'Untitled note', body: '- [ ] ' },
};

export default function DocsPage() {
  const { confirm: confirmDialog } = useDialog();
  const router = useRouter();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const canEdit = !!privy;

  const [rows, setRows] = useState<DocMeta[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<DocKind | null>(null);
  const [filter, setFilter] = useState<'all' | DocKind>('all');

  const reload = useCallback(() => {
    setLoading(true);
    loadDocs(privy).then((r) => { setRows(r.rows); setLive(r.live); setLoading(false); });
  }, [privy]);
  useEffect(() => { if (ready) reload(); }, [ready, reload]);

  const create = async (kind: DocKind = 'doc') => {
    if (!privy) return;
    setCreating(kind);
    const seed = SEED[kind];
    const res = await saveDoc(privy, null, seed.title, seed.body, kind);
    setCreating(null);
    if (res.id) router.push(`/docs/${res.id}`);
  };
  const remove = async (e: React.MouseEvent, d: DocMeta) => {
    e.stopPropagation();
    if (!privy || !await confirmDialog(`Delete "${d.title}"?`)) return;
    await deleteDoc(privy, d.id); reload();
  };

  // Kind is absent until 0081 runs, so an unlabelled row is a doc rather than
  // vanishing from both filters.
  const kindOf = (d: DocMeta): DocKind => (d.kind === 'note' ? 'note' : 'doc');
  const shown = filter === 'all' ? rows : rows.filter((d) => kindOf(d) === filter);

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 px-5 lg:px-7">
        <h1 className="text-md font-medium text-primary">Docs</h1>
        <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{shown.length}</span>
        <DataBadge live={live} />
        <div className="ml-auto flex items-center gap-2">
          {/* Compact inline control — flat by the elevation rule, unlike the
              raised buttons beside it. */}
          <div className="hidden sm:flex items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5">
            {(['all', 'doc', 'note'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`h-7 px-2.5 rounded-md text-xs font-semibold transition-colors ${filter === f ? 'bg-surface text-primary shadow-sm' : 'text-tertiary hover:text-secondary'}`}>
                {f === 'all' ? 'All' : f === 'doc' ? 'Docs' : 'Notes'}
              </button>
            ))}
          </div>
          <button onClick={() => create('note')} disabled={!canEdit || !!creating}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-secondary ring-1 ring-subtle bg-surface hover:bg-surface-sunken shadow-sm disabled:opacity-40"
            title={!canEdit ? 'Sign in to add' : 'A quick note with checkboxes'}>
            {creating === 'note' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <StickyNote className="w-3.5 h-3.5" />} <span className="hidden sm:inline">New note</span>
          </button>
          <button onClick={() => create('doc')} disabled={!canEdit || !!creating}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm disabled:opacity-40"
            title={!canEdit ? 'Sign in to add' : ''}>
            {creating === 'doc' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} New doc
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 2xl:p-8">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm text-secondary mb-4 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-accent" /> Write documents with AI — using your own provider key (Settings → AI keys).</p>
          {loading ? (
            <div className="h-32 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : shown.length === 0 ? (
            <div className="rounded-xl ring-1 ring-subtle bg-surface px-6 py-12 text-center">
              <FileText className="w-9 h-9 text-tertiary mx-auto mb-3" />
              <p className="text-sm text-secondary mb-3">
                {filter === 'note' ? 'No notes yet.' : filter === 'doc' ? 'No documents yet.' : 'Nothing here yet.'}
              </p>
              <button onClick={() => create(filter === 'note' ? 'note' : 'doc')} disabled={!canEdit} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">Create your first</button>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {shown.map((d) => {
                const note = kindOf(d) === 'note';
                const Icon = note ? StickyNote : FileText;
                return (
                  <div key={d.id} onClick={() => router.push(`/docs/${d.id}`)} className="group cursor-pointer card-surface p-4 hover:ring-strong hover:shadow-elevated transition-all">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className="w-4 h-4 text-tertiary shrink-0" />
                        <div className="text-base font-medium text-primary truncate">{d.title || 'Untitled'}</div>
                      </div>
                      <button onClick={(e) => remove(e, d)} disabled={!canEdit} className="p-1 rounded-md text-tertiary hover:text-danger hover:bg-danger/10 opacity-0 group-hover:opacity-100 transition-opacity disabled:hidden"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                    <p className="text-xs text-secondary mt-1 line-clamp-2 whitespace-pre-wrap">{d.snippet || (note ? 'Empty note' : 'Empty document')}</p>
                    <div className="text-2xs text-tertiary mt-2">Updated {fmt(d.updated_at)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
