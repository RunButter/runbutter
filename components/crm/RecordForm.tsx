'use client';

import { useState } from 'react';
import { X, Loader2, Trash2 } from 'lucide-react';
import type { ObjectDef } from '@/lib/crm/types';
import { createRecord, updateRecord, deleteRecord } from '@/lib/crm/data';

interface Props {
  object: ObjectDef;
  privyUserId: string | null;
  recordId?: string | null;       // present = edit mode
  initial?: Record<string, any>;  // prefill for edit
  suggestions?: Record<string, string[]>; // datalist autocomplete options per field
  onClose: () => void;
  onSaved: () => void;
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
  const editing = !!recordId;

  const set = (k: string, val: any) => setValues((s) => ({ ...s, [k]: val }));

  const save = async () => {
    if (!privyUserId) { setError('Sign in to save records.'); return; }
    for (const f of fields) if (f.required && !String(values[f.key] ?? '').trim()) { setError(`${f.label} is required.`); return; }
    setSaving(true); setError('');
    const res = editing
      ? await updateRecord(privyUserId, object.slug, recordId!, values)
      : await createRecord(privyUserId, object.slug, values);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved();
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
              <label key={f.key} className={`block ${f.input === 'textarea' ? 'sm:col-span-2' : ''}`}>
                <span className="block text-[12px] font-semibold text-slate-600 mb-1">{f.label}{f.required && <span className="text-rose-500"> *</span>}</span>
                {f.input === 'select' ? (
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
              </label>
            ))}
          </div>
          {error && <p className="mt-3 text-[12px] text-rose-600">{error}</p>}
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
