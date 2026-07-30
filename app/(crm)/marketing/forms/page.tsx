'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { FileInput, Loader2, Plus, X, Trash2, Copy, Check, ExternalLink, Inbox, GripVertical } from 'lucide-react';
import { getWorkspace, type WorkspaceContext } from '@/lib/crm/data';
import { getForms, getForm, saveForm, deleteForm, getFormSubmissions, type FormRow, type FormDetail, type FormField, type FieldType, type FieldMap, type FormSubmission } from '@/lib/forms/client';
import { useDialog } from '@/components/ui/Dialog';

const TYPES: { v: FieldType; label: string }[] = [
  { v: 'text', label: 'Text' }, { v: 'email', label: 'Email' }, { v: 'tel', label: 'Phone' },
  { v: 'textarea', label: 'Paragraph' }, { v: 'select', label: 'Dropdown' }, { v: 'checkbox', label: 'Checkbox' },
];
const MAPS: { v: FieldMap; label: string }[] = [
  { v: '', label: 'Extra field' }, { v: 'first_name', label: 'First name' }, { v: 'last_name', label: 'Last name' },
  { v: 'email', label: 'Email' }, { v: 'phone', label: 'Phone' }, { v: 'title', label: 'Job title' }, { v: 'linkedin_url', label: 'LinkedIn' },
];
const rnd = () => Math.random().toString(36).slice(2, 8);

const starter = (): FormDetail => ({
  id: null, name: 'Contact form', title: 'Get in touch', description: 'Tell us a bit about you and we\'ll reach out.',
  submit_message: 'Thanks — we\'ll be in touch shortly.', enabled: true,
  fields: [
    { key: 'f_' + rnd(), label: 'Name', type: 'text', required: true, map: 'first_name' },
    { key: 'f_' + rnd(), label: 'Email', type: 'email', required: true, map: 'email' },
    { key: 'f_' + rnd(), label: 'Message', type: 'textarea', required: false, map: '' },
  ],
});

