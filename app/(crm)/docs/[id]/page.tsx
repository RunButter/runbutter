'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowLeft, Loader2, Save, Sparkles, Wand2, ListTree, CornerDownRight, SpellCheck, Code2, Pencil, Check } from 'lucide-react';
import dynamic from 'next/dynamic';
import { loadDoc, saveDoc, runAI, type Doc } from '@/lib/crm/docs';

// Tiptap/ProseMirror is by far the heaviest thing we ship (~180 kB on this
// route alone). Load it on demand so the doc shell paints immediately instead
// of waiting on the whole editor; it's browser-only anyway.
const RichEditor = dynamic(() => import('@/components/crm/RichEditor'), {
  ssr: false,
  loading: () => (
    <div className="min-h-[60vh] flex items-center justify-center text-tertiary">
      <Loader2 className="w-5 h-5 animate-spin" />
    </div>
  ),
});

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

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    loadDoc(privy, id).then((d) => { setDoc(d); setTitle(d?.title || ''); setBody(d?.body || ''); setLoading(false); });
  }, [ready, privy, id]);

  const save = async () => {
    if (!privy) return;
    setSaving(true);
    const res = await saveDoc(privy, id, title, body);
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

  if (loading) return <div className="h-full flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!doc) return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
      <p className="text-[14px] font-semibold text-secondary">This document couldn’t be loaded.</p>
      <Link href="/docs" className="text-[13px] font-semibold text-accent hover:text-accent">← Back to Docs</Link>
    </div>
  );

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-subtle">
        <button onClick={() => router.push('/docs')} className="p-1.5 -ml-1 rounded-md text-tertiary hover:bg-surface-hover"><ArrowLeft className="w-4 h-4" /></button>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled" disabled={!canEdit} className="flex-1 text-sm font-semibold text-primary outline-none placeholder:text-tertiary bg-transparent" />
        <button onClick={() => setPreview((p) => !p)} title={preview ? 'Rich editor' : 'Edit markdown source'} className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-[12px] font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-sunken">{preview ? <Pencil className="w-3.5 h-3.5" /> : <Code2 className="w-3.5 h-3.5" />} {preview ? 'Editor' : 'Markdown'}</button>
        <button onClick={save} disabled={!canEdit || saving} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm disabled:opacity-40">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : savedAt ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />} {savedAt ? 'Saved' : 'Save'}</button>
      </header>

      {/* AI toolbar */}
      <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-subtle bg-surface-sunken/50">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-accent inline-flex items-center gap-1 mr-1"><Sparkles className="w-3.5 h-3.5" /> AI</span>
        {AI_ACTIONS.map((a) => (
          <button key={a.mode} onClick={() => ai(a.mode)} disabled={!canEdit || !!aiBusy}
            className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-semibold text-secondary ring-1 ring-subtle bg-surface hover:bg-surface-sunken disabled:opacity-40">
            {aiBusy === a.mode ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <a.icon className="w-3.5 h-3.5 text-accent" />} {a.label}
          </button>
        ))}
        <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
          <input value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && prompt.trim()) ai('write', prompt.trim()); }}
            placeholder="Write with AI — e.g. “draft an offer letter for a Senior Engineer”" disabled={!canEdit || !!aiBusy}
            className="flex-1 h-7 px-2.5 text-[12px] rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none disabled:opacity-50" />
          <button onClick={() => prompt.trim() && ai('write', prompt.trim())} disabled={!canEdit || !!aiBusy || !prompt.trim()} className="h-7 px-2.5 rounded-md text-[12px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 inline-flex items-center gap-1.5 disabled:opacity-40">{aiBusy === 'write' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Write</button>
        </div>
      </div>
      {aiError && (
        <div className="shrink-0 px-4 py-1.5 text-[12px] text-danger bg-danger/10 border-b border-danger/30">
          {aiError} {/no ai provider|settings/i.test(aiError) && <Link href="/settings/ai" className="font-semibold underline">Add a key →</Link>}
        </div>
      )}

      {/* Editor / raw-markdown view */}
      <div className="flex-1 overflow-hidden">
        {preview ? (
          <div className="h-full overflow-auto p-8">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={!canEdit}
              placeholder="# Markdown source…"
              className="w-full h-full resize-none text-[13px] leading-relaxed text-primary font-mono outline-none bg-transparent" />
          </div>
        ) : (
          <RichEditor value={body} onChange={setBody} editable={canEdit}
            placeholder="Start writing… type ‘# ’ for a heading, ‘- ’ for a list, or use the AI toolbar above." />
        )}
      </div>
    </>
  );
}
