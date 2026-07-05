'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Zap, Plus, Loader2, X, Trash2, Webhook, Mail, FilePlus, PencilLine, Power } from 'lucide-react';
import {
  loadAutomations, saveAutomation, setAutomationEnabled, deleteAutomation, loadAutomationRuns, loadConnections,
  type Automation, type AutomationRun, type Connection, type Condition, type Action,
} from '@/lib/crm/automations';

const OBJECTS = ['companies', 'people', 'invoices', 'expenses', 'transactions', 'products', 'campaigns', 'projects', 'issues'];
const OPS: { v: string; l: string }[] = [
  { v: 'eq', l: 'equals' }, { v: 'neq', l: 'is not' }, { v: 'contains', l: 'contains' },
  { v: 'gt', l: '>' }, { v: 'lt', l: '<' }, { v: 'not_empty', l: 'is set' }, { v: 'empty', l: 'is empty' },
];
const ACTION_TYPES: { v: string; l: string; icon: any }[] = [
  { v: 'send_webhook', l: 'Send webhook', icon: Webhook },
  { v: 'send_email', l: 'Send email', icon: Mail },
  { v: 'create_record', l: 'Create record', icon: FilePlus },
  { v: 'update_record', l: 'Update this record', icon: PencilLine },
];
const actionIcon = (t: string) => ACTION_TYPES.find((a) => a.v === t)?.icon || Zap;

