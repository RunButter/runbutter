'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, Trash2, Upload, Search } from 'lucide-react';
import type { ObjectDef, FormField } from '@/lib/crm/types';
import { createRecord, updateRecord, deleteRecord, loadRecords } from '@/lib/crm/data';
import { uploadImage } from '@/lib/crm/upload';
import SearchSelect from './SearchSelect';
import { useDialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

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
  const { confirm: confirmDialog } = useDialog();
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

  // Upload via the server route (service role + auto-created bucket).
  const uploadFieldImage = async (f: FormField, file: File) => {
    if (!privyUserId) { setError('Sign in to upload images.'); return; }
    setUploading(f.key); setError('');
    const { url, error: upErr } = await uploadImage(privyUserId, null, file, object.slug);
    if (upErr) { setError(upErr); setUploading(null); return; }
    set(f.key, url!);
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
    if (!privyUserId || !recordId || !await confirmDialog(`Delete this ${object.singular.toLowerCase()}?`)) return;
    setSaving(true);
    const res = await deleteRecord(privyUserId, object.slug, recordId);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col bg-surface rounded-xl ring-1 ring-subtle shadow-popover animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-subtle">
          <h2 className="text-base font-semibold text-primary">{editing ? `Edit ${object.singular}` : `New ${object.singular}`}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.key} className={`block ${f.input === 'textarea' || f.input === 'image' || f.input === 'lookup' ? 'sm:col-span-2' : ''}`}>
                {f.input !== 'lookup' && <Label required={f.required}>{f.label}</Label>}
                {f.input === 'lookup' ? (
                  <button type="button" onClick={runLookup} disabled={lookupBusy}
                    className="w-full h-9 px-3 inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-semibold text-accent ring-1 ring-accent/30 bg-accent/10 hover:bg-accent/10 disabled:opacity-50">
                    {lookupBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} {f.label || 'Fetch company details'}
                  </button>
                ) : f.input === 'image' ? (
                  <div className="flex items-center gap-2.5">
                    {values[f.key]
                      ? <img src={values[f.key]} alt="" className="w-12 h-12 rounded-md object-cover ring-1 ring-subtle" />
                      : <div className="w-12 h-12 rounded-md bg-surface-hover ring-1 ring-subtle" />}
                    <label className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-secondary ring-1 ring-subtle hover:bg-surface-sunken cursor-pointer">
                      {uploading === f.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadFieldImage(f, file); }} />
                    </label>
                    {values[f.key] && <button type="button" onClick={() => set(f.key, '')} className="text-xs text-tertiary hover:text-danger">Remove</button>}
                  </div>
                ) : f.input === 'relation' ? (
                  <SearchSelect options={relOptions[f.key] || []} value={values[f.key] ?? ''} onChange={(id) => set(f.key, id)}
                    placeholder={relOptions[f.key] ? `Search ${f.label.toLowerCase()}…` : 'Loading…'} allowClear />
                ) : f.input === 'select' ? (
                  <Select value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} className="capitalize">
                    <option value="">—</option>
                    {f.options?.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                  </Select>
                ) : f.input === 'textarea' ? (
                  <Textarea value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} rows={3} />
                ) : f.input === 'datalist' ? (
                  <>
                    <Input list={`dl-${f.key}`} value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}
                      placeholder="Type or pick…" />
                    <datalist id={`dl-${f.key}`}>{(suggestions?.[f.key] || []).map((o) => <option key={o} value={o} />)}</datalist>
                  </>
                ) : (
                  <Input type={f.input === 'number' ? 'number' : f.input === 'date' ? 'date' : 'text'}
                    value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
                )}
              </div>
            ))}
          </div>
          {error && <p className="mt-3 text-xs text-danger">{error}</p>}
          {lookupNote && <p className="mt-3 text-xs text-warning">{lookupNote}</p>}
        </div>

        <div className="shrink-0 flex items-center gap-2 p-3 border-t border-subtle">
          {editing && (
            <button onClick={remove} disabled={saving} className="p-2 rounded-md text-tertiary hover:text-danger hover:bg-danger/10" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>
          )}
          <button onClick={onClose} className="ml-auto h-8 px-3 rounded-md text-sm font-medium text-secondary hover:bg-surface-hover">Cancel</button>
          <button onClick={save} disabled={saving} className="h-8 px-3 rounded-md text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 inline-flex items-center gap-1.5 disabled:opacity-50">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {editing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
