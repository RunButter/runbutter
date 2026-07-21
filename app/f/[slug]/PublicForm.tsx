'use client';

import { useState } from 'react';
import { Loader2, Check, Send } from 'lucide-react';
import type { FormField } from '@/lib/forms/client';

export interface PublicFormData {
  id: string; title: string; description: string | null;
  fields: FormField[]; enabled: boolean; workspace_name: string;
}

export default function PublicForm({ slug, form }: { slug: string; form: PublicFormData }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [err, setErr] = useState('');

  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    // Required-field check up front.
    for (const f of form.fields) {
      if (f.required && !String(values[f.key] ?? '').trim()) { setErr(`${f.label} is required.`); return; }
    }
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/forms/submit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, data: values }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { setErr(j?.error || 'Could not submit. Try again.'); return; }
      setDone(j.message || 'Thanks — we\'ll be in touch.');
    } finally { setBusy(false); }
  };

  const input = 'w-full h-11 px-3 rounded-lg bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none text-[14px]';

  if (done) {
    return (
      <div className="w-full max-w-md rounded-xl bg-surface border border-subtle p-8 text-center mt-8">
        <div className="w-12 h-12 rounded-full bg-success/10 text-success mx-auto flex items-center justify-center mb-4"><Check className="w-6 h-6" /></div>
        <h1 className="text-lg font-medium text-primary">Submitted</h1>
        <p className="mt-2 text-[13px] text-secondary leading-relaxed">{done}</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-xl bg-surface border border-subtle p-6 sm:p-8">
      <div className="mb-5">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-tertiary">{form.workspace_name}</div>
        <h1 className="mt-1 text-xl font-medium text-primary tracking-tight">{form.title}</h1>
        {form.description && <p className="mt-1 text-[13px] text-secondary leading-relaxed">{form.description}</p>}
      </div>

      <div className="space-y-3.5">
        {form.fields.map((f) => (
          <label key={f.key} className="block">
            <span className="block text-[13px] font-medium text-secondary mb-1">{f.label}{f.required && <span className="text-danger"> *</span>}</span>
            {f.type === 'textarea' ? (
              <textarea value={values[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} rows={4}
                className={input.replace('h-11', 'h-auto py-2.5') + ' resize-y'} />
            ) : f.type === 'select' ? (
              <select value={values[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} className={input}>
                <option value="">Select…</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'checkbox' ? (
              <label className="flex items-center gap-2 text-[13px] text-secondary">
                <input type="checkbox" checked={values[f.key] === 'yes'} onChange={(e) => set(f.key, e.target.checked ? 'yes' : '')}
                  className="rounded border-subtle accent-accent" /> {f.label}
              </label>
            ) : (
              <input type={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'}
                value={values[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} className={input} />
            )}
          </label>
        ))}
      </div>

      {err && <div className="mt-4 rounded-lg bg-danger/10 ring-1 ring-danger/30 px-3 py-2 text-[12px] text-danger">{err}</div>}

      <button onClick={submit} disabled={busy}
        className="mt-6 w-full h-11 rounded-lg bg-inverse text-inverse-fg text-sm font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Submit
      </button>
      <p className="mt-3 text-[11px] text-tertiary text-center">Powered by RunButter</p>
    </div>
  );
}
