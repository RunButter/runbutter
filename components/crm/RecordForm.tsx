'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, Trash2, Upload, Search } from 'lucide-react';
import type { ObjectDef, FormField } from '@/lib/crm/types';
import { createRecord, updateRecord, deleteRecord, loadRecords } from '@/lib/crm/data';
import { supabase } from '@/lib/supabase';

interface Props {
  object: ObjectDef;
  privyUserId: string | null;
  recordId?: string | null;       // present = edit mode
  initial?: Record<string, any>;  // prefill for edit
  suggestions?: Record<string, string[]>; // datalist autocomplete options per field
  onClose: () => void;
  onSaved: (createdId?: string) => void;
}

export default function RecordForm({ object, privyUserId, recordId, initial, suggestions, onClose, onSaved }: Props) {
  const fields = object.form || [];
  const [values, setValues] = useState<Record<string, any>>(() => {
    const v: Record<string, any> = {};
    for (const f of fields) v[f.key] = initial?.[f.key] ?? '';
    return v;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [relOptions, setRelOptions] = useState<Record<string, { id: string; name: string }[]>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupNote, setLookupNote] = useState('');
  const editing = !!recordId;

  const set = (k: string, val: any) => setValues((s) => ({ ...s, [k]: val }));
  const setMany = (patch: Record<string, any>) => setValues((s) => ({ ...s, ...patch }));

  // Enrich a company from its tax/VAT id (PL NIP via MF, EU VAT via VIES).
  const runLookup = async () => {
    const country = values.country, taxId = values.tax_id;
    if (!country || !String(taxId || '').trim()) { setError('Pick a country and enter a tax/VAT ID first.'); return; }
    setLookupBusy(true); setError(''); setLookupNote('');
    try {
      const res = await fetch('/api/company-lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country, taxId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Lookup failed'); setLookupBusy(false); return; }
      const c = data.company || {};
      setMany({
        name: c.name || values.name, address: c.address || values.address,
        tax_id: c.tax_id || values.tax_id, country: c.country || values.country,
      });
      setLookupNote(c.note || '');
    } catch (e: any) {
      setError(e?.message || 'Lookup failed');
    }
    setLookupBusy(false);
  };

  // Upload an image to the public 'branding' bucket and store its URL on the field.
  const uploadImage = async (f: FormField, file: File) => {
    setUploading(f.key); setError('');
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${object.slug}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from('branding').upload(path, file, { upsert: true, cacheControl: '3600' });
    if (upErr) { setError(`Upload failed: ${upErr.message}. Run migration 0017 to create the 'branding' bucket.`); setUploading(null); return; }
    const { data } = supabase.storage.from('branding').getPublicUrl(path);
    set(f.key, data.publicUrl);
    setUploading(null);
  };

  // Load options for any relation fields (e.g. invoice → company picker).
  useEffect(() => {
    const relFields = fields.filter((f) => f.input === 'relation' && f.optionsObject);
    if (relFields.length === 0) return;
    let cancelled = false;
    Promise.all(relFields.map(async (f) => {
      const res = await loadRecords(privyUserId, f.optionsObject!);
      const opts = res.rows.map((r: any) => ({ id: r.id, name: r.name || r.title || r.number || '—' }));
      return [f.key, opts] as const;
    })).then((pairs) => { if (!cancelled) setRelOptions(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!privyUserId) { setError('Sign in to save records.'); return; }
    for (const f of fields) if (f.required && !String(values[f.key] ?? '').trim()) { setError(`${f.label} is required.`); return; }
    setSaving(true); setError('');
    const res = editing
      ? await updateRecord(privyUserId, object.slug, recordId!, values)
      : await createRecord(privyUserId, object.slug, values);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved(editing ? undefined : (res as any).id);
  };

  const remove = async () => {
    if (!privyUserId || !recordId || !confirm(`Delete this ${object.singular.toLowerCase()}?`)) return;
    setSaving(true);
    const res = await deleteRecord(privyUserId, object.slug, recordId);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col bg-white rounded-xl ring-1 ring-slate-200/70 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-slate-200/70">
          <h2 className="text-sm font-bold text-slate-800">{editing ? `Edit ${object.singular}` : `New ${object.singular}`}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.key} className={`block ${f.input === 'textarea' || f.input === 'image' || f.input === 'lookup' ? 'sm:col-span-2' : ''}`}>
                {f.input !== 'lookup' && <span className="block text-[12px] font-semibold text-slate-600 mb-1">{f.label}{f.required && <span className="text-rose-500"> *</span>}</span>}
                {f.input === 'lookup' ? (
                  <button type="button" onClick={runLookup} disabled={lookupBusy}
                    className="w-full h-9 px-3 inline-flex items-center justify-center gap-1.5 rounded-md text-[13px] font-semibold text-primary-700 ring-1 ring-primary-200 bg-primary-50 hover:bg-primary-100 disabled:opacity-50">
                    {lookupBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} {f.label || 'Fetch company details'}
                  </button>
                ) : f.input === 'image' ? (
                  <div className="flex items-center gap-2.5">
                    {values[f.key]
                      ? <img src={values[f.key]} alt="" className="w-12 h-12 rounded-md object-cover ring-1 ring-slate-200" />
                      : <div className="w-12 h-12 rounded-md bg-slate-100 ring-1 ring-slate-200" />}
                    <label className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 cursor-pointer">
                      {uploading === f.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadImage(f, file); }} />
                    </label>
                    {values[f.key] && <button type="button" onClick={() => set(f.key, '')} className="text-[12px] text-slate-400 hover:text-rose-600">Remove</button>}
                  </div>
                ) : f.input === 'relation' ? (
                  <select value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}
                    className="w-full h-9 px-2.5 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none">
                    <option value="">{relOptions[f.key] ? '— none —' : 'Loading…'}</option>
                    {(relOptions[f.key] || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                ) : f.input === 'select' ? (
                  <select value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}
                    className="w-full h-9 px-2.5 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none capitalize">
                    <option value="">—</option>
                    {f.options?.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                  </select>
                ) : f.input === 'textarea' ? (
                  <textarea value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} rows={3}
                    className="w-full px-2.5 py-2 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
                ) : f.input === 'datalist' ? (
                  <>
                    <input list={`dl-${f.key}`} value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}
                      placeholder="Type or pick…" className="w-full h-9 px-2.5 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
                    <datalist id={`dl-${f.key}`}>{(suggestions?.[f.key] || []).map((o) => <option key={o} value={o} />)}</datalist>
                  </>
                ) : (
                  <input type={f.input === 'number' ? 'number' : f.input === 'date' ? 'date' : 'text'}
                    value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}
                    className="w-full h-9 px-2.5 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
                )}
              </div>
            ))}
          </div>
          {error && <p className="mt-3 text-[12px] text-rose-600">{error}</p>}
          {lookupNote && <p className="mt-3 text-[12px] text-amber-600">{lookupNote}</p>}
        </div>

        <div className="shrink-0 flex items-center gap-2 p-3 border-t border-slate-200/70">
          {editing && (
            <button onClick={remove} disabled={saving} className="p-2 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>
          )}
          <button onClick={onClose} className="ml-auto h-8 px-3 rounded-md text-[13px] font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={save} disabled={saving} className="h-8 px-3 rounded-md text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-50">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {editing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
