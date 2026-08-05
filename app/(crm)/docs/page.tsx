'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { FileText, Plus, Loader2, Sparkles, Trash2, StickyNote, ListChecks, Table2, FileStack, CheckCheck } from 'lucide-react';
import {
  loadDocs, saveDoc, deleteDoc, kindOf, DOC_KINDS, KIND_META,
  type DocMeta, type DocKind,
} from '@/lib/crm/docs';
import { parseTodo } from '@/lib/crm/doc-formats';
import { useDialog } from '@/components/ui/Dialog';
import DataBadge from '@/components/ui/DataBadge';
import AppLoading from '@/components/ui/AppLoading';

const fmt = (s: string) => new Date(s).toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' });

const KIND_ICON: Record<DocKind, typeof FileText> = {
  doc: FileText, note: StickyNote, todo: ListChecks, sheet: Table2,
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

  const create = async (kind: DocKind) => {
    if (!privy) return;
    setCreating(kind);
    const meta = KIND_META[kind];
    const res = await saveDoc(privy, null, meta.title, meta.seed, kind);
    setCreating(null);
    if (res.id) router.push(`/docs/${res.id}`);
  };

  const remove = async (e: React.MouseEvent, d: DocMeta) => {
    e.stopPropagation();
    if (!privy || !await confirmDialog(`Delete "${d.title}"?`)) return;
    await deleteDoc(privy, d.id); reload();
  };

  const shown = filter === 'all' ? rows : rows.filter((d) => kindOf(d.kind) === filter);
  const count = (k: DocKind) => rows.filter((d) => kindOf(d.kind) === k).length;

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 px-5 lg:px-7">
        <h1 className="text-md font-medium text-primary">Docs</h1>
        <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{shown.length}</span>
        <DataBadge live={live} />
        {/* PDF tools are a sibling of Docs, not a setting — someone who just
            exported a document to PDF is one click from merging it into
            something else. */}
        <Link href="/pdf" className="ml-auto h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold text-secondary hover:bg-surface-hover">
          <FileStack className="w-3.5 h-3.5" /> <span className="hidden sm:inline">PDF tools</span>
        </Link>
      </header>

      <div className="flex-1 overflow-auto p-6 2xl:p-8">
        <div className="max-w-5xl mx-auto">
          {/* The picker. Four cards rather than a dropdown, because "what can I
              make here?" is the actual question on a Docs screen and a menu
              hides the answer behind a click. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-6">
            {DOC_KINDS.map((k) => {
              const Icon = KIND_ICON[k];
              const meta = KIND_META[k];
              return (
                <button key={k} onClick={() => create(k)} disabled={!canEdit || !!creating}
                  title={!canEdit ? 'Sign in to add' : `New ${meta.label.toLowerCase()}`}
                  className="group min-w-0 text-left card-surface p-3.5 hover:ring-strong hover:shadow-elevated transition-all disabled:opacity-40">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-surface-hover inline-flex items-center justify-center shrink-0">
                      {creating === k ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> : <Icon className="w-3.5 h-3.5 text-accent" />}
                    </span>
                    <span className="text-sm font-medium text-primary truncate">{meta.label}</span>
                    <Plus className="w-3.5 h-3.5 text-tertiary ml-auto opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </div>
                  <p className="text-2xs text-tertiary mt-1.5 leading-snug">{meta.blurb}</p>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {/* Compact inline control — flat by the elevation rule. */}
            <div className="flex items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5">
              {(['all', ...DOC_KINDS] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`h-7 px-2.5 rounded-md text-xs font-semibold transition-colors ${filter === f ? 'bg-surface text-primary shadow-sm' : 'text-tertiary hover:text-secondary'}`}>
                  {f === 'all' ? 'All' : KIND_META[f].plural}
                  {f !== 'all' && count(f) > 0 && <span className="ml-1 tabular-nums opacity-60">{count(f)}</span>}
                </button>
              ))}
            </div>
            <p className="hidden sm:flex text-xs text-secondary items-center gap-1.5 ml-auto">
              <Sparkles className="w-3.5 h-3.5 text-accent" /> AI writing uses your own key (Settings → AI keys).
            </p>
          </div>

          {loading ? (
            <AppLoading label="Loading your documents" />
          ) : shown.length === 0 ? (
            <div className="rounded-xl ring-1 ring-subtle bg-surface px-6 py-12 text-center">
              <FileText className="w-9 h-9 text-tertiary mx-auto mb-3" />
              <p className="text-sm text-secondary">
                {filter === 'all' ? 'Nothing here yet — pick one above to start.' : `No ${KIND_META[filter].plural.toLowerCase()} yet.`}
              </p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {shown.map((d) => {
                const k = kindOf(d.kind);
                const Icon = KIND_ICON[k];
                // A checklist's snippet is a wall of "- [ ]", so lists show
                // progress instead — the only thing worth knowing about one
                // without opening it.
                const todo = (k === 'todo' || k === 'note') ? parseTodo(d.snippet || '') : null;
                const real = todo?.items.filter((t) => t.text.trim()) ?? [];
                const done = real.filter((t) => t.done).length;
                return (
                  <div key={d.id} onClick={() => router.push(`/docs/${d.id}`)} className="group cursor-pointer card-surface p-4 hover:ring-strong hover:shadow-elevated transition-all">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className="w-4 h-4 text-tertiary shrink-0" />
                        <div className="text-base font-medium text-primary truncate">{d.title || 'Untitled'}</div>
                      </div>
                      <button onClick={(e) => remove(e, d)} disabled={!canEdit} aria-label={`Delete ${d.title}`}
                        className="p-1 rounded-md text-tertiary hover:text-danger hover:bg-danger/10 opacity-0 group-hover:opacity-100 transition-opacity disabled:hidden"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>

                    {real.length > 0 ? (
                      <div className="flex items-center gap-2 mt-2">
                        <span className="h-1 rounded-full bg-surface-hover flex-1 min-w-0 overflow-hidden">
                          <span className="block h-full rounded-full bg-accent" style={{ width: `${(done / real.length) * 100}%` }} />
                        </span>
                        <span className="text-2xs text-tertiary tabular-nums shrink-0">
                          {done === real.length
                            ? <span className="inline-flex items-center gap-1 text-success"><CheckCheck className="w-3 h-3" /> done</span>
                            : `${done}/${real.length}`}
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-secondary mt-1 line-clamp-2 whitespace-pre-wrap">
                        {d.snippet || `Empty ${KIND_META[k].label.toLowerCase()}`}
                      </p>
                    )}

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
