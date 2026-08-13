'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLiveRefresh } from '@/lib/crm/live';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { FileText, Plus, Loader2, Sparkles, StickyNote, ListChecks, Table2, FileStack } from 'lucide-react';
import {
  loadDocs, saveDoc, deleteDoc, kindOf, tagDot, DOC_KINDS, KIND_META,
  type DocMeta, type DocKind,
} from '@/lib/crm/docs';
import DocCard from '@/components/crm/DocCard';
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
  const [tag, setTag] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    loadDocs(privy).then((r) => { setRows(r.rows); setLive(r.live); setLoading(false); });
  }, [privy]);

  // A to-do list the copilot just wrote belongs on this screen immediately —
  // not seeing it is the exact complaint that started all of this.
  useLiveRefresh(['docs'], reload);
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

  const byKind = filter === 'all' ? rows : rows.filter((d) => kindOf(d.kind) === filter);
  const shown = tag ? byKind.filter((d) => d.tags?.includes(tag)) : byKind;
  const count = (k: DocKind) => rows.filter((d) => kindOf(d.kind) === k).length;
  // Every tag in use, most-used first — a tag list nobody administers, so the
  // only sensible order is how much it is actually used.
  const allTags = Object.entries(
    rows.flatMap((d) => d.tags ?? []).reduce<Record<string, number>>((m, t) => ({ ...m, [t]: (m[t] ?? 0) + 1 }), {}),
  ).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);

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
            <p className="hidden lg:flex text-xs text-secondary items-center gap-1.5 ml-auto">
              <Sparkles className="w-3.5 h-3.5 text-accent" /> AI writing uses your own key (Settings → AI keys).
            </p>
          </div>

          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-4">
              {allTags.map((t) => (
                <button key={t} onClick={() => setTag((cur) => (cur === t ? null : t))}
                  aria-pressed={tag === t}
                  className={`inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-full text-2xs transition-colors ${
                    tag === t ? 'bg-inverse text-inverse-fg' : 'ring-1 ring-subtle text-secondary hover:bg-surface-hover'}`}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tagDot(t) }} />
                  {t}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <AppLoading label="Loading your documents" />
          ) : shown.length === 0 ? (
            <div className="rounded-xl ring-1 ring-subtle bg-surface px-6 py-12 text-center">
              <FileText className="w-9 h-9 text-tertiary mx-auto mb-3" />
              <p className="text-sm text-secondary">
                {tag ? `Nothing tagged "${tag}".`
                     : filter === 'all' ? 'Nothing here yet — pick one above to start.'
                     : `No ${KIND_META[filter].plural.toLowerCase()} yet.`}
              </p>
            </div>
          ) : (
            /* CSS columns, not a grid: cards are different heights because they
               render their own content, and a grid row would stretch every card
               in it to match the tallest. Masonry packs them instead. */
            <div className="columns-1 sm:columns-2 xl:columns-3 gap-4">
              {shown.map((d) => (
                <DocCard key={d.id} doc={d} privy={privy} canEdit={canEdit}
                  onOpen={() => router.push(`/docs/${d.id}`)}
                  onDelete={(e) => remove(e, d)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
