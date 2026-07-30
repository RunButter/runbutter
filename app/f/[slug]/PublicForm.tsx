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
  const [suggestion, setSuggestion] = useState<{ field: string; value: string } | null>(null);

  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  const submit = async (confirmEmail = false) => {
    // Required-field check up front.
    for (const f of form.fields) {
      if (f.required && !String(values[f.key] ?? '').trim()) { setErr(`${f.label} is required.`); return; }
    }
    setBusy(true); setErr(''); setSuggestion(null);
    try {
      const res = await fetch('/api/forms/submit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, data: values, confirmEmail }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        // The server spotted a likely typo. Offer the fix and let them keep
        // their address if it really is right — never a dead end.
        if (j?.confirmable && j?.suggestion && j?.field) {
          setSuggestion({ field: j.field, value: j.suggestion });
        }
        setErr(j?.error || 'Could not submit. Try again.');
        return;
      }
      setDone(j.message || 'Thanks — we\'ll be in touch.');
    } finally { setBusy(false); }
  };

  const acceptSuggestion = () => {
    if (!suggestion) return;
    set(suggestion.field, suggestion.value);
    setSuggestion(null);
    setErr('');
  };

  const input = 'w-full h-11 px-3 rounded-lg bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none text-base';

  if (done) {
    return (
      <div className="w-full max-w-md rounded-xl bg-surface border border-subtle p-8 text-center mt-8">
        <div className="w-12 h-12 rounded-full bg-success/10 text-success mx-auto flex items-center justify-center mb-4"><Check className="w-6 h-6" /></div>
        <h1 className="text-lg font-medium text-primary">Submitted</h1>
        <p className="mt-2 text-sm text-secondary leading-relaxed">{done}</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-xl bg-surface border border-subtle p-6 sm:p-8">
      <div className="mb-5">
        <div className="text-2xs font-semibold uppercase tracking-widest text-tertiary">{form.workspace_name}</div>
        <h1 className="mt-1 text-xl font-medium text-primary tracking-tight">{form.title}</h1>
        {form.description && <p className="mt-1 text-sm text-secondary leading-relaxed">{form.description}</p>}
      </div>

      <div className="space-y-3.5">
        {form.fields.map((f) => (
          <label key={f.key} className="block">
            <span className="block text-sm font-medium text-secondary mb-1">{f.label}{f.required && <span className="text-danger"> *</span>}</span>
            {f.type === 'textarea' ? (
              <textarea value={values[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} rows={4}
                className={input.replace('h-11', 'h-auto py-2.5') + ' resize-y'} />
            ) : f.type === 'select' ? (
              <select value={values[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} className={input}>
                <option value="">Select…</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'checkbox' ? (
              <label className="flex items-center gap-2 text-sm text-secondary">
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

      {err && (
        <div className={`mt-4 rounded-lg px-3 py-2 text-xs ${
          suggestion ? 'bg-warning/10 ring-1 ring-warning/30 text-warning' : 'bg-danger/10 ring-1 ring-danger/30 text-danger'
        }`}>
          <p>{err}</p>
          {suggestion && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button onClick={acceptSuggestion}
                className="h-7 px-2.5 rounded-md bg-warning/20 text-xs font-semibold hover:bg-warning/30">
                Use {suggestion.value}
              </button>
              <button onClick={() => submit(true)}
                className="h-7 px-2.5 rounded-md text-xs font-medium underline underline-offset-2 hover:opacity-80">
                Keep what I typed
              </button>
            </div>
          )}
        </div>
      )}

      <button onClick={() => submit()} disabled={busy}
        className="mt-6 w-full h-11 rounded-lg bg-inverse text-inverse-fg text-sm font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Submit
      </button>
      <p className="mt-3 text-2xs text-tertiary text-center">Powered by RunButter</p>
    </div>
  );
}
