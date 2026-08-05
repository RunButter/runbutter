'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowLeft, Loader2, Save, Sparkles, Wand2, ListTree, CornerDownRight, SpellCheck, Code2, Pencil, Check, Download, ChevronDown, FileText, StickyNote, ListChecks, Table2, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { loadDoc, saveDoc, runAI, kindOf, tagDot, DOC_KINDS, KIND_META, type Doc, type DocKind } from '@/lib/crm/docs';
import { downloadPdf, downloadWord, downloadMarkdown, downloadCsv } from '@/lib/crm/doc-export';
import { getWorkspace } from '@/lib/crm/data';
import { EmbedResolver, uploadEmbed, MAX_EMBED_BYTES } from '@/lib/files/embeds';
import AppLoading from '@/components/ui/AppLoading';

// Tiptap/ProseMirror is by far the heaviest thing we ship (~180 kB on this
// route alone). Load it on demand so the doc shell paints immediately instead
// of waiting on the whole editor; it's browser-only anyway.
const RichEditor = dynamic(() => import('@/components/crm/RichEditor'), {
  ssr: false,
  loading: () => (
    <AppLoading />
  ),
});

// Same reasoning as RichEditor: browser-only, and only one of them mounts per
// document, so loading all three up front is waste on every route.
const TodoEditor = dynamic(() => import('@/components/crm/TodoEditor'), { ssr: false, loading: () => <AppLoading label="Opening the list" /> });
const SheetEditor = dynamic(() => import('@/components/crm/SheetEditor'), { ssr: false, loading: () => <AppLoading label="Opening the table" /> });

const KIND_ICON: Record<DocKind, typeof FileText> = {
  doc: FileText, note: StickyNote, todo: ListChecks, sheet: Table2,
};

const EXPORTS: { label: string; hint: string; only?: DocKind; run: (t: string, b: string) => void }[] = [
  { label: 'PDF', hint: 'Print-ready', run: (t, b) => { void downloadPdf(t, b); } },
  { label: 'Word (.doc)', hint: 'Opens in Word, Pages or Docs', run: downloadWord },
  { label: 'Markdown', hint: 'The raw source', run: downloadMarkdown },
  { label: 'CSV', hint: 'For Excel or Sheets', only: 'sheet', run: downloadCsv },
];

const AI_ACTIONS = [
  { mode: 'improve', label: 'Improve', icon: Wand2 },
  { mode: 'summarize', label: 'Summarize', icon: ListTree },
  { mode: 'continue', label: 'Continue', icon: CornerDownRight },
  { mode: 'fix', label: 'Fix grammar', icon: SpellCheck },
];