const blank = (): Automation => ({ id: '', name: '', enabled: true, object: 'companies', event: 'created', conditions: [], actions: [{ type: 'send_webhook', config: {} }] });
const fmtWhen = (s: string) => new Date(s).toLocaleString('en', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function AutomationsPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const canEdit = !!privy;

  const [rows, setRows] = useState<Automation[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Automation | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([loadAutomations(privy), loadAutomationRuns(privy), loadConnections(privy)]).then(([a, r, c]) => {
      setRows(a.rows); setLive(a.live); setRuns(r.rows); setConnections(c.rows); setLoading(false);
    });
  }, [privy]);
  useEffect(() => { if (ready) reload(); }, [ready, reload]);

  const toggle = async (a: Automation) => {
    if (!privy) return;
    setRows((rs) => rs.map((r) => (r.id === a.id ? { ...r, enabled: !r.enabled } : r)));
    await setAutomationEnabled(privy, a.id, !a.enabled);
  };
  const remove = async (a: Automation) => {
    if (!privy || !confirm(`Delete "${a.name || 'this automation'}"?`)) return;
    await deleteAutomation(privy, a.id); reload();
  };

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200/70">
        <h1 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Zap className="w-4 h-4 text-amber-500" /> Automations</h1>
        <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 rounded-md px-1.5 py-0.5 tabular-nums">{rows.length}</span>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{live ? 'Live' : 'Sample'}</span>
        <button onClick={() => setEditing(blank())} disabled={!canEdit}
          className="ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 shadow-sm disabled:opacity-40" title={!canEdit ? 'Sign in to add' : ''}>
          <Plus className="w-3.5 h-3.5" /> New automation
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <p className="text-[13px] text-slate-500 -mt-1">When something happens in your workspace, run an action — notify Slack/Zapier, email someone, or create a record. Rule-based, runs in Postgres.</p>

          {loading ? (
            <div className="h-32 flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl ring-1 ring-slate-200/60 bg-white px-6 py-12 text-center">
              <Zap className="w-9 h-9 text-slate-300 mx-auto mb-3" />
              <p className="text-[13px] text-slate-500 mb-3">No automations yet.</p>
              <button onClick={() => setEditing(blank())} disabled={!canEdit} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-40">Create your first</button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {rows.map((a) => (
                <div key={a.id} className={`rounded-xl bg-white ring-1 ring-slate-200/60 p-4 ${a.enabled ? '' : 'opacity-60'}`}>
                  <div className="flex items-center gap-3">
                    <button onClick={() => toggle(a)} disabled={!canEdit || !live} title={live ? 'Enable / disable' : 'Sign in'}
                      className={`w-9 h-5 rounded-full shrink-0 relative transition-colors ${a.enabled ? 'bg-emerald-500' : 'bg-slate-300'} disabled:opacity-50`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${a.enabled ? 'left-4' : 'left-0.5'}`} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-bold text-slate-800 truncate">{a.name || 'Untitled automation'}</div>
                      <div className="text-[12px] text-slate-500 truncate">
                        When <b className="text-slate-600 capitalize">{a.object}</b> is <b className="text-slate-600">{a.event}</b>
                        {a.conditions.length > 0 && <> and {a.conditions.length} condition{a.conditions.length > 1 ? 's' : ''}</>}
                        {' → '}
                        {(a.actions || []).map((ac) => ACTION_TYPES.find((t) => t.v === ac.type)?.l || ac.type).join(', ') || 'no action'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(a.actions || []).slice(0, 3).map((ac, i) => { const I = actionIcon(ac.type); return <I key={i} className="w-3.5 h-3.5 text-slate-400" />; })}
                      <button onClick={() => setEditing(JSON.parse(JSON.stringify(a)))} disabled={!canEdit} className="ml-1 h-7 px-2.5 text-[12px] font-semibold rounded-md ring-1 ring-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">Edit</button>
                      <button onClick={() => remove(a)} disabled={!canEdit} className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Run log */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Recent runs</div>
            <div className="rounded-xl bg-white ring-1 ring-slate-200/60 overflow-hidden">
              {runs.length === 0 ? (
                <div className="px-5 py-8 text-center text-[13px] text-slate-400">No runs yet.</div>
              ) : runs.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 h-11 border-b border-slate-100 last:border-0 text-[12px]">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.status === 'ok' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  <span className="font-semibold text-slate-700 truncate">{r.automation_name || '—'}</span>
                  <span className="text-slate-400 truncate">{r.detail}</span>
                  <span className="ml-auto text-slate-400 tabular-nums shrink-0">{fmtWhen(r.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {editing && (
        <Builder automation={editing} privy={privy} connections={connections}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </>
  );
}

// ── Builder modal ─────────────────────────────────────────────────────────────
function Builder({ automation, privy, connections, onClose, onSaved }: {
  automation: Automation; privy: string | null; connections: Connection[]; onClose: () => void; onSaved: () => void;
}) {
  const [a, setA] = useState<Automation>(automation);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<Automation>) => setA((s) => ({ ...s, ...patch }));

  const addCond = () => set({ conditions: [...a.conditions, { field: '', op: 'eq', value: '' }] });
  const setCond = (i: number, patch: Partial<Condition>) => set({ conditions: a.conditions.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const delCond = (i: number) => set({ conditions: a.conditions.filter((_, k) => k !== i) });

  const addAction = () => set({ actions: [...a.actions, { type: 'send_webhook', config: {} }] });
  const setAction = (i: number, patch: Partial<Action>) => set({ actions: a.actions.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const setCfg = (i: number, patch: Record<string, any>) => setAction(i, { config: { ...a.actions[i].config, ...patch } });
  const delAction = (i: number) => set({ actions: a.actions.filter((_, k) => k !== i) });

  const save = async () => {
    if (!privy) { setError('Sign in to save automations.'); return; }
    if (!a.name.trim()) { setError('Give the automation a name.'); return; }
    if (a.actions.length === 0) { setError('Add at least one action.'); return; }
    setSaving(true); setError('');
    const res = await saveAutomation(privy, a.id || null, { name: a.name, enabled: a.enabled, object: a.object, event: a.event, conditions: a.conditions, actions: a.actions });
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved();
  };

  const inputCls = 'w-full h-9 px-2.5 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[88vh] flex flex-col bg-white rounded-xl ring-1 ring-slate-200/70 shadow-2xl animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-slate-200/70">
          <h2 className="text-sm font-bold text-slate-800">{a.id ? 'Edit automation' : 'New automation'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <label className="block">
            <span className="block text-[12px] font-semibold text-slate-600 mb-1">Name</span>
            <input autoFocus value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="Won deal → notify Slack" className={inputCls} />
          </label>

          {/* Trigger */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">When…</div>
            <div className="grid grid-cols-2 gap-2">
              <select value={a.object} onChange={(e) => set({ object: e.target.value })} className={inputCls + ' capitalize'}>
                {OBJECTS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <select value={a.event} onChange={(e) => set({ event: e.target.value as any })} className={inputCls}>
                <option value="created">is created</option>
                <option value="updated">is updated</option>
              </select>
            </div>
            {/* Conditions */}
            <div className="mt-2 space-y-2">
              {a.conditions.map((c, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 w-8 shrink-0">{i === 0 ? 'and' : 'and'}</span>
                  <input value={c.field} onChange={(e) => setCond(i, { field: e.target.value })} placeholder="field" className={inputCls + ' flex-1'} />
                  <select value={c.op} onChange={(e) => setCond(i, { op: e.target.value })} className={inputCls + ' w-24 shrink-0'}>{OPS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
                  {!['empty', 'not_empty'].includes(c.op) && <input value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} placeholder="value" className={inputCls + ' w-24 shrink-0'} />}
                  <button onClick={() => delCond(i)} className="p-1.5 rounded-md text-slate-300 hover:text-rose-600"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <button onClick={addCond} className="text-[12px] font-semibold text-primary-600 hover:text-primary-700">+ Add condition</button>
            </div>
          </div>

          {/* Actions */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Then…</div>
            <div className="space-y-3">
              {a.actions.map((ac, i) => (
                <div key={i} className="rounded-lg ring-1 ring-slate-200/70 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <select value={ac.type} onChange={(e) => setAction(i, { type: e.target.value, config: {} })} className={inputCls + ' flex-1'}>
                      {ACTION_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                    </select>
                    <button onClick={() => delAction(i)} className="p-1.5 rounded-md text-slate-300 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  {ac.type === 'send_webhook' && (
                    <div className="space-y-2">
                      <select value={ac.config.connection_id || ''} onChange={(e) => setCfg(i, { connection_id: e.target.value, label: connections.find((c) => c.id === e.target.value)?.label })} className={inputCls}>
                        <option value="">— pick a connection —</option>
                        {connections.map((c) => <option key={c.id} value={c.id}>{c.label || c.url}</option>)}
                      </select>
                      <p className="text-[11px] text-slate-400">Manage webhook URLs under <b>Integrations</b>. HireBTR POSTs the record as JSON.</p>
                    </div>
                  )}
                  {ac.type === 'send_email' && (
                    <div className="space-y-2">
                      <input value={ac.config.to || ''} onChange={(e) => setCfg(i, { to: e.target.value })} placeholder="to (email or {{email}})" className={inputCls} />
                      <input value={ac.config.subject || ''} onChange={(e) => setCfg(i, { subject: e.target.value })} placeholder="Subject" className={inputCls} />
                      <textarea value={ac.config.body || ''} onChange={(e) => setCfg(i, { body: e.target.value })} rows={3} placeholder="Body — use {{field}} to insert record values" className="w-full px-2.5 py-2 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
                    </div>
                  )}
                  {ac.type === 'create_record' && (
                    <div className="space-y-2">
                      <select value={ac.config.object || 'invoices'} onChange={(e) => setCfg(i, { object: e.target.value })} className={inputCls + ' capitalize'}>{OBJECTS.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                      <textarea value={ac.config._data || ''} onChange={(e) => setCfg(i, { _data: e.target.value, data: safeJson(e.target.value) })} rows={3} placeholder='{"number":"INV-{{id}}","amount":"0"}' className="w-full px-2.5 py-2 text-[12px] font-mono rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
                    </div>
                  )}
                  {ac.type === 'update_record' && (
                    <textarea value={ac.config._data || ''} onChange={(e) => setCfg(i, { _data: e.target.value, data: safeJson(e.target.value) })} rows={2} placeholder='{"status":"paid"}' className="w-full px-2.5 py-2 text-[12px] font-mono rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
                  )}
                </div>
              ))}
              <button onClick={addAction} className="text-[12px] font-semibold text-primary-600 hover:text-primary-700">+ Add action</button>
            </div>
          </div>
          {error && <p className="text-[12px] text-rose-600">{error}</p>}
        </div>

        <div className="shrink-0 flex items-center justify-between gap-2 p-3 border-t border-slate-200/70">
          <label className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600"><Power className="w-3.5 h-3.5 text-slate-400" /><input type="checkbox" checked={a.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="rounded border-slate-300 accent-primary-600" /> Enabled</label>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="h-8 px-3 rounded-md text-[13px] font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
            <button onClick={save} disabled={saving} className="h-8 px-3 rounded-md text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-50">{saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function safeJson(s: string): Record<string, any> {
  try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}
