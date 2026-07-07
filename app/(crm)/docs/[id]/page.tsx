'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowLeft, Loader2, Save, Sparkles, Wand2, ListTree, CornerDownRight, SpellCheck, Eye, Pencil, Check } from 'lucide-react';
import { loadDoc, saveDoc, runAI, type Doc } from '@/lib/crm/docs';

// tiny, escaped markdown → html for the live preview (headings/bold/italic/code/lists)
function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-slate-100 rounded px-1 text-[0.85em]">$1</code>');
  const out: string[] = []; let inList = false;
  for (const raw of (md || '').split('\n')) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { if (!inList) { out.push('<ul class="list-disc pl-5 space-y-1 my-2">'); inList = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (inList) { out.push('</ul>'); inList = false; }
    if (/^###\s+/.test(line)) out.push(`<h3 class="text-[15px] font-bold text-slate-800 mt-3 mb-1">${inline(line.replace(/^###\s+/, ''))}</h3>`);
    else if (/^##\s+/.test(line)) out.push(`<h2 class="text-lg font-black text-slate-900 mt-4 mb-1">${inline(line.replace(/^##\s+/, ''))}</h2>`);
    else if (/^#\s+/.test(line)) out.push(`<h1 class="text-xl font-black text-slate-900 mt-4 mb-2">${inline(line.replace(/^#\s+/, ''))}</h1>`);
    else if (line === '') out.push('<div class="h-2"></div>');
    else out.push(`<p class="text-[14px] text-slate-700 leading-relaxed">${inline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

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

  const html = useMemo(() => mdToHtml(body), [body]);

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

  if (loading) return <div className="h-full flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!doc) return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
      <p className="text-[14px] font-semibold text-slate-600">This document couldn’t be loaded.</p>
      <Link href="/docs" className="text-[13px] font-semibold text-primary-600 hover:text-primary-700">← Back to Docs</Link>
    </div>
  );

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-slate-200/70">
        <button onClick={() => router.push('/docs')} className="p-1.5 -ml-1 rounded-md text-slate-400 hover:bg-slate-100"><ArrowLeft className="w-4 h-4" /></button>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled" disabled={!canEdit} className="flex-1 text-sm font-bold text-slate-800 outline-none placeholder:text-slate-300 bg-transparent" />
        <button onClick={() => setPreview((p) => !p)} className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-[12px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">{preview ? <Pencil className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} {preview ? 'Edit' : 'Preview'}</button>
        <button onClick={save} disabled={!canEdit || saving} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 shadow-sm disabled:opacity-40">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : savedAt ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />} {savedAt ? 'Saved' : 'Save'}</button>
      </header>

      {/* AI toolbar */}
      <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-slate-200/70 bg-slate-50/50">
        <span className="text-[11px] font-bold uppercase tracking-wider text-primary-600 inline-flex items-center gap-1 mr-1"><Sparkles className="w-3.5 h-3.5" /> AI</span>
        {AI_ACTIONS.map((a) => (
          <button key={a.mode} onClick={() => ai(a.mode)} disabled={!canEdit || !!aiBusy}
            className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-semibold text-slate-700 ring-1 ring-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40">
            {aiBusy === a.mode ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <a.icon className="w-3.5 h-3.5 text-primary-500" />} {a.label}
          </button>
        ))}
        <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
          <input value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && prompt.trim()) ai('write', prompt.trim()); }}
            placeholder="Write with AI — e.g. “draft an offer letter for a Senior Engineer”" disabled={!canEdit || !!aiBusy}
            className="flex-1 h-7 px-2.5 text-[12px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none disabled:opacity-50" />
          <button onClick={() => prompt.trim() && ai('write', prompt.trim())} disabled={!canEdit || !!aiBusy || !prompt.trim()} className="h-7 px-2.5 rounded-md text-[12px] font-bold text-white bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-40">{aiBusy === 'write' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Write</button>
        </div>
      </div>
      {aiError && (
        <div className="shrink-0 px-4 py-1.5 text-[12px] text-rose-600 bg-rose-50 border-b border-rose-100">
          {aiError} {/no ai provider|settings/i.test(aiError) && <Link href="/settings/ai" className="font-bold underline">Add a key →</Link>}
        </div>
      )}

      {/* Editor / preview */}
      <div className="flex-1 overflow-hidden">
        {preview ? (
          <div className="h-full overflow-auto p-8"><div className="max-w-2xl mx-auto" dangerouslySetInnerHTML={{ __html: html }} /></div>
        ) : (
          <textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={!canEdit}
            placeholder="# Start writing…&#10;&#10;Use the AI toolbar to draft, improve, or summarize. Markdown supported."
            className="w-full h-full resize-none p-8 text-[14px] leading-relaxed text-slate-800 font-mono outline-none disabled:bg-slate-50/40" />
        )}
      </div>
    </>
  );
}
