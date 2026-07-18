'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Zap, Plus, Loader2, X, Trash2, Webhook, Mail, FilePlus, PencilLine, Bolt, Radio, Clock, Copy, Check, ArrowRight, List, Workflow, Sparkles } from 'lucide-react';
import AutomationFlow from '@/components/crm/AutomationFlow';
import {
  loadAutomations, saveAutomation, setAutomationEnabled, deleteAutomation, loadAutomationRuns, loadConnections, webhookUrl, TEMPLATES,
  type Automation, type AutomationRun, type Connection, type Condition, type Action, type TriggerType,
} from '@/lib/crm/automations';
import { useDialog } from '@/components/ui/Dialog';

const OBJECTS = ['companies', 'people', 'invoices', 'expenses', 'transactions', 'products', 'campaigns', 'projects', 'issues', 'assets'];
const OPS = [{ v: 'eq', l: 'equals' }, { v: 'neq', l: 'is not' }, { v: 'contains', l: 'contains' }, { v: 'gt', l: '>' }, { v: 'lt', l: '<' }, { v: 'not_empty', l: 'is set' }, { v: 'empty', l: 'is empty' }];
const ACTION_TYPES = [
  { v: 'ask_ai', l: 'Ask AI', icon: Sparkles },
  { v: 'send_webhook', l: 'Send webhook', icon: Webhook },
  { v: 'send_email', l: 'Send email', icon: Mail },
  { v: 'create_record', l: 'Create record', icon: FilePlus },
  { v: 'update_record', l: 'Update this record', icon: PencilLine },
];
const TRIGGERS: { v: TriggerType; l: string; icon: any; hint: string }[] = [
  { v: 'event', l: 'Record event', icon: Bolt, hint: 'When a record is created or updated' },
  { v: 'webhook', l: 'Incoming webhook', icon: Radio, hint: 'When an external tool POSTs to a URL' },
  { v: 'schedule', l: 'Schedule', icon: Clock, hint: 'On a repeating timer' },
];
const actionIcon = (t: string) => ACTION_TYPES.find((a) => a.v === t)?.icon || Zap;
const triggerIcon = (t: string) => TRIGGERS.find((x) => x.v === t)?.icon || Bolt;

const blank = (): Automation => ({ id: '', name: '', enabled: true, trigger_type: 'event', object: 'companies', event: 'created', conditions: [], actions: [{ type: 'send_webhook', config: {} }] });

