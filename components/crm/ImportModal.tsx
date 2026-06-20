'use client';

import { useState } from 'react';
import { X, Loader2, Upload, FileSpreadsheet, ArrowLeft, CheckCircle2 } from 'lucide-react';
import type { ObjectDef } from '@/lib/crm/types';
import { parseCSV, autoMatch } from '@/lib/crm/csv';
import { importRecords, fetchSheetCsv } from '@/lib/crm/data';

interface Props {
  object: ObjectDef;
  privyUserId: string | null;
  onClose: () => void;
  onImported: () => void;
}

export default function ImportModal({ object, privyUserId, onClose, onImported }: Props) {
  const fields = object.form || [];
  const [step, setStep] = useState<'source' | 'map' | 'done'>('source');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [count, setCount] = useState(0);

  const readFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ''));
    reader.readAsText(file);
  };

  const fetchUrl = async () => {
    if (!url.trim()) return;
    setBusy(true); setError('');
    const res = await fetchSheetCsv(url.trim());
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setText(res.text || '');
  };

  const parse = () => {
    setError('');
    const { headers: h, rows: r } = parseCSV(text);
    if (h.length === 0 || r.length === 0) { setError('Could not find a header row and data. Paste CSV or upload a file.'); return; }
    setHeaders(h); setRows(r);
    const m: Record<string, number> = {};
    for (const f of fields) m[f.key] = autoMatch(f.key, f.label, h);
    setMapping(m);
    setStep('map');
  };

  const runImport = async () => {
    if (!privyUserId) { setError('Sign in to import.'); return; }
    setBusy(true); setError('');
    const data = rows.map((r) => {
      const obj: Record<string, any> = {};
      for (const f of fields) { const idx = mapping[f.key]; if (idx >= 0) obj[f.key] = (r[idx] ?? '').trim(); }
      return obj;
    });
    const res = await importRecords(privyUserId, object.slug, data);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setCount(res.count || 0); setStep('done');
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col bg-white rounded-xl ring-1 ring-slate-200/70 shadow-2xl animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-slate-200/70">
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            {step === 'map' && <button onClick={() => setStep('source')} className="p-1 -ml-1 rounded text-slate-400 hover:bg-slate-100"><ArrowLeft className="w-4 h-4" /></button>}
            Import {object.plural}
          </h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {step === 'source' && (
            <div className="space-y-4">
              <label className="flex items-center justify-center gap-2 h-20 rounded-lg ring-1 ring-dashed ring-slate-300 text-[13px] text-slate-500 cursor-pointer hover:ring-slate-400 hover:bg-slate-50">
                <Upload className="w-4 h-4" /> Upload a .csv file
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
              </label>

              <div>
                <span className="block text-[12px] font-semibold text-slate-600 mb-1 flex items-center gap-1.5"><FileSpreadsheet className="w-3.5 h-3.5" /> …or a Google Sheet (Publish to web → CSV)</span>
                <div className="flex gap-2">
                  <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/…/pub?output=csv"
                    className="flex-1 h-9 px-2.5 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
                  <button onClick={fetchUrl} disabled={busy} className="h-9 px-3 rounded-md text-[13px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Fetch'}</button>
                </div>
              </div>

              <div>
                <span className="block text-[12px] font-semibold text-slate-600 mb-1">…or paste CSV</span>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="name,domain,industry&#10;Acme,acme.com,SaaS"
                  className="w-full px-2.5 py-2 text-[12px] font-mono rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
              </div>
              {error && <p className="text-[12px] text-rose-600">{error}</p>}
            </div>
          )}

          {step === 'map' && (
            <div className="space-y-3">
              <p className="text-[12px] text-slate-500">{rows.length} rows detected. Map your columns to {object.singular} fields:</p>
              {fields.map((f) => (
                <div key={f.key} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 text-[13px] font-medium text-slate-700">{f.label}{f.required && <span className="text-rose-500"> *</span>}</span>
                  <select value={mapping[f.key] ?? -1} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) }))}
                    className="flex-1 h-8 px-2 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none">
                    <option value={-1}>— skip —</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </div>
              ))}
              {error && <p className="text-[12px] text-rose-600">{error}</p>}
            </div>
          )}

          {step === 'done' && (
            <div className="py-8 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
              <p className="text-sm font-bold text-slate-800">Imported {count} {object.plural.toLowerCase()}</p>
              <p className="text-[12px] text-slate-500 mt-1">{rows.length - count > 0 ? `${rows.length - count} rows were skipped (missing required fields).` : 'All rows imported.'}</p>
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2 p-3 border-t border-slate-200/70">
          {step === 'source' && (
            <>
              <button onClick={onClose} className="h-8 px-3 rounded-md text-[13px] font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
              <button onClick={parse} disabled={!text.trim()} className="h-8 px-3 rounded-md text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-40">Continue</button>
            </>
          )}
          {step === 'map' && (
            <button onClick={runImport} disabled={busy} className="h-8 px-3 rounded-md text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-50">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Import {rows.length} rows
            </button>
          )}
          {step === 'done' && (
            <button onClick={onImported} className="h-8 px-3 rounded-md text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700">Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