export default function DocEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const canEdit = !!privy;

  const [doc, setDoc] = useState<Doc | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [preview, setPreview] = useState(false);
  const [aiBusy, setAiBusy] = useState('');
  const [aiError, setAiError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [wsId, setWsId] = useState<string | null>(null);
  const [imgError, setImgError] = useState('');
  // Held apart from `doc` so switching kind re-renders at once rather than
  // waiting on a save round trip.
  const [kind, setKind] = useState<DocKind>('doc');
  const [exportOpen, setExportOpen] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');

  // Turns the `rb-file:<uuid>` references stored in the body into signed URLs
  // for the editor, and back again on save. Per-document, and it must outlive
  // re-renders — it is the only record of which URL was which file.
  const embeds = useMemo(() => new EmbedResolver(privy), [privy]);
  // `body` is captured by the save handler, so the resolver needs the current
  // one without making save depend on every keystroke.
  const bodyRef = useRef(body);
  useEffect(() => { bodyRef.current = body; }, [body]);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    loadDoc(privy, id).then(async (d) => {
      setDoc(d);
      setTitle(d?.title || '');
      setKind(kindOf(d?.kind));
      setTags(d?.tags ?? []);
      // Resolve embedded files BEFORE the editor sees the body, or it mounts
      // with `rb-file:` in every src and paints a row of broken images first.
      const raw = d?.body || '';
      await embeds.prime(raw);
      setBody(embeds.expand(raw));
      setLoading(false);
    });
  }, [ready, privy, id, embeds]);

  // Needed to file an uploaded image under the right workspace.
  useEffect(() => { if (privy) getWorkspace(privy).then((w) => setWsId(w?.id ?? null)); }, [privy]);

  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    setImgError('');
    if (!privy) { setImgError('Sign in to add images.'); return null; }
    if (file.size > MAX_EMBED_BYTES) { setImgError(`${file.name} is larger than 10 MB.`); return null; }
    // Linked to this doc, so it shows up on the Files screen attached to the
    // document it lives in rather than loose in the workspace.
    const res = await uploadEmbed(file, privy, wsId, 'doc', id);
    if ('error' in res) { setImgError(res.error); return null; }
    // Register the pair immediately. Without this the resolver has never seen
    // this URL, `collapse` cannot map it back on save, and the signed URL —
    // which expires — gets written into the document body.
    embeds.remember(res.id, res.url);
    return res.url;
  }, [privy, wsId, id, embeds]);

  const save = async () => {
    if (!privy) return;
    setSaving(true);
    // Store ids, never signed URLs — see lib/files/embeds.ts.
    const res = await saveDoc(privy, id, title, embeds.collapse(bodyRef.current), kind, tags);
    setSaving(false);
    if (!res.error) { setSavedAt(true); setTimeout(() => setSavedAt(false), 1500); }
  };

  const ai = async (mode: string, instruction?: string) => {
    if (!privy) { setAiError('Sign in to use AI.'); return; }
    setAiBusy(mode); setAiError('');
    const res = await runAI(privy, mode, body, instruction);
    setAiBusy('');
    if (res.error) { setAiError(res.error); return; }
    const out = res.text || '';
    if (mode === 'improve' || mode === 'fix') setBody(out);
    else if (mode === 'summarize') setBody(body + '\n\n## Summary\n' + out);
    else if (mode === 'write') setBody(body ? body + '\n\n' + out : out);
    else setBody(body + '\n' + out); // continue
    setPrompt('');
  };

  if (loading) return <AppLoading />;
  if (!doc) return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
      <p className="text-base font-semibold text-secondary">This document couldn’t be loaded.</p>
      <Link href="/docs" className="text-sm font-medium text-secondary hover:text-primary transition-colors">← Back to Docs</Link>
    </div>
  );

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-2 px-6 border-b border-subtle">
        <button onClick={() => router.push('/docs')} className="p-1.5 -ml-1 rounded-md text-tertiary hover:bg-surface-hover"><ArrowLeft className="w-4 h-4" /></button>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled" disabled={!canEdit} className="flex-1 text-sm font-semibold text-primary outline-none placeholder:text-tertiary bg-transparent" />
        {/* Switching kind is a VIEW change, not a conversion: every kind is
            markdown in the same column, so a checklist opened as a document is
            the same text with a different editor over it. That is why this is a
            row of icons and not a destructive "convert" action. */}
        <div className="hidden sm:flex items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5 mr-1">
          {DOC_KINDS.map((k) => {
            const Icon = KIND_ICON[k];
            return (
              <button key={k} onClick={() => { setKind(k); setPreview(false); }} disabled={!canEdit}
                title={`${KIND_META[k].label} — ${KIND_META[k].blurb}`} aria-label={KIND_META[k].label}
                aria-pressed={kind === k}
                className={`h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors ${kind === k ? 'bg-surface text-primary shadow-sm' : 'text-tertiary hover:text-secondary'}`}>
                <Icon className="w-3.5 h-3.5" />
              </button>
            );
          })}
        </div>

        <button onClick={() => setPreview((p) => !p)} title={preview ? 'Back to the editor' : 'Edit markdown source'}
          className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
          {preview ? <Pencil className="w-3.5 h-3.5" /> : <Code2 className="w-3.5 h-3.5" />}
          <span className="hidden md:inline">{preview ? 'Editor' : 'Markdown'}</span>
        </button>

        {/* Export. Every format is produced in the browser — see
            lib/crm/doc-export.ts for why a document never goes to a converter. */}
        <div className="relative">
          <button onClick={() => setExportOpen((o) => !o)} aria-expanded={exportOpen}
            className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
            <Download className="w-3.5 h-3.5" /><span className="hidden md:inline">Export</span>
            <ChevronDown className="w-3 h-3" />
          </button>
          {exportOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
              <div className="absolute right-0 top-9 z-20 w-56 rounded-lg bg-surface ring-1 ring-subtle shadow-popover p-1">
                {EXPORTS.filter((x) => !x.only || x.only === kind).map((x) => (
                  <button key={x.label} onClick={() => { x.run(title || 'Untitled', body); setExportOpen(false); }}
                    className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-surface-hover">
                    <span className="block text-xs font-medium text-primary">{x.label}</span>
                    <span className="block text-3xs text-tertiary">{x.hint}</span>
                  </button>
                ))}
                <Link href="/pdf" className="block px-2.5 py-1.5 mt-0.5 rounded-md hover:bg-surface-hover border-t border-subtle">
                  <span className="block text-xs font-medium text-primary">PDF tools →</span>
                  <span className="block text-3xs text-tertiary">Merge, split, watermark — in your browser</span>
                </Link>
              </div>
            </>
          )}
        </div>
        <button onClick={save} disabled={!canEdit || saving} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm disabled:opacity-40">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : savedAt ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />} {savedAt ? 'Saved' : 'Save'}</button>
      </header>

      {/* AI toolbar. Hidden over a table: "improve this" and "continue" are
          prose operations, and offering them on a grid of cells is a button
          that cannot do anything sensible. */}
      <div className={`shrink-0 flex-wrap items-center gap-1.5 px-4 py-2 border-b border-subtle bg-surface-sunken/50 ${kind === 'sheet' ? 'hidden' : 'flex'}`}>
        <span className="text-2xs font-medium uppercase tracking-wider text-accent inline-flex items-center gap-1 mr-1"><Sparkles className="w-3.5 h-3.5" /> AI</span>
        {AI_ACTIONS.map((a) => (
          <button key={a.mode} onClick={() => ai(a.mode)} disabled={!canEdit || !!aiBusy}
            className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-secondary ring-1 ring-subtle bg-surface hover:bg-surface-sunken disabled:opacity-40">
            {aiBusy === a.mode ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <a.icon className="w-3.5 h-3.5 text-accent" />} {a.label}
          </button>
        ))}
        <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
          <input value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && prompt.trim()) ai('write', prompt.trim()); }}
            placeholder="Write with AI — e.g. “draft an offer letter for a Senior Engineer”" disabled={!canEdit || !!aiBusy}
            className="flex-1 h-7 px-2.5 text-xs rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none disabled:opacity-50" />
          <button onClick={() => prompt.trim() && ai('write', prompt.trim())} disabled={!canEdit || !!aiBusy || !prompt.trim()} className="h-7 px-2.5 rounded-md text-xs font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 inline-flex items-center gap-1.5 disabled:opacity-40">{aiBusy === 'write' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Write</button>
        </div>
      </div>
      {imgError && (
        <div className="shrink-0 px-4 py-1.5 text-xs text-danger bg-danger/10 border-b border-danger/30">{imgError}</div>
      )}
      {aiError && (
        <div className="shrink-0 px-4 py-1.5 text-xs text-danger bg-danger/10 border-b border-danger/30">
          {aiError} {/no ai provider|settings/i.test(aiError) && <Link href="/settings/ai" className="font-semibold underline">Add a key →</Link>}
        </div>
      )}

      {/* Tags. Free text with no picker and no tag table — the colour comes
          from the name, so "Personal" is the same green everywhere and there is
          nothing to administer. Saved with the document, not on their own:
          a tag is part of the edit, not a separate commit. */}
      <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-subtle">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 h-6 pl-1.5 pr-1 rounded-full ring-1 ring-subtle text-2xs text-secondary">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tagDot(t) }} />
            {t}
            <button onClick={() => setTags((v) => v.filter((x) => x !== t))} disabled={!canEdit}
              aria-label={`Remove tag ${t}`}
              className="p-0.5 rounded-full text-tertiary hover:text-primary hover:bg-surface-hover disabled:hidden">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {tags.length < 8 && (
          <input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} disabled={!canEdit}
            onKeyDown={(e) => {
              // Comma as well as Enter: people type tags in a list.
              if (e.key !== 'Enter' && e.key !== ',') return;
              e.preventDefault();
              const v = tagDraft.trim().slice(0, 24);
              // Deduped case-insensitively here as well as in SQL, so the pill
              // does not appear twice for a second before the save normalises.
              if (v && !tags.some((x) => x.toLowerCase() === v.toLowerCase())) setTags((cur) => [...cur, v]);
              setTagDraft('');
            }}
            placeholder={tags.length ? 'Add tag' : 'Add a tag…'}
            className="h-6 px-1.5 text-2xs bg-transparent outline-none text-primary placeholder:text-tertiary w-24" />
        )}
        <span className="ml-auto text-3xs text-tertiary">Tags save with the document</span>
      </div>

      {/* Editor / raw-markdown view */}
      <div className="flex-1 overflow-hidden">
        {preview ? (
          <div className="h-full overflow-auto p-8">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={!canEdit}
              placeholder="# Markdown source…"
              className="w-full h-full resize-none text-sm leading-relaxed text-primary font-mono outline-none bg-transparent" />
          </div>
        ) : kind === 'todo' ? (
          <TodoEditor value={body} onChange={setBody} editable={canEdit} />
        ) : kind === 'sheet' ? (
          <SheetEditor value={body} onChange={setBody} editable={canEdit} />
        ) : (
          <RichEditor value={body} onChange={setBody} editable={canEdit}
            onImageUpload={canEdit ? uploadImage : undefined}
            placeholder={kind === 'note'
              ? 'Jot something down… type ‘[] ’ for a checkbox, or drop an image in.'
              : 'Start writing… type ‘# ’ for a heading, ‘- ’ for a list, or use the AI toolbar above.'} />
        )}
      </div>
    </>
  );
}