export default function FormsPage() {
  const { confirm: confirmDialog, notify } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [rows, setRows] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FormDetail | null>(null);
  const [viewing, setViewing] = useState<FormRow | null>(null);
  const [copied, setCopied] = useState('');
  const [origin, setOrigin] = useState('https://runbutter.app');

  const canManage = !!privy && !!ws;
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const load = useCallback(async () => {
    if (!privy) { setLoading(false); return; }
    const w = await getWorkspace(privy);
    setWs(w);
    if (w) setRows(await getForms(privy, w.id));
    setLoading(false);
  }, [privy]);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  const edit = async (id?: string) => {
    if (!privy || !ws) return;
    if (!id) { setEditing(starter()); return; }
    const f = await getForm(privy, ws.id, id);
    if (f) setEditing(f);
  };

  const remove = async (f: FormRow) => {
    if (!privy || !ws) return;
    if (!await confirmDialog({ title: `Delete "${f.name}"?`, body: 'The public link stops working and its submissions are removed. Leads already created stay.', danger: true, confirmLabel: 'Delete' })) return;
    await deleteForm(privy, ws.id, f.id);
    setRows(await getForms(privy, ws.id));
  };

  const copyLink = (slug: string) => {
    navigator.clipboard?.writeText(`${origin}/f/${slug}`);
    setCopied(slug); setTimeout(() => setCopied(''), 1500);
  };

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 px-6 border-b border-subtle">
        <h1 className="text-md font-semibold text-primary">Forms</h1>
        <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{rows.length}</span>
        {canManage && (
          <button onClick={() => edit()} className="ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm">
            <Plus className="w-3.5 h-3.5" /> New form
          </button>
        )}
      </header>

      <div className="flex-1 overflow-auto p-6 2xl:p-8">
        <div className="max-w-5xl space-y-4">
          <p className="text-sm text-secondary -mt-1">Public forms for lead capture. Every submission becomes a person in your CRM, tagged with the form it came from.</p>

          {loading ? (
            <div className="h-32 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-subtle p-12 text-center">
              <FileInput className="w-8 h-8 text-tertiary mx-auto mb-3" />
              <h3 className="text-sm font-medium text-secondary">No forms yet</h3>
              <p className="text-xs text-tertiary mt-1">Build a contact or lead form and share its link anywhere.</p>
            </div>
          ) : (
            <div className="rounded-xl ring-1 ring-subtle bg-surface divide-y divide-subtle">
              {rows.map((f) => (
                <div key={f.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${f.enabled ? 'bg-success' : 'bg-tertiary'}`} title={f.enabled ? 'Live' : 'Off'} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-primary truncate">{f.name}</div>
                    <div className="text-xs text-tertiary truncate font-mono">/f/{f.slug}</div>
                  </div>
                  <button onClick={() => setViewing(f)} className="text-xs font-semibold text-secondary hover:text-primary inline-flex items-center gap-1"><Inbox className="w-3.5 h-3.5" /> {f.submissions}</button>
                  <button onClick={() => copyLink(f.slug)} title="Copy public link" className="p-1.5 rounded-md text-tertiary hover:text-accent hover:bg-surface-hover">{copied === f.slug ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}</button>
                  <a href={`${origin}/f/${f.slug}`} target="_blank" rel="noreferrer" title="Open" className="p-1.5 rounded-md text-tertiary hover:text-accent hover:bg-surface-hover"><ExternalLink className="w-4 h-4" /></a>
                  <button onClick={() => edit(f.id)} className="h-7 px-2.5 text-xs font-semibold rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-sunken">Edit</button>
                  <button onClick={() => remove(f)} aria-label="Delete" className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && ws && privy && (
        <Builder initial={editing} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); setRows(await getForms(privy, ws.id)); }}
          privy={privy} wsId={ws.id} notify={notify} />
      )}
      {viewing && ws && privy && (
        <Submissions form={viewing} privy={privy} wsId={ws.id} onClose={() => setViewing(null)} />
      )}
    </>
  );
}

function Builder({ initial, onClose, onSaved, privy, wsId, notify }: {
  initial: FormDetail; onClose: () => void; onSaved: () => void; privy: string; wsId: string; notify: (m: string) => void;
}) {
  const [f, setF] = useState<FormDetail>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (patch: Partial<FormDetail>) => setF((p) => ({ ...p, ...patch }));

  const addField = () => set({ fields: [...f.fields, { key: 'f_' + rnd(), label: 'New field', type: 'text', required: false, map: '' }] });
  const setField = (i: number, patch: Partial<FormField>) => set({ fields: f.fields.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) });
  const removeField = (i: number) => set({ fields: f.fields.filter((_, idx) => idx !== i) });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= f.fields.length) return;
    const arr = [...f.fields]; [arr[i], arr[j]] = [arr[j], arr[i]]; set({ fields: arr });
  };

  const submit = async () => {
    if (!f.fields.length) { setErr('Add at least one field.'); return; }
    setBusy(true); setErr('');
    const res = await saveForm(privy, wsId, f);
    setBusy(false);
    if (res.error) { setErr(res.error.replace(/_/g, ' ').toLowerCase()); return; }
    notify('Form saved.');
    onSaved();
  };

  const input = 'w-full h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[90vh] flex flex-col bg-surface rounded-xl ring-1 ring-subtle shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-subtle">
          <h3 className="text-sm font-semibold text-primary">{f.id ? 'Edit form' : 'New form'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-auto p-4 2xl:p-6 space-y-4">
          {err && <div className="rounded-lg bg-danger/10 ring-1 ring-danger/30 px-3 py-2 text-xs text-danger">{err}</div>}

          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="block text-xs font-semibold text-secondary mb-1">Internal name</span>
              <input value={f.name} onChange={(e) => set({ name: e.target.value })} className={input} /></label>
            <label className="flex items-end gap-2 pb-1"><input type="checkbox" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="rounded border-subtle accent-accent" /><span className="text-sm text-secondary">Live (accepting submissions)</span></label>
          </div>
          <label className="block"><span className="block text-xs font-semibold text-secondary mb-1">Public heading</span>
            <input value={f.title} onChange={(e) => set({ title: e.target.value })} className={input} /></label>
          <label className="block"><span className="block text-xs font-semibold text-secondary mb-1">Description</span>
            <textarea value={f.description} onChange={(e) => set({ description: e.target.value })} rows={2} className={input + ' h-auto py-2 resize-y'} /></label>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-secondary">Fields</span>
              <button onClick={addField} className="text-xs font-semibold text-accent hover:underline">+ Add field</button>
            </div>
            <div className="space-y-2">
              {f.fields.map((fld, i) => (
                <div key={fld.key} className="rounded-lg ring-1 ring-subtle bg-surface-sunken p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col text-tertiary">
                      <button onClick={() => move(i, -1)} className="hover:text-primary leading-none text-3xs">▲</button>
                      <button onClick={() => move(i, 1)} className="hover:text-primary leading-none text-3xs">▼</button>
                    </div>
                    <input value={fld.label} onChange={(e) => setField(i, { label: e.target.value })} placeholder="Label" className={input + ' flex-1'} />
                    <button onClick={() => removeField(i)} className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div className="flex items-center gap-2 pl-6">
                    <select value={fld.type} onChange={(e) => setField(i, { type: e.target.value as FieldType })} className={input + ' flex-1'}>
                      {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                    </select>
                    <select value={fld.map || ''} onChange={(e) => setField(i, { map: e.target.value as FieldMap })} className={input + ' flex-1'} title="Where this answer is stored on the lead">
                      {MAPS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
                    </select>
                    <label className="flex items-center gap-1.5 text-xs text-secondary shrink-0"><input type="checkbox" checked={!!fld.required} onChange={(e) => setField(i, { required: e.target.checked })} className="rounded border-subtle accent-accent" /> Req</label>
                  </div>
                  {fld.type === 'select' && (
                    <input value={(fld.options || []).join(', ')} onChange={(e) => setField(i, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })}
                      placeholder="Option A, Option B, Option C" className={input + ' ml-6 !w-[calc(100%-1.5rem)]'} />
                  )}
                </div>
              ))}
            </div>
          </div>

          <label className="block"><span className="block text-xs font-semibold text-secondary mb-1">Confirmation message</span>
            <input value={f.submit_message} onChange={(e) => set({ submit_message: e.target.value })} className={input} /></label>
        </div>

        <div className="h-14 shrink-0 flex items-center justify-end gap-2 px-4 border-t border-subtle">
          <button onClick={onClose} className="h-8 px-3 rounded-md text-sm font-medium text-secondary hover:bg-surface-hover">Cancel</button>
          <button onClick={submit} disabled={busy} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-50">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save form
          </button>
        </div>
      </div>
    </div>
  );
}

function Submissions({ form, privy, wsId, onClose }: { form: FormRow; privy: string; wsId: string; onClose: () => void }) {
  const [rows, setRows] = useState<FormSubmission[] | null>(null);
  useEffect(() => { getFormSubmissions(privy, wsId, form.id).then(setRows); }, [privy, wsId, form.id]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-end bg-black/50 backdrop-blur-[2px]" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-surface ring-1 ring-subtle shadow-popover flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-subtle">
          <h3 className="text-sm font-semibold text-primary truncate">Submissions · {form.name}</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-auto p-4 2xl:p-6 space-y-3">
          {rows === null ? (
            <div className="h-24 flex items-center justify-center text-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-tertiary text-center py-8">No submissions yet. Share <span className="font-mono">/f/{form.slug}</span>.</p>
          ) : rows.map((s) => (
            <div key={s.id} className="rounded-lg ring-1 ring-subtle bg-surface-sunken p-3">
              <div className="text-2xs text-tertiary mb-1.5">{new Date(s.created_at).toLocaleString()}</div>
              <dl className="space-y-1">
                {Object.entries(s.data).map(([k, v]) => (
                  <div key={k} className="flex gap-2 text-xs">
                    <dt className="text-tertiary shrink-0 min-w-[90px] truncate">{k}</dt>
                    <dd className="text-primary break-words">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
