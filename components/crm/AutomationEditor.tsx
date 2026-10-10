'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  X, Plus, Trash2, Loader2, Zap, Clock, Radio, Mail, MessageCircle, Sparkles, Bot, FilePlus, PencilLine,
  StickyNote, Webhook, ChevronUp, ChevronDown, Check, AlertTriangle, MinusCircle, Play,
} from 'lucide-react';
import {
  TRIGGER_OBJECTS, OPS, ACTIONS, CREATABLE, createFields, WEEKDAYS, actionLabel,
  type TriggerObject, type FieldOption, type Schedule,
} from '@/lib/automations/vocab';
import { saveAutomation, testAutomation, webhookUrl, type Automation, type Action, type Condition, type Connection, type TestResult } from '@/lib/crm/automations';
import { OBJECTS } from '@/lib/crm/registry';

/**
 * The automation editor — built to be read as a sentence.
 *
 * WHEN something happens / on a schedule / another app sends data, ONLY IF the
 * conditions hold, THEN do these steps in order. The old editor asked for raw
 * column names and JSON ({"status":"paid"}); every field here is a picker over
 * the trigger's real fields, every value that has a fixed set of options is a
 * dropdown, and every text box offers its variables as chips. Saving goes
 * through save_automation (0132), which re-validates all of it in SQL.
 *
 * "Changes to" is the condition people mean nine times out of ten ("when an
 * invoice BECOMES paid") and is offered first for updates; "is" fires on every
 * later edit of a matching record, which is rarely what anybody wants.
 */

const ICONS: Record<string, any> = {
  send_email: Mail, post_to_chat: MessageCircle, ask_ai: Sparkles, run_agent: Bot,
  create_record: FilePlus, update_record: PencilLine, add_note: StickyNote, send_webhook: Webhook,
};

export interface EditorDeps {
  connections: Connection[];
  channels: { id: string; name: string }[];
  agents: { id: string; name: string; role?: string }[];
  customObjects: TriggerObject[];
}

