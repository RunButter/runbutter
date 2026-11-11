'use client';

import { useState } from 'react';
import { getAccessToken } from '@privy-io/react-auth';
import { Loader2, Sparkles, Upload, X } from 'lucide-react';
import type { ObjectDef } from '@/lib/crm/types';

/**
 * Paste a document, get a filled form.
 *
 * The job is to remove typing, not to remove the person. So this NEVER saves:
 * it hands the values back and the caller opens the ordinary RecordForm with
 * them prefilled, which means every field is editable, the required-field rules
 * still apply, and the save path is the one that already works.
 *
 * A PDF IS READ IN THE BROWSER. lib/pdf/convert.ts already turns one into text
 * here, so a contract or an invoice never leaves the machine to be parsed —
 * only the extracted text is sent, and only to the workspace's own AI key. Same
 * rule /pdf and the doc exporter follow.
 *
 * WHAT IT COULD NOT READ IS SHOWN, not swallowed. A form that quietly lost the
 * total is worse than one that says the date was ambiguous — the second is a
 * thing you fix in four seconds, the first is a wrong number in your ledger.
 */
export default function ExtractModal({ object, privy, workspaceId, onClose, onExtracted }: {
  object: ObjectDef;
  privy: string | null;
  workspaceId: string | null;
  onClose: () => void;
  onExtracted: (values: Record<string, string>) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dropped, setDropped] = useState<string[]>([]);
  const [reading, setReading] = useState('');

  async function readFile(file: File) {
    setError(''); setReading(file.name);
    try {
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        // Dynamic import: pdfjs is large and most people paste text instead.
        const { pdfToMarkdown } = await import('@/lib/pdf/convert');
        const out = await pdfToMarkdown(await file.arrayBuffer());
        setText(out.markdown);
        // A page with no text layer is a SCAN. Saying so beats letting somebody
        // conclude the invoice was blank — the reader cannot see what is not
        // there, and this is the one case where it genuinely read nothing.
        if (out.emptyPages.length) {
          setError(`No text on page ${out.emptyPages.join(', ')} — that looks like a scan. Type those details in yourself.`);
        }
      } else {
        setText(await file.text());
      }
    } catch (e: any) {
      setError(e?.message || 'That file could not be read.');
    } finally {
      setReading('');
    }
  }

  async function run() {
    if (!text.trim() || !privy || !workspaceId) return;
    setBusy(true); setError(''); setDropped([]);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch('/api/records/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
        body: JSON.stringify({
          privyUserId: privy, workspaceId, text,
          fields: (object.form || []).map((f) => ({ key: f.key, label: f.label, input: f.input, options: f.options })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j?.error || `Request failed (${res.status})`); return; }
      const values = j.values || {};
      if (Object.keys(values).length === 0) {
        setError('Nothing in that text matched this object’s fields.');
        setDropped(j.dropped || []);
        return;
      }
      // Handed straight to the form. Anything the reader could not use goes
      // with it so the person knows what to look at first.
      onExtracted(values);
      if (Array.isArray(j.dropped) && j.dropped.length) setDropped(j.dropped);
    } catch (e: any) {
      setError(e?.message || 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-xl bg-surface rounded-2xl ring-1 ring-subtle shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 px-4 flex items-center gap-2 border-b border-subtle">
          <Sparkles className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-medium text-primary">Paste a document</h2>
          <button onClick={onClose} aria-label="Close"
            className="ml-auto h-7 w-7 inline-flex items-center justify-center rounded-md text-tertiary hover:text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          <p className="text-2xs text-tertiary mb-2">
            An invoice, a forwarded email, anything with the details in it. It fills a {object.singular.toLowerCase()} form
            for you to check — nothing is saved until you press Save.
          </p>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onDrop={(e) => { const f = e.dataTransfer.files?.[0]; if (f) { e.preventDefault(); readFile(f); } }}
            rows={9}
            placeholder="Paste text here, or drop a PDF…"
            className="w-full p-3 text-xs bg-surface-sunken rounded-lg ring-1 ring-subtle text-primary placeholder:text-tertiary outline-none focus:ring-2 focus:ring-accent/30 resize-none" />

          <div className="mt-2 flex items-center gap-2">
            <label className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-2xs font-semibold text-secondary hover:text-primary hover:bg-surface-sunken cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              {reading ? `Reading ${reading}…` : 'Choose a file'}
              <input type="file" accept=".pdf,.txt,.md,.csv,text/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }} />
            </label>
            <span className="text-2xs text-tertiary">PDFs are read here, never uploaded.</span>
            <button onClick={run} disabled={busy || !text.trim() || !privy}
              className="ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-inverse text-inverse-fg text-xs font-semibold disabled:opacity-40">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Fill the form
            </button>
          </div>

          {error && <p className="mt-2 text-2xs text-danger">{error}</p>}
          {dropped.length > 0 && (
            <div className="mt-2 p-2 rounded-lg bg-surface-sunken">
              <p className="text-2xs font-semibold text-secondary">Could not use:</p>
              <ul className="mt-0.5 space-y-0.5">
                {dropped.map((d) => <li key={d} className="text-2xs text-tertiary">{d}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