// Deep-copy for editing, rebuilding the JSON textarea text (_data) from the
// stored action data so re-opened create/update actions aren't shown empty.
const forEditing = (a: Automation): Automation => {
  const copy: Automation = JSON.parse(JSON.stringify(a));
  for (const ac of copy.actions || []) {
    if ((ac.type === 'create_record' || ac.type === 'update_record') && ac.config?.data && !ac.config._data) {
      ac.config._data = JSON.stringify(ac.config.data, null, 2);
    }
  }
  return copy;
};
const fmtWhen = (s: string) => new Date(s).toLocaleString('en', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function AutomationsPage() {
  const { confirm: confirmDialog } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const canEdit = !!privy;

  const [rows, setRows] = useState<Automation[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [view, setView] = useState<'board' | 'list'>('board');

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
    if (!privy || !await confirmDialog(`Delete "${a.name || 'this automation'}"?`)) return;
    await deleteAutomation(privy, a.id); reload();
  };
  const fromTemplate = (t: Partial<Automation>) => setEditing(forEditing({ ...blank(), ...t } as Automation));

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-subtle">
        <h1 className="text-sm font-semibold text-primary flex items-center gap-2"><Zap className="w-4 h-4 text-amber-500" /> Automations</h1>
        <span className="text-[11px] font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{rows.length}</span>
        <span className={`text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{live ? 'Live' : 'Sample'}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-hover ring-1 ring-subtle">
            {([['board', Workflow, 'Board'], ['list', List, 'List']] as const).map(([v, Icon, label]) => (
              <button key={v} onClick={() => setView(v)}
                className={`h-6 px-2 inline-flex items-center gap-1 rounded-md text-[11px] font-semibold transition-colors ${view === v ? 'bg-surface text-primary shadow-sm' : 'text-tertiary hover:text-secondary'}`}>
                <Icon className="w-3 h-3" /> {label}
              </button>
            ))}
          </div>
          <button onClick={() => setEditing(blank())} disabled={!canEdit} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-semibold text-white bg-accent hover:bg-accent/90 shadow-sm disabled:opacity-40" title={!canEdit ? 'Sign in to add' : ''}>
            <Plus className="w-3.5 h-3.5" /> New automation
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Templates */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-tertiary mb-2">Start from a template</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {TEMPLATES.map((t) => (
                <button key={t.key} onClick={() => fromTemplate(t.automation)} disabled={!canEdit}
                  className="group text-left rounded-xl bg-surface ring-1 ring-subtle p-3 hover:ring-strong hover:shadow-sm transition-all disabled:opacity-50">
                  <div className={`inline-flex text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md mb-1.5 ${t.tone}`}>{t.name}</div>
                  <p className="text-[12px] text-secondary leading-snug">{t.desc}</p>
                  <span className="mt-1.5 inline-flex items-center gap-0.5 text-[11px] font-semibold text-accent opacity-0 group-hover:opacity-100 transition-opacity">Use template <ArrowRight className="w-3 h-3" /></span>
                </button>
              ))}
            </div>
          </div>

          {/* Rules */}
          {loading ? (
            <div className="h-24 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl ring-1 ring-subtle bg-surface px-6 py-10 text-center">
              <Zap className="w-8 h-8 text-tertiary mx-auto mb-2" />
              <p className="text-[13px] text-secondary">No automations yet — pick a template above or build one.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {rows.map((a) => { const TI = triggerIcon(a.trigger_type); return (
                <div key={a.id} className={`rounded-xl bg-surface ring-1 ring-subtle p-4 ${a.enabled ? '' : 'opacity-60'}`}>
                  <div className="flex items-center gap-3">
                    <button onClick={() => toggle(a)} disabled={!canEdit || !live} title={live ? 'Enable / disable' : 'Sign in'}
                      className={`w-9 h-5 rounded-full shrink-0 relative transition-colors ${a.enabled ? 'bg-success' : 'bg-strong'} disabled:opacity-50`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-surface shadow transition-all ${a.enabled ? 'left-4' : 'left-0.5'}`} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold text-primary truncate flex items-center gap-1.5"><TI className="w-3.5 h-3.5 text-tertiary" /> {a.name || 'Untitled automation'}</div>
                      <div className="text-[12px] text-secondary truncate">
                        {a.trigger_type === 'webhook' ? <>On <b className="text-secondary">incoming webhook</b></>
                          : a.trigger_type === 'schedule' ? <>Every <b className="text-secondary">{a.schedule?.every || 'day'}</b></>
                          : <>When <b className="text-secondary capitalize">{a.object}</b> is <b className="text-secondary">{a.event}</b></>}
                        {a.conditions.length > 0 && <> · {a.conditions.length} filter{a.conditions.length > 1 ? 's' : ''}</>}
                        {' → '}{(a.actions || []).map((ac) => ACTION_TYPES.find((t) => t.v === ac.type)?.l || ac.type).join(', ') || 'no action'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(a.actions || []).slice(0, 3).map((ac, i) => { const I = actionIcon(ac.type); return <I key={i} className="w-3.5 h-3.5 text-tertiary" />; })}
                      <button onClick={() => setEditing(forEditing(a))} disabled={!canEdit} className="ml-1 h-7 px-2.5 text-[12px] font-semibold rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-sunken disabled:opacity-40">Edit</button>
                      <button onClick={() => remove(a)} disabled={!canEdit} className="p-1.5 rounded-md text-tertiary hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                  {view === 'board' && <AutomationFlow automation={a} onEdit={canEdit ? () => setEditing(forEditing(a)) : undefined} />}
                  {a.trigger_type === 'webhook' && a.webhook_token && <WebhookUrl token={a.webhook_token} />}
                </div>
              ); })}
            </div>
          )}

          {/* Run log */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-tertiary mb-2">Recent runs</div>
            <div className="rounded-xl bg-surface ring-1 ring-subtle overflow-hidden">
              {runs.length === 0 ? <div className="px-5 py-8 text-center text-[13px] text-tertiary">No runs yet.</div>
                : runs.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-4 h-11 border-b border-subtle last:border-0 text-[12px]">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.status === 'ok' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    <span className="font-semibold text-secondary truncate">{r.automation_name || '—'}</span>
                    <span className="text-tertiary truncate">{r.detail}</span>
                    <span className="ml-auto text-tertiary tabular-nums shrink-0">{fmtWhen(r.created_at)}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      {editing && <Builder automation={editing} privy={privy} connections={connections} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function WebhookUrl({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = webhookUrl(token);
  return (
    <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-surface-sunken ring-1 ring-subtle px-2.5 py-1.5">
      <Radio className="w-3.5 h-3.5 text-tertiary shrink-0" />
      <code className="flex-1 text-[11px] font-mono text-secondary truncate">{url}</code>
      <button onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
        className="h-6 px-2 rounded-md text-[11px] font-semibold text-secondary ring-1 ring-subtle hover:bg-surface inline-flex items-center gap-1">{copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Copy</button>
    </div>
  );
}

// ── Step builder (Activepieces-style vertical flow) ───────────────────────────
function Builder({ automation, privy, connections, onClose, onSaved }: {
  automation: Automation; privy: string | null; connections: Connection[]; onClose: () => void; onSaved: () => void;
}) {
  const [a, setA] = useState<Automation>(automation);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<Automation>) => setA((s) => ({ ...s, ...patch }));

  const setCond = (i: number, patch: Partial<Condition>) => set({ conditions: a.conditions.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const setAction = (i: number, patch: Partial<Action>) => set({ actions: a.actions.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const setCfg = (i: number, patch: Record<string, any>) => setAction(i, { config: { ...a.actions[i].config, ...patch } });

  const save = async () => {
    if (!privy) { setError('Sign in to save automations.'); return; }
    if (!a.name.trim()) { setError('Give the automation a name.'); return; }
    if (a.actions.length === 0) { setError('Add at least one action.'); return; }
    setSaving(true); setError('');
    const res = await saveAutomation(privy, a.id || null, { name: a.name, enabled: a.enabled, trigger_type: a.trigger_type, object: a.object, event: a.event, conditions: a.conditions, actions: a.actions, schedule: a.schedule });
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved();
  };

  const inputCls = 'w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-primary-500 outline-none';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] flex flex-col bg-surface rounded-xl ring-1 ring-subtle shadow-2xl animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-subtle">
          <input autoFocus value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="Automation name" className="flex-1 text-sm font-semibold text-primary outline-none placeholder:text-tertiary" />
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="relative pl-7">
            <div className="absolute left-[11px] top-3 bottom-3 w-px bg-slate-200" />

            {/* Trigger step */}
            <Step badge="1" label="Trigger" tone="bg-amber-500">
              <div className="grid grid-cols-3 gap-1.5 mb-3">
                {TRIGGERS.map((t) => (
                  <button key={t.v} onClick={() => set({ trigger_type: t.v })}
                    className={`flex flex-col items-center gap-1 rounded-lg px-1.5 py-2 text-[11px] font-semibold ring-1 transition-colors ${a.trigger_type === t.v ? 'bg-accent/10 ring-primary-300 text-accent' : 'ring-subtle text-secondary hover:bg-surface-sunken'}`}>
                    <t.icon className="w-4 h-4" /> {t.l}
                  </button>
                ))}
              </div>

              {a.trigger_type === 'event' && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <select value={a.object} onChange={(e) => set({ object: e.target.value })} className={inputCls + ' capitalize'}>{OBJECTS.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                    <select value={a.event} onChange={(e) => set({ event: e.target.value as any })} className={inputCls}><option value="created">is created</option><option value="updated">is updated</option></select>
                  </div>
                  {a.conditions.map((c, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-[11px] text-tertiary w-8 shrink-0">only if</span>
                      <input value={c.field} onChange={(e) => setCond(i, { field: e.target.value })} placeholder="field" className={inputCls + ' flex-1'} />
                      <select value={c.op} onChange={(e) => setCond(i, { op: e.target.value })} className={inputCls + ' w-24 shrink-0'}>{OPS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
                      {!['empty', 'not_empty'].includes(c.op) && <input value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} placeholder="value" className={inputCls + ' w-20 shrink-0'} />}
                      <button onClick={() => set({ conditions: a.conditions.filter((_, k) => k !== i) })} className="p-1 rounded text-tertiary hover:text-rose-600"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  <button onClick={() => set({ conditions: [...a.conditions, { field: '', op: 'eq', value: '' }] })} className="text-[12px] font-semibold text-accent hover:text-accent">+ Add filter</button>
                </div>
              )}
              {a.trigger_type === 'webhook' && (
                <div className="space-y-2">
                  <p className="text-[12px] text-secondary">Any tool can POST JSON to this automation’s URL to trigger it. Reference fields in actions with <code className="bg-surface-hover rounded px-1">{'{{field}}'}</code>.</p>
                  {a.webhook_token ? <WebhookUrl token={a.webhook_token} /> : <p className="text-[12px] text-amber-600 bg-amber-50 rounded-md px-2.5 py-1.5 ring-1 ring-amber-200/50">A unique URL is generated when you save.</p>}
                </div>
              )}
              {a.trigger_type === 'schedule' && (
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-secondary">Run every</span>
                  <select value={a.schedule?.every || 'day'} onChange={(e) => set({ schedule: { ...(a.schedule || {}), every: e.target.value as any } })} className={inputCls + ' w-28'}>
                    <option value="minute">minute</option><option value="hour">hour</option><option value="day">day</option>
                  </select>
                </div>
              )}
            </Step>

            {/* Action steps */}
            {a.actions.map((ac, i) => (
              <Step key={i} badge={String(i + 2)} label={`Action ${i + 1}`} tone="bg-accent">
                <div className="flex items-center gap-2 mb-2">
                  <select value={ac.type} onChange={(e) => setAction(i, { type: e.target.value, config: {} })} className={inputCls + ' flex-1'}>{ACTION_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</select>
                  <button onClick={() => set({ actions: a.actions.filter((_, k) => k !== i) })} className="p-1.5 rounded-md text-tertiary hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                {ac.type === 'ask_ai' && (
                  <div className="space-y-1.5">
                    <textarea value={ac.config.prompt || ''} onChange={(e) => setCfg(i, { prompt: e.target.value })} rows={3}
                      placeholder="Write a two-sentence brief on {{first_name}} {{last_name}} for the team"
                      className="w-full px-2.5 py-2 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-primary-500 outline-none" />
                    <p className="text-[11px] text-tertiary">Runs on your workspace AI key (Settings → AI keys). The answer becomes <code className="bg-surface-hover rounded px-1">{'{{ai_output}}'}</code> in every action below this one.</p>
                  </div>
                )}
                {ac.type === 'send_webhook' && (
                  <select value={ac.config.connection_id || ''} onChange={(e) => setCfg(i, { connection_id: e.target.value, label: connections.find((c) => c.id === e.target.value)?.label })} className={inputCls}>
                    <option value="">— pick a connection (Integrations) —</option>
                    {connections.map((c) => <option key={c.id} value={c.id}>{c.label || c.url}</option>)}
                  </select>
                )}
                {ac.type === 'send_email' && (
                  <div className="space-y-2">
                    <input value={ac.config.to || ''} onChange={(e) => setCfg(i, { to: e.target.value })} placeholder="to ({{email}})" className={inputCls} />
                    <input value={ac.config.subject || ''} onChange={(e) => setCfg(i, { subject: e.target.value })} placeholder="Subject" className={inputCls} />
                    <textarea value={ac.config.body || ''} onChange={(e) => setCfg(i, { body: e.target.value })} rows={3} placeholder="Body — use {{field}}" className="w-full px-2.5 py-2 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-primary-500 outline-none" />
                  </div>
                )}
                {ac.type === 'create_record' && (
                  <div className="space-y-2">
                    <select value={ac.config.object || 'invoices'} onChange={(e) => setCfg(i, { object: e.target.value })} className={inputCls + ' capitalize'}>{OBJECTS.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                    <textarea value={ac.config._data || ''} onChange={(e) => setCfg(i, { _data: e.target.value, data: safeJson(e.target.value) })} rows={3} placeholder='{"number":"INV-{{id}}"}' className="w-full px-2.5 py-2 text-[12px] font-mono rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-primary-500 outline-none" />
                  </div>
                )}
                {ac.type === 'update_record' && (
                  <textarea value={ac.config._data || ''} onChange={(e) => setCfg(i, { _data: e.target.value, data: safeJson(e.target.value) })} rows={2} placeholder='{"status":"paid"}' className="w-full px-2.5 py-2 text-[12px] font-mono rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-primary-500 outline-none" />
                )}
              </Step>
            ))}

            <div className="relative">
              <span className="absolute -left-[22px] top-1 w-3 h-3 rounded-full bg-surface ring-2 ring-strong" />
              <button onClick={() => set({ actions: [...a.actions, { type: 'send_webhook', config: {} }] })} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[12px] font-semibold text-accent ring-1 ring-dashed ring-primary-300 bg-accent/10 hover:bg-accent/10"><Plus className="w-3.5 h-3.5" /> Add action</button>
            </div>
          </div>
          {error && <p className="mt-3 text-[12px] text-rose-600">{error}</p>}
        </div>

        <div className="shrink-0 flex items-center justify-between gap-2 p-3 border-t border-subtle">
          <label className="flex items-center gap-1.5 text-[12px] font-medium text-secondary"><input type="checkbox" checked={a.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="rounded border-subtle accent-accent" /> Enabled</label>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="h-8 px-3 rounded-md text-[13px] font-medium text-secondary hover:bg-surface-hover">Cancel</button>
            <button onClick={save} disabled={saving} className="h-8 px-3 rounded-md text-[13px] font-semibold text-white bg-accent hover:bg-accent/90 inline-flex items-center gap-1.5 disabled:opacity-50">{saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({ badge, label, tone, children }: { badge: string; label: string; tone: string; children: React.ReactNode }) {
  return (
    <div className="relative pb-4">
      <span className={`absolute -left-[22px] top-0 w-6 h-6 -translate-x-0 rounded-full ${tone} text-white text-[11px] font-semibold flex items-center justify-center ring-4 ring-white`}>{badge}</span>
      <div className="rounded-xl ring-1 ring-subtle bg-surface p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-tertiary mb-2">{label}</div>
        {children}
      </div>
    </div>
  );
}

function safeJson(s: string): Record<string, any> {
  try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}