export default function AutomationEditor({ automation, privy, deps, onClose, onSaved }: {
  automation: Automation; privy: string | null; deps: EditorDeps;
  onClose: () => void; onSaved: (id: string) => void;
}) {
  const [a, setA] = useState<Automation>(automation);
  const [saving, setSaving] = useState<'' | 'save' | 'test'>('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<{ list: TestResult[]; sample?: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  const set = (patch: Partial<Automation>) => { setA((s) => ({ ...s, ...patch })); setResults(null); };

  const objects = useMemo(() => [...TRIGGER_OBJECTS, ...deps.customObjects], [deps.customObjects]);
  const obj = objects.find((o) => o.slug === a.object);
  const isEvent = a.trigger_type === 'event';
  const isUpdate = isEvent && a.event === 'updated';

  // Variables a text box may use: the trigger's fields, plus what earlier steps produce.
  const varsBefore = (i: number): FieldOption[] => {
    const base: FieldOption[] = isEvent ? (obj?.fields || []) : a.trigger_type === 'schedule'
      ? [{ key: 'now', label: 'Now' }] : [];
    const produced: FieldOption[] = [];
    a.actions.slice(0, i).forEach((s) => {
      if (s.type === 'ask_ai') produced.push({ key: 'ai_output', label: 'AI answer' });
      if (s.type === 'run_agent') produced.push({ key: 'agent_output', label: 'Agent answer' });
    });
    return [...base, ...produced];
  };

  const setCond = (i: number, patch: Partial<Condition>) => set({ conditions: a.conditions.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const setStep = (i: number, patch: Partial<Action>) => set({ actions: a.actions.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const setCfg = (i: number, patch: Record<string, any>) => setStep(i, { config: { ...a.actions[i].config, ...patch } });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= a.actions.length) return;
    const next = [...a.actions]; [next[i], next[j]] = [next[j], next[i]]; set({ actions: next });
  };

  const persist = async (): Promise<string | null> => {
    if (!privy) { setError('Sign in to save automations.'); return null; }
    if (!a.name.trim()) { setError('Give it a name.'); return null; }
    if (a.actions.length === 0) { setError('Add at least one step.'); return null; }
    const gap = a.actions.map((s, i) => { const m = missing(s); return m ? `Step ${i + 1}: ${m}` : ''; }).find(Boolean);
    if (gap) { setError(gap); return null; }
    const res = await saveAutomation(privy, a.id || null, {
      name: a.name, enabled: a.enabled, trigger_type: a.trigger_type, object: a.object, event: a.event,
      conditions: isEvent ? a.conditions.filter((c) => c.field) : [],
      actions: a.actions.map((s) => ({ type: s.type, config: clean(s.config) })),
      schedule: a.trigger_type === 'schedule' ? { ...(a.schedule || { every: 'day' }), tz: Intl.DateTimeFormat().resolvedOptions().timeZone } : null,
    });
    if (res.error) { setError(friendly(res.error)); return null; }
    if (res.id && !a.id) setA((s) => ({ ...s, id: res.id! }));
    return res.id || a.id;
  };

  const save = async () => {
    setSaving('save'); setError('');
    const id = await persist();
    setSaving('');
    if (id) onSaved(id);
  };
  const test = async () => {
    setSaving('test'); setError(''); setResults(null);
    const id = await persist();
    if (!id || !privy) { setSaving(''); return; }
    const r = await testAutomation(privy, id);
    setSaving('');
    if (r.error) { setError(r.error); return; }
    setResults({ list: r.results || [], sample: r.sample });
  };

  const input = 'max-w-full h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none';
  const area = 'w-full px-2.5 py-2 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none resize-y';
  const sched: Schedule = a.schedule || { every: 'day', at: '09:00' };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-3 sm:p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[92vh] flex flex-col bg-surface rounded-2xl ring-1 ring-subtle shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="h-14 shrink-0 flex items-center gap-2 px-5 border-b border-subtle">
          <Zap className="w-4 h-4 text-accent shrink-0" />
          <input autoFocus={!a.id} value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="Name this automation"
            aria-label="Name" className="flex-1 min-w-0 text-base font-medium text-primary bg-transparent outline-none placeholder:text-tertiary" />
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* ── WHEN ── */}
          <section>
            <h3 className="text-2xs font-semibold uppercase tracking-wider text-tertiary mb-2">When</h3>
            <div className="grid grid-cols-3 gap-1.5 mb-3">
              {([['event', Zap, 'Something happens'], ['schedule', Clock, 'On a schedule'], ['webhook', Radio, 'Another app sends data']] as const).map(([v, Icon, l]) => (
                <button key={v} onClick={() => set({ trigger_type: v, ...(v === 'event' ? { object: obj?.slug || 'deals', event: a.event === 'updated' ? 'updated' : 'created' } : { object: v, event: v, conditions: [] }) })}
                  className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 rounded-lg px-2 py-2 text-xs sm:text-sm leading-tight text-center ring-1 transition-colors ${a.trigger_type === v ? 'bg-accent/10 ring-accent/40 text-primary font-medium' : 'ring-subtle text-secondary hover:bg-surface-sunken'}`}>
                  <Icon className="w-4 h-4 shrink-0" /> <span>{l}</span>
                </button>
              ))}
            </div>

            {isEvent && (
              <div className="rounded-xl bg-surface-sunken/60 ring-1 ring-subtle p-3 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2 text-sm text-secondary">
                  <span>When</span>
                  <select value={a.object} onChange={(e) => {
                    const o = objects.find((x) => x.slug === e.target.value);
                    set({ object: e.target.value, event: o?.createdOnly ? 'created' : a.event, conditions: [] });
                  }} className={`${input}`} aria-label="Record type">
                    {groups(objects).map(([g, list]) => (
                      <optgroup key={g} label={g}>{list.map((o) => <option key={o.slug} value={o.slug}>{o.label}</option>)}</optgroup>
                    ))}
                  </select>
                  <span>{obj ? '' : ''}</span>
                  <select value={a.event} onChange={(e) => set({ event: e.target.value as any })} disabled={obj?.createdOnly}
                    className={`${input}`} aria-label="Event">
                    <option value="created">is added</option>
                    {!obj?.createdOnly && <option value="updated">is updated</option>}
                  </select>
                </div>

                {a.conditions.map((c, i) => {
                  const f = obj?.fields.find((x) => x.key === c.field);
                  const op = OPS.find((o) => o.v === c.op);
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-tertiary w-12 shrink-0">{i === 0 ? 'only if' : 'and'}</span>
                      <select value={c.field} onChange={(e) => setCond(i, { field: e.target.value, value: '' })} className={`${input} flex-1 min-w-[8rem]`} aria-label="Field">
                        <option value="">Pick a field…</option>
                        {(obj?.fields || []).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </select>
                      <select value={c.op} onChange={(e) => setCond(i, { op: e.target.value })} className={`${input}`} aria-label="Condition">
                        {OPS.filter((o) => isUpdate || !o.updatesOnly).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                      </select>
                      {op?.needsValue && (f?.options?.length
                        ? <select value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} className={`${input}`} aria-label="Value">
                            <option value="">…</option>{f.options.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                          </select>
                        : <input value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} placeholder="value" aria-label="Value"
                            type={f?.type === 'number' ? 'number' : f?.type === 'date' ? 'date' : 'text'} className={`${input} w-32`} />)}
                      <button onClick={() => set({ conditions: a.conditions.filter((_, k) => k !== i) })} aria-label="Remove condition"
                        className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  );
                })}
                <button onClick={() => set({ conditions: [...a.conditions, { field: '', op: isUpdate ? 'changed_to' : 'eq', value: '' }] })}
                  className="text-xs font-medium text-secondary hover:text-primary">+ Only when…</button>
                {isUpdate && a.conditions.length === 0 && (
                  <p className="text-2xs text-tertiary">Runs on every edit. Add “only if … changes to …” to run once, when it matters.</p>
                )}
              </div>
            )}

            {a.trigger_type === 'schedule' && (
              <div className="rounded-xl bg-surface-sunken/60 ring-1 ring-subtle p-3 flex flex-wrap items-center gap-2 text-sm text-secondary">
                <span>Every</span>
                <select value={sched.every} onChange={(e) => set({ schedule: { ...sched, every: e.target.value as any } })} className={`${input}`} aria-label="Repeat">
                  <option value="hour">hour</option><option value="day">day</option><option value="week">week</option><option value="minute">minute</option>
                </select>
                {sched.every === 'week' && (
                  <>
                    <span>on</span>
                    <select value={sched.day ?? 1} onChange={(e) => set({ schedule: { ...sched, day: Number(e.target.value) } })} className={`${input}`} aria-label="Weekday">
                      {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                    </select>
                  </>
                )}
                {(sched.every === 'day' || sched.every === 'week') && (
                  <>
                    <span>at</span>
                    <input type="time" value={sched.at || '09:00'} onChange={(e) => set({ schedule: { ...sched, at: e.target.value } })} className={`${input} w-28`} aria-label="Time" />
                    <span className="text-2xs text-tertiary">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
                  </>
                )}
              </div>
            )}

            {a.trigger_type === 'webhook' && (
              <div className="rounded-xl bg-surface-sunken/60 ring-1 ring-subtle p-3 space-y-2">
                <p className="text-sm text-secondary">Any tool — Zapier, Make, a form, a script — can POST JSON to this automation’s address. Each field arrives as <code className="bg-surface-hover rounded px-1">{'{{field}}'}</code>.</p>
                {a.webhook_token
                  ? <code className="block text-2xs font-mono bg-surface ring-1 ring-subtle rounded-md px-2.5 py-2 break-all">{webhookUrl(a.webhook_token)}</code>
                  : <p className="text-xs text-tertiary">The address appears when you save.</p>}
              </div>
            )}
          </section>

          {/* ── THEN ── */}
          <section>
            <h3 className="text-2xs font-semibold uppercase tracking-wider text-tertiary mb-2">Then</h3>
            <ol className="space-y-2.5">
              {a.actions.map((s, i) => {
                const Icon = ICONS[s.type] || Zap;
                const vars = varsBefore(i);
                const chips = (field: string) => <VarChips vars={vars} onPick={(k) => setCfg(i, { [field]: `${s.config[field] || ''}{{${k}}}` })} />;
                return (
                  <li key={i} className="rounded-xl ring-1 ring-subtle bg-surface p-3">
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="w-6 h-6 rounded-full bg-inverse text-inverse-fg text-2xs font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                      <Icon className="w-4 h-4 text-secondary shrink-0" />
                      <span className="text-sm font-medium text-primary flex-1 truncate">{actionLabel(s.type)}</span>
                      <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="p-1 rounded text-tertiary hover:text-primary disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
                      <button onClick={() => move(i, 1)} disabled={i === a.actions.length - 1} aria-label="Move down" className="p-1 rounded text-tertiary hover:text-primary disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
                      <button onClick={() => set({ actions: a.actions.filter((_, k) => k !== i) })} aria-label="Remove step" className="p-1 rounded text-tertiary hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>

                    {s.type === 'send_email' && (
                      <div className="space-y-2">
                        <input value={s.config.to || ''} onChange={(e) => setCfg(i, { to: e.target.value })} placeholder="To — you@company.com, or {{email}}" aria-label="To" className={`${input} w-full`} />
                        {chips('to')}
                        <input value={s.config.subject || ''} onChange={(e) => setCfg(i, { subject: e.target.value })} placeholder="Subject" aria-label="Subject" className={`${input} w-full`} />
                        <textarea value={s.config.body || ''} onChange={(e) => setCfg(i, { body: e.target.value })} rows={4} placeholder="Message" aria-label="Message" className={area} />
                        {chips('body')}
                      </div>
                    )}
                    {s.type === 'post_to_chat' && (
                      <div className="space-y-2">
                        <select value={s.config.channel_id || ''} onChange={(e) => setCfg(i, { channel_id: e.target.value })} className={`${input} w-full`} aria-label="Channel">
                          <option value="">Pick a channel…</option>
                          {deps.channels.map((c) => <option key={c.id} value={c.id}># {c.name}</option>)}
                        </select>
                        {deps.channels.length === 0 && <p className="text-2xs text-tertiary">No channels yet — <Link href="/chat" className="text-accent hover:underline">create one in Chat</Link>.</p>}
                        <textarea value={s.config.message || ''} onChange={(e) => setCfg(i, { message: e.target.value })} rows={2} placeholder="Message" aria-label="Message" className={area} />
                        {chips('message')}
                      </div>
                    )}
                    {s.type === 'ask_ai' && (
                      <div className="space-y-2">
                        <textarea value={s.config.prompt || ''} onChange={(e) => setCfg(i, { prompt: e.target.value })} rows={3}
                          placeholder="e.g. Classify this lead as hot, warm or cold and say why in one line." aria-label="Instruction" className={area} />
                        {chips('prompt')}
                        <p className="text-2xs text-tertiary">Uses the workspace AI key. The answer is <code className="bg-surface-hover rounded px-1">{'{{ai_output}}'}</code> in the steps below.</p>
                      </div>
                    )}
                    {s.type === 'run_agent' && (
                      <div className="space-y-2">
                        <select value={s.config.agent_id || ''} onChange={(e) => setCfg(i, { agent_id: e.target.value })} className={`${input} w-full`} aria-label="Agent">
                          <option value="">Pick an agent…</option>
                          {deps.agents.map((g) => <option key={g.id} value={g.id}>{g.name}{g.role ? ` — ${g.role}` : ''}</option>)}
                        </select>
                        {deps.agents.length === 0 && <p className="text-2xs text-tertiary">No agents yet — <Link href="/agents" className="text-accent hover:underline">hire one in Agents</Link>.</p>}
                        <textarea value={s.config.task || ''} onChange={(e) => setCfg(i, { task: e.target.value })} rows={3} placeholder="What should it do with this?" aria-label="Task" className={area} />
                        {chips('task')}
                        <p className="text-2xs text-tertiary">The agent gets the record too, and keeps its own tools and autonomy — on “suggest” it only proposes changes for you to approve. Business plan.</p>
                      </div>
                    )}
                    {s.type === 'create_record' && (
                      <CreateRecord cfg={s.config} vars={vars} input={input} onChange={(patch) => setCfg(i, patch)} />
                    )}
                    {s.type === 'update_record' && (
                      <FieldRows fields={obj?.fields || []} data={s.config.data || {}} vars={vars} input={input} onChange={(data) => setCfg(i, { data })} />
                    )}
                    {s.type === 'add_note' && (
                      <div className="space-y-2">
                        <textarea value={s.config.body || ''} onChange={(e) => setCfg(i, { body: e.target.value })} rows={2} placeholder="The note" aria-label="Note" className={area} />
                        {chips('body')}
                      </div>
                    )}
                    {s.type === 'send_webhook' && (
                      <div className="space-y-2">
                        <select value={s.config.connection_id || ''} onChange={(e) => setCfg(i, { connection_id: e.target.value, label: deps.connections.find((c) => c.id === e.target.value)?.label })} className={`${input} w-full`} aria-label="Connection">
                          <option value="">Pick a connected app…</option>
                          {deps.connections.map((c) => <option key={c.id} value={c.id}>{c.label || c.url}</option>)}
                        </select>
                        {deps.connections.length === 0 && <p className="text-2xs text-tertiary">Nothing connected yet — <Link href="/settings/connectors" className="text-accent hover:underline">connect Slack, Zapier or any URL</Link>.</p>}
                        <p className="text-2xs text-tertiary">Sends the whole record as signed JSON.</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>

            <div className="mt-2.5">
              {!adding ? (
                <button onClick={() => setAdding(true)} disabled={a.actions.length >= 10}
                  className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm text-secondary ring-1 ring-subtle hover:bg-surface-sunken disabled:opacity-40">
                  <Plus className="w-4 h-4" /> Add a step
                </button>
              ) : (
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {ACTIONS.filter((t) => !t.needsRecord || (isEvent && obj?.writable)).map((t) => {
                    const Icon = ICONS[t.v] || Zap;
                    return (
                      <button key={t.v} onClick={() => { set({ actions: [...a.actions, { type: t.v, config: t.v === 'create_record' ? { object: 'issues', data: {} } : {} }] }); setAdding(false); }}
                        className="text-left rounded-lg ring-1 ring-subtle px-3 py-2 hover:bg-surface-sunken flex gap-2.5">
                        <Icon className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
                        <span className="min-w-0">
                          <span className="block text-sm text-primary">{t.l}</span>
                          <span className="block text-2xs text-tertiary truncate">{t.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                  <button onClick={() => setAdding(false)} className="text-xs text-tertiary hover:text-secondary sm:col-span-2 text-left px-1">Cancel</button>
                </div>
              )}
            </div>
          </section>

          {results && (
            <section className="rounded-xl ring-1 ring-subtle bg-surface-sunken/60 p-3 space-y-1.5" aria-live="polite">
              <h3 className="text-sm font-medium text-primary">Test run</h3>
              {isEvent && !results.sample && <p className="text-2xs text-tertiary">There is no {obj?.one?.replace(/^an? /, '') || 'record'} yet, so it ran with an empty record.</p>}
              <TestList results={results.list} />
              <p className="text-2xs text-tertiary pt-1">Emails, chat posts, AI, agents and connected apps really ran. Creating or updating records was only simulated.</p>
            </section>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <div className="shrink-0 flex flex-wrap items-center gap-2 p-3 border-t border-subtle">
          <label className="flex items-center gap-1.5 text-sm text-secondary mr-auto">
            <input type="checkbox" checked={a.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="accent-accent" /> On
          </label>
          <button onClick={test} disabled={!!saving} title="Save, then run it once now against your latest record"
            className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm text-secondary ring-1 ring-subtle hover:bg-surface-hover disabled:opacity-40">
            {saving === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Test
          </button>
          <button onClick={onClose} className="h-9 px-3 rounded-lg text-sm text-secondary hover:bg-surface-hover">Cancel</button>
          <button onClick={save} disabled={!!saving} className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
            {saving === 'save' && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function TestList({ results }: { results: TestResult[] }) {
  if (!results.length) return <p className="text-xs text-tertiary">Nothing ran.</p>;
  return (
    <ul className="space-y-1">
      {results.map((r, i) => (
        <li key={i} className="flex items-start gap-2 text-xs">
          {r.skipped ? <MinusCircle className="w-3.5 h-3.5 text-tertiary shrink-0 mt-0.5" />
            : r.ok ? <Check className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
            : <AlertTriangle className="w-3.5 h-3.5 text-danger shrink-0 mt-0.5" />}
          <span className={r.ok || r.skipped ? 'text-secondary' : 'text-danger'}>
            <span className="font-medium">{r.action === 'filters' ? 'Filters' : actionLabel(r.action)}</span> — {r.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}

function VarChips({ vars, onPick }: { vars: FieldOption[]; onPick: (key: string) => void }) {
  if (!vars.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-3xs uppercase tracking-wider text-tertiary mr-0.5">Insert</span>
      {vars.slice(0, 12).map((v) => (
        <button key={v.key} type="button" onClick={() => onPick(v.key)}
          className="h-6 px-2 rounded-md text-2xs text-secondary bg-surface-sunken ring-1 ring-subtle hover:text-primary hover:ring-strong">
          {v.label}
        </button>
      ))}
    </div>
  );
}

function CreateRecord({ cfg, vars, input, onChange }: {
  cfg: Record<string, any>; vars: FieldOption[]; input: string; onChange: (patch: Record<string, any>) => void;
}) {
  const object = cfg.object || 'issues';
  return (
    <div className="space-y-2">
      <select value={object} onChange={(e) => onChange({ object: e.target.value, data: {} })} className={`${input} w-full`} aria-label="Record type">
        {CREATABLE.map((o) => <option key={o} value={o}>{OBJECTS[o]?.singular || o}</option>)}
      </select>
      <FieldRows fields={createFields(object)} data={cfg.data || {}} vars={vars} input={input} onChange={(data) => onChange({ data })} all />
    </div>
  );
}

/** Field = value rows. `all` lists every field (create); otherwise rows are added one by one (update). */
function FieldRows({ fields, data, vars, input, onChange, all = false }: {
  fields: FieldOption[]; data: Record<string, any>; vars: FieldOption[]; input: string;
  onChange: (data: Record<string, any>) => void; all?: boolean;
}) {
  const [extra, setExtra] = useState('');
  const keys = all ? fields.map((f) => f.key) : Object.keys(data);
  const setVal = (k: string, v: string) => onChange({ ...data, [k]: v });
  return (
    <div className="space-y-1.5">
      {keys.map((k) => {
        const f = fields.find((x) => x.key === k) || { key: k, label: k };
        return (
          <div key={k} className="flex items-center gap-2">
            <span className="text-xs text-secondary w-28 shrink-0 truncate" title={f.label}>{f.label}</span>
            {f.options?.length
              ? <select value={data[k] || ''} onChange={(e) => setVal(k, e.target.value)} className={`${input} flex-1`} aria-label={f.label}>
                  <option value="">—</option>{f.options.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                </select>
              : <input value={data[k] || ''} onChange={(e) => setVal(k, e.target.value)} className={`${input} flex-1`} aria-label={f.label}
                  placeholder={vars[0] ? `e.g. {{${vars[0].key}}}` : ''} />}
            {!all && (
              <button onClick={() => { const n = { ...data }; delete n[k]; onChange(n); }} aria-label={`Remove ${f.label}`}
                className="p-1.5 rounded-md text-tertiary hover:text-danger"><X className="w-3.5 h-3.5" /></button>
            )}
          </div>
        );
      })}
      {!all && (
        <select value={extra} onChange={(e) => { if (e.target.value) { setVal(e.target.value, ''); setExtra(''); } }} className={`${input}`} aria-label="Add a field">
          <option value="">+ Set a field…</option>
          {fields.filter((f) => !(f.key in data)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      )}
      {vars.length > 0 && <p className="text-2xs text-tertiary">Values can use the record: {vars.slice(0, 4).map((v) => `{{${v.key}}}`).join(' ')}…</p>}
    </div>
  );
}

function groups(objects: TriggerObject[]): [string, TriggerObject[]][] {
  const out = new Map<string, TriggerObject[]>();
  for (const o of objects) (out.get(o.group) || out.set(o.group, []).get(o.group)!).push(o);
  return [...out.entries()];
}

/** Drop empty values, and the old editor's raw-JSON helper key. */
function clean(cfg: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(cfg || {})) {
    if (k === '_data') continue;
    if (k === 'data' && v && typeof v === 'object') {
      const d: Record<string, any> = {};
      for (const [dk, dv] of Object.entries(v)) if (dv !== '' && dv !== null && dv !== undefined) d[dk] = dv;
      out.data = d;
    } else if (v !== '' && v !== undefined) out[k] = v;
  }
  return out;
}

/** What a step cannot run without — caught here rather than at 3 a.m. in the run log. */
function missing(s: Action): string {
  const c = s.config || {};
  if (s.type === 'send_email' && !String(c.to || '').trim()) return 'who should the email go to?';
  if (s.type === 'send_email' && !String(c.subject || '').trim()) return 'the email needs a subject.';
  if (s.type === 'post_to_chat' && !c.channel_id) return 'pick a chat channel.';
  if (s.type === 'post_to_chat' && !String(c.message || '').trim()) return 'write the message.';
  if (s.type === 'ask_ai' && !String(c.prompt || '').trim()) return 'tell the AI what to do.';
  if (s.type === 'run_agent' && !c.agent_id) return 'pick an agent.';
  if (s.type === 'send_webhook' && !c.connection_id && !c.url) return 'pick a connected app.';
  if (s.type === 'add_note' && !String(c.body || '').trim()) return 'write the note.';
  if ((s.type === 'create_record' || s.type === 'update_record')
    && !Object.values(c.data || {}).some((v) => String(v ?? '').trim())) return 'set at least one field.';
  return '';
}

export function friendly(msg: string): string {
  return msg
    .replace(/^PLAN_LIMIT_AUTOMATIONS:\s*/, '')
    .replace(/^FORBIDDEN:\s*/, '')
    .replace(/^BAD_(ACTIONS|CONDITIONS):\s*/, '');
}
