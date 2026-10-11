'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, ChevronLeft, ChevronRight, Copy, Check, AlertTriangle, FileDown, Files, FileText, Save } from 'lucide-react';
import { loadRecords, getWorkspace } from '@/lib/crm/data';
import { loadCustomObjects } from '@/lib/crm/custom';
import { OBJECTS } from '@/lib/crm/registry';
import { saveDoc } from '@/lib/crm/docs';
import { docToHtml, downloadPdfMany, downloadPdfZip, downloadWordMany } from '@/lib/crm/doc-export';
import { availableFields, fill, mergeFields, recordName, unknownFields } from '@/lib/docs/merge';

/**
 * Mail merge: this document, filled in once per record.
 *
 * Everything happens in the browser, like every other export here: the records
 * come through the normal list read, the PDFs are drawn by pdf-lib, nothing is
 * uploaded. "Save as documents" is the one write, and it goes through the same
 * save_doc a person uses.
 */
const SOURCES = ['people', 'companies', 'invoices', 'offers', 'products', 'projects', 'issues', 'assets'];
/** A merge is for letters, not a mailing list — past this it is the newsletter screen's job. */
const MAX = 200;

export default function MailMerge({ privy, title, body, onClose, onSaved }: {
  privy: string; title: string; body: string; onClose: () => void; onSaved?: (n: number) => void;
}) {
  const [custom, setCustom] = useState<{ slug: string; plural: string }[]>([]);
  const [object, setObject] = useState('people');
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    getWorkspace(privy).then((w) => w && loadCustomObjects(privy, w.id))
      .then((r) => setCustom((r?.rows || []).filter((o) => o.enabled).map((o) => ({ slug: o.slug, plural: o.plural }))))
      .catch(() => {});
  }, [privy]);

  useEffect(() => {
    setLoading(true); setAt(0); setDone('');
    loadRecords(privy, object).then((r) => {
      const list = r.live ? r.rows : [];
      setRows(list);
      setPicked(new Set(list.slice(0, MAX).map((x: any) => String(x.id))));
      setLoading(false);
    });
  }, [privy, object]);

  const fields = useMemo(() => availableFields(object, rows), [object, rows]);
  const used = useMemo(() => mergeFields(body), [body]);
  const missing = useMemo(() => unknownFields(body, fields), [body, fields]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(t)) : rows;
  }, [rows, q]);
  const chosen = useMemo(() => rows.filter((r) => picked.has(String(r.id))), [rows, picked]);
  const current = chosen[Math.min(at, Math.max(0, chosen.length - 1))];

  const docs = () => chosen.slice(0, MAX).map((r) => ({ title: `${title || 'Untitled'} — ${recordName(r)}`, body: fill(body, r) }));
  const run = async (kind: string, fn: () => Promise<void> | void) => {
    setBusy(kind); setDone('');
    try { await fn(); } finally { setBusy(''); }
  };
  const saveAll = () => run('save', async () => {
    let n = 0;
    for (const d of docs()) { const res = await saveDoc(privy, null, d.title, d.body, 'doc'); if (!res.error) n++; }
    setDone(`Saved ${n} document${n === 1 ? '' : 's'} to Docs.`);
    onSaved?.(n);
  });

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allShown = shown.length > 0 && shown.every((r) => picked.has(String(r.id)));
  const label = (slug: string) => OBJECTS[slug]?.plural || custom.find((c) => c.slug === slug)?.plural || slug;
  const copy = (key: string) => { navigator.clipboard?.writeText(`{{${key}}}`); setCopied(key); setTimeout(() => setCopied(''), 1200); };

  const btn = 'h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm ring-1 ring-subtle text-secondary hover:bg-surface-hover disabled:opacity-40';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-3 sm:p-4" onClick={onClose}>
      <div className="w-full max-w-5xl max-h-[92vh] flex flex-col bg-surface rounded-2xl ring-1 ring-subtle shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center gap-2 px-5 border-b border-subtle">
          <Files className="w-4 h-4 text-accent" />
          <h2 className="text-base font-medium text-primary flex-1">Mail merge</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 min-h-0 grid md:grid-cols-[minmax(0,20rem)_1fr] overflow-hidden">
          {/* Who */}
          <section className="flex flex-col min-h-0 border-b md:border-b-0 md:border-r border-subtle">
            <div className="p-3 space-y-2 border-b border-subtle">
              <label className="block text-2xs font-semibold uppercase tracking-wider text-tertiary">Fill it in for</label>
              <select value={object} onChange={(e) => setObject(e.target.value)} aria-label="Record type"
                className="w-full h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm outline-none">
                {SOURCES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                {custom.length > 0 && <optgroup label="Your objects">{custom.map((c) => <option key={c.slug} value={c.slug}>{c.plural}</option>)}</optgroup>}
              </select>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search records"
                className="w-full h-8 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle outline-none" />
              <div className="flex items-center gap-2 text-2xs text-tertiary">
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={allShown} className="accent-accent"
                    onChange={() => setPicked((s) => { const n = new Set(s); shown.forEach((r) => (allShown ? n.delete(String(r.id)) : n.add(String(r.id)))); return n; })} />
                  All{q ? ' shown' : ''}
                </label>
                <span className="ml-auto">{chosen.length} of {rows.length} selected{chosen.length > MAX ? ` — first ${MAX} are used` : ''}</span>
              </div>
            </div>
            <ul className="flex-1 overflow-y-auto min-h-[8rem] max-h-[40vh] md:max-h-none">
              {loading ? <li className="p-4 text-sm text-tertiary flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</li>
                : shown.length === 0 ? <li className="p-4 text-sm text-tertiary">No {label(object).toLowerCase()} {q ? 'match' : 'yet'}.</li>
                : shown.map((r) => (
                  <li key={r.id}>
                    <label className="flex items-center gap-2 px-3 h-9 text-sm hover:bg-surface-hover cursor-pointer">
                      <input type="checkbox" checked={picked.has(String(r.id))} onChange={() => toggle(String(r.id))} className="accent-accent" />
                      <span className="truncate text-secondary">{recordName(r)}</span>
                      {r.email && r.email !== recordName(r) && <span className="ml-auto truncate text-2xs text-tertiary max-w-[45%]">{r.email}</span>}
                    </label>
                  </li>
                ))}
            </ul>
          </section>

          {/* What it becomes */}
          <section className="flex flex-col min-h-0 overflow-y-auto">
            <div className="p-3 border-b border-subtle space-y-2">
              <div className="text-2xs font-semibold uppercase tracking-wider text-tertiary">Fields — click to copy, then paste into the document</div>
              <div className="flex flex-wrap gap-1">
                {fields.map((f) => (
                  <button key={f.key} onClick={() => copy(f.key)} title={`{{${f.key}}}`}
                    className={`h-6 px-2 inline-flex items-center gap-1 rounded-md text-2xs ring-1 ${used.includes(f.key) ? 'ring-accent/40 bg-accent/10 text-primary' : 'ring-subtle text-secondary hover:text-primary'}`}>
                    {copied === f.key ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3 opacity-50" />} {f.label}
                  </button>
                ))}
              </div>
              {used.length === 0 && (
                <p className="text-xs text-secondary">This document has no fields yet. Write <code className="font-mono bg-surface-hover rounded px-1">{'{{first_name}}'}</code> where a name goes and every copy gets its own.</p>
              )}
              {missing.length > 0 && (
                <p className="text-xs text-warning flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {label(object)} have no {missing.map((m) => `{{${m}}}`).join(', ')} — {missing.length === 1 ? 'it' : 'they'} will be left blank.</p>
              )}
            </div>

            <div className="p-3 flex items-center gap-2 text-xs text-secondary">
              <span className="font-medium text-primary truncate">{current ? recordName(current) : 'Nobody selected'}</span>
              <span className="text-tertiary">{chosen.length ? `${Math.min(at, chosen.length - 1) + 1} / ${chosen.length}` : ''}</span>
              <button onClick={() => setAt((i) => Math.max(0, i - 1))} disabled={at <= 0} aria-label="Previous" className="ml-auto p-1 rounded hover:bg-surface-hover disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={() => setAt((i) => Math.min(chosen.length - 1, i + 1))} disabled={at >= chosen.length - 1} aria-label="Next" className="p-1 rounded hover:bg-surface-hover disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <article className="mx-3 mb-3 rounded-xl ring-1 ring-subtle bg-surface p-6 text-sm text-primary leading-relaxed prose-sm [&_h1]:text-lg [&_h1]:font-medium [&_h2]:text-base [&_h2]:font-medium [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
              // docToHtml escapes the text it is given; the only markup is its own.
              dangerouslySetInnerHTML={{ __html: current ? docToHtml(fill(body, current)) : '<p style="opacity:.6">Pick at least one record.</p>' }} />
          </section>
        </div>

        <div className="shrink-0 flex flex-wrap items-center gap-2 p-3 border-t border-subtle">
          <span className="text-xs text-tertiary mr-auto">{done || `${Math.min(chosen.length, MAX)} cop${Math.min(chosen.length, MAX) === 1 ? 'y' : 'ies'} of “${title || 'Untitled'}”`}</span>
          <button className={btn} disabled={!chosen.length || !!busy} onClick={() => run('pdf', () => downloadPdfMany(title || 'Merge', docs()))}>
            {busy === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} One PDF
          </button>
          <button className={btn} disabled={!chosen.length || !!busy} onClick={() => run('zip', () => downloadPdfZip(title || 'Merge', docs()))}>
            {busy === 'zip' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Files className="w-4 h-4" />} PDFs (.zip)
          </button>
          <button className={btn} disabled={!chosen.length || !!busy} onClick={() => run('word', () => downloadWordMany(title || 'Merge', docs()))}>
            {busy === 'word' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Word
          </button>
          <button disabled={!chosen.length || !!busy} onClick={saveAll}
            className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
            {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save as documents
          </button>
        </div>
      </div>
    </div>
  );
}
