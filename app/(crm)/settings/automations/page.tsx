'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import {
  Zap, Plus, Trash2, Clock, Radio, Copy, Check, Play, Loader2, ChevronDown, ArrowRight, X,
  Mail, MessageCircle, Sparkles, Bot, FilePlus, PencilLine, StickyNote, Webhook,
} from 'lucide-react';
import {
  loadAutomations, setAutomationEnabled, deleteAutomation, loadAutomationRuns, loadConnections, testAutomation, webhookUrl,
  type Automation, type AutomationRun, type TestResult,
} from '@/lib/crm/automations';
import { RECIPES, TRIGGER_OBJECTS, describeTrigger, actionLabel, type Recipe, type TriggerObject } from '@/lib/automations/vocab';
import { getWorkspace } from '@/lib/crm/data';
import { listChannels } from '@/lib/crm/chat';
import { listAgents } from '@/lib/crm/agents';
import { loadCustomObjects } from '@/lib/crm/custom';
import AutomationEditor, { TestList, friendly, type EditorDeps } from '@/components/crm/AutomationEditor';
import { useDialog } from '@/components/ui/Dialog';
import DataBadge from '@/components/ui/DataBadge';
import AppLoading from '@/components/ui/AppLoading';

/**
 * Automations — "when this happens, do that", written so anyone can read one.
 *
 * Each card is a sentence ("When an invoice's status changes to paid → Post in
 * team chat") with its health beside it: when it last ran and whether that
 * worked. That line is the point. An automation that has been failing quietly
 * for a month looks exactly like one that works unless the screen says so, and
 * the run log used to be the only place it did — below the fold, unfiltered.
 *
 * Test runs it once, now, against the newest real record: emails, chat posts,
 * AI and agents really happen; record writes are simulated (0132).
 */

const ICONS: Record<string, any> = {
  send_email: Mail, post_to_chat: MessageCircle, ask_ai: Sparkles, run_agent: Bot,
  create_record: FilePlus, update_record: PencilLine, add_note: StickyNote, send_webhook: Webhook,
};
const TRIGGER_ICON: Record<string, any> = { event: Zap, schedule: Clock, webhook: Radio };

const blank = (): Automation => ({
  id: '', name: '', enabled: true, trigger_type: 'event', object: 'deals', event: 'updated', conditions: [], actions: [],
});

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function AutomationsPage() {
  const { confirm: confirmDialog, notify } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const myEmail = (user as any)?.email?.address || (user as any)?.google?.email || '';

  const [rows, setRows] = useState<Automation[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [deps, setDeps] = useState<EditorDeps>({ connections: [], channels: [], agents: [], customObjects: [] });
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [showRecipes, setShowRecipes] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, { list?: TestResult[]; error?: string }>>({});
  const [runFilter, setRunFilter] = useState<{ failed: boolean; id?: string }>({ failed: false });

  const reload = useCallback(async () => {
    const [a, r] = await Promise.all([loadAutomations(privy), loadAutomationRuns(privy)]);
    setRows(a.rows); setLive(a.live); setRuns(r.rows); setLoading(false);
  }, [privy]);

  // What the editor's pickers offer. Loaded once; none of it blocks the list.
  const loadDeps = useCallback(async () => {
    const c = await loadConnections(privy);
    const w = privy ? await getWorkspace(privy) : null;
    if (!privy || !w) { setDeps((d) => ({ ...d, connections: c.live ? c.rows : [] })); return; }
    const [channels, agents, custom] = await Promise.all([
      listChannels(privy, w.id), listAgents(privy, w.id), loadCustomObjects(privy, w.id),
    ]);
    setDeps({
      connections: c.live ? c.rows : [],
      channels: channels.map((ch) => ({ id: ch.id, name: ch.name })),
      agents: agents.filter((g) => g.enabled !== false).map((g) => ({ id: g.id, name: g.name, role: g.role })),
      customObjects: (custom.rows || []).map((o): TriggerObject => ({
        slug: o.slug, one: `a ${o.singular.toLowerCase()}`, label: o.plural, group: 'Your objects', writable: true,
        fields: o.fields.map((f) => ({
          key: f.key, label: f.label, options: f.type === 'select' ? f.options : undefined,
          type: f.type === 'number' || f.type === 'currency' ? 'number' : f.type === 'date' ? 'date' : 'text',
        })),
      })),
    });
  }, [privy]);

  useEffect(() => { if (ready) { reload(); loadDeps(); } }, [ready, reload, loadDeps]);

  const objects = useMemo(() => [...TRIGGER_OBJECTS, ...deps.customObjects], [deps.customObjects]);

  // A recipe arrives with its gaps filled where there is an obvious answer —
  // your email, the first channel, the first agent — so most work on Save.
  const fromRecipe = (r: Recipe) => {
    const a: Automation = { ...blank(), ...JSON.parse(JSON.stringify(r.automation)) };
    a.actions = a.actions.map((s) => {
      const cfg = { ...s.config };
      if (s.type === 'send_email' && !cfg.to && myEmail) cfg.to = myEmail;
      if (s.type === 'post_to_chat' && !cfg.channel_id && deps.channels[0]) cfg.channel_id = deps.channels[0].id;
      if (s.type === 'run_agent' && !cfg.agent_id && deps.agents[0]) cfg.agent_id = deps.agents[0].id;
      return { ...s, config: cfg };
    });
    setShowRecipes(false);
    setEditing(a);
  };

  const toggle = async (a: Automation) => {
    if (!privy || !live) return;
    setRows((rs) => rs.map((r) => (r.id === a.id ? { ...r, enabled: !r.enabled } : r)));
    const res = await setAutomationEnabled(privy, a.id, !a.enabled);
    if (res.error) {
      setRows((rs) => rs.map((r) => (r.id === a.id ? { ...r, enabled: a.enabled } : r)));
      notify(friendly(res.error));
    }
  };
  const remove = async (a: Automation) => {
    if (!privy || !await confirmDialog(`Delete “${a.name || 'this automation'}”? Its run history stays.`)) return;
    const res = await deleteAutomation(privy, a.id);
    if (res.error) { notify(friendly(res.error)); return; }
    reload();
  };
  const test = async (a: Automation) => {
    if (!privy || !live) return;
    setTesting(a.id);
    const r = await testAutomation(privy, a.id);
    setTesting(null);
    setTests((t) => ({ ...t, [a.id]: r.error ? { error: r.error } : { list: r.results } }));
    reload();
  };

  const shownRuns = runs.filter((r) => (!runFilter.failed || r.status === 'error') && (!runFilter.id || r.automation_id === runFilter.id));
  const filteredName = runFilter.id ? rows.find((r) => r.id === runFilter.id)?.name : null;

  return (
    <>
      <header className="h-14 shrink-0 flex items-center gap-2.5 page-x">
        <h1 className="text-base font-medium text-primary">Automations</h1>
        {rows.length > 0 && <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{rows.length}</span>}
        <DataBadge live={live} />
        <div className="ml-auto flex items-center gap-1.5">
          {rows.length > 0 && (
            <button onClick={() => setShowRecipes((v) => !v)} disabled={!live}
              className="h-8 px-3 hidden sm:inline-flex items-center gap-1.5 rounded-lg text-sm text-secondary ring-1 ring-subtle hover:bg-surface-hover disabled:opacity-40">
              Recipes <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showRecipes ? 'rotate-180' : ''}`} />
            </button>
          )}
          <button onClick={() => setEditing(blank())} disabled={!live}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> New automation
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto page-pad">
        <div className="space-y-6">
          {loading ? <AppLoading /> : rows.length === 0 || showRecipes ? (
            <section>
              {rows.length === 0 && (
                <div className="mb-4">
                  <h2 className="text-md font-medium text-primary">Let the routine work run itself</h2>
                  <p className="text-sm text-secondary mt-1 max-w-2xl">
                    An automation is a sentence: <em>when</em> something happens, <em>then</em> do this. Pick a recipe to start —
                    it opens ready to save — or build your own.
                  </p>
                </div>
              )}
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {RECIPES.map((r) => {
                  const TI = TRIGGER_ICON[r.automation.trigger_type] || Zap;
                  return (
                    <button key={r.key} onClick={() => fromRecipe(r)} disabled={!live}
                      className="group text-left card-surface p-3.5 hover:ring-strong transition-all disabled:opacity-50 flex flex-col">
                      <span className="flex items-center gap-1.5 text-2xs text-tertiary mb-1.5">
                        <TI className="w-3.5 h-3.5" /> {describeTrigger(r.automation)}
                      </span>
                      <span className="text-sm font-medium text-primary">{r.name}</span>
                      <span className="text-xs text-secondary leading-snug mt-0.5 flex-1">{r.desc}</span>
                      <span className="mt-2 flex items-center gap-1 text-tertiary">
                        {r.automation.actions.map((s: any, i: number) => { const I = ICONS[s.type] || Zap; return <I key={i} className="w-3.5 h-3.5" />; })}
                        <span className="ml-auto inline-flex items-center gap-0.5 text-2xs font-semibold text-accent opacity-0 group-hover:opacity-100 transition-opacity">Use <ArrowRight className="w-3 h-3" /></span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {!loading && rows.length > 0 && (
            <ul className="space-y-2.5">
              {rows.map((a) => {
                const TI = TRIGGER_ICON[a.trigger_type] || Zap;
                const t = tests[a.id];
                const lr = a.last_run;
                return (
                  <li key={a.id} className={`card-surface p-4 ${a.enabled ? '' : 'opacity-70'}`}>
                    <div className="flex items-start gap-3">
                      <button role="switch" aria-checked={a.enabled} aria-label={a.enabled ? 'Turn off' : 'Turn on'}
                        onClick={() => toggle(a)} disabled={!live} title={a.enabled ? 'On — click to pause' : 'Paused — click to turn on'}
                        className={`mt-0.5 w-9 h-5 rounded-full shrink-0 relative transition-colors ${a.enabled ? 'bg-success' : 'bg-strong'} disabled:opacity-50`}>
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-surface shadow transition-transform ${a.enabled ? 'translate-x-4' : ''}`} />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <button onClick={() => live && setEditing(JSON.parse(JSON.stringify(a)))} className="min-w-0 flex-1 text-left pt-1">
                            <span className="block text-sm font-medium text-primary truncate">{a.name || 'Untitled automation'}</span>
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => test(a)} disabled={!live || testing === a.id} title="Run it once now against your latest record" aria-label="Test"
                              className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-hover disabled:opacity-40">
                              {testing === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                              <span className="hidden sm:inline">Test</span>
                            </button>
                            <button onClick={() => setEditing(JSON.parse(JSON.stringify(a)))} disabled={!live}
                              className="h-8 px-2.5 text-xs rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-hover disabled:opacity-40">Edit</button>
                            <button onClick={() => remove(a)} disabled={!live} aria-label="Delete"
                              className="p-2 rounded-md text-tertiary hover:text-danger hover:bg-danger/10 disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                        <button onClick={() => live && setEditing(JSON.parse(JSON.stringify(a)))} className="block w-full text-left">
                          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-secondary">
                            <TI className="hidden sm:block w-3.5 h-3.5 text-tertiary shrink-0" />
                            <span>{describeTrigger(a, objects)}</span>
                            <ArrowRight className="w-3 h-3 text-tertiary shrink-0" />
                            {(a.actions || []).length === 0 ? <span className="text-warning">no steps</span>
                              : (a.actions || []).map((s, i) => {
                                const I = ICONS[s.type] || Zap;
                                return <span key={i} className="inline-flex items-center gap-1">{i > 0 && <span className="text-tertiary">then</span>}<I className="w-3.5 h-3.5 text-tertiary" />{actionLabel(s.type)}</span>;
                              })}
                          </span>
                        </button>
                        <div className="mt-1.5 flex items-center gap-1.5 text-2xs min-w-0">
                          {!lr ? <span className="text-tertiary">{a.enabled ? 'Hasn’t run yet' : 'Paused'}</span> : (
                            <>
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${lr.status === 'ok' ? 'bg-success' : lr.status === 'error' ? 'bg-danger' : 'bg-strong'}`} />
                              <span className="text-tertiary shrink-0">Last ran {ago(lr.at)}</span>
                              {lr.status === 'error' && <span className="text-danger truncate">· {lr.detail}</span>}
                            </>
                          )}
                          {(a.errors_7d ?? 0) > 0 && (
                            <button onClick={() => { setRunFilter({ failed: true, id: a.id }); document.getElementById('runs')?.scrollIntoView({ behavior: 'smooth' }); }}
                              className="text-danger hover:underline shrink-0">{a.errors_7d} failed this week</button>
                          )}
                        </div>
                      </div>
                    </div>

                    {a.trigger_type === 'webhook' && a.webhook_token && <WebhookUrl token={a.webhook_token} />}

                    {t && (
                      <div className="mt-3 rounded-lg bg-surface-sunken/60 ring-1 ring-subtle p-3 relative" aria-live="polite">
                        <button onClick={() => setTests((x) => { const n = { ...x }; delete n[a.id]; return n; })} aria-label="Close"
                          className="absolute top-2 right-2 p-1 rounded text-tertiary hover:text-secondary"><X className="w-3.5 h-3.5" /></button>
                        <div className="text-xs font-medium text-primary mb-1.5">Test run</div>
                        {t.error ? <p className="text-xs text-danger">{t.error}</p> : <TestList results={t.list || []} />}
                        {!t.error && <p className="text-2xs text-tertiary mt-1.5">Creating or updating records was only simulated.</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {!loading && (rows.length > 0 || runs.length > 0) && (
            <section id="runs">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-sm font-medium text-primary">Recent runs</h2>
                {filteredName && (
                  <span className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-md bg-surface-hover text-2xs text-secondary">
                    {filteredName}
                    <button onClick={() => setRunFilter((f) => ({ ...f, id: undefined }))} aria-label="Show all automations" className="p-0.5 rounded hover:text-primary"><X className="w-3 h-3" /></button>
                  </span>
                )}
                <div className="ml-auto flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-hover ring-1 ring-subtle">
                  {([[false, 'All'], [true, 'Failed']] as const).map(([v, l]) => (
                    <button key={l} onClick={() => setRunFilter((f) => ({ ...f, failed: v }))}
                      className={`h-6 px-2 rounded-md text-2xs font-semibold transition-colors ${runFilter.failed === v ? 'bg-surface text-primary shadow-sm' : 'text-tertiary hover:text-secondary'}`}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="card-surface overflow-hidden">
                {shownRuns.length === 0 ? (
                  <div className="px-5 py-8 text-center text-sm text-tertiary">
                    {runFilter.failed ? 'Nothing failed. 🎉' : 'Nothing has run yet. Press Test on an automation to try it.'}
                  </div>
                ) : shownRuns.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-4 min-h-11 py-2 border-b border-subtle last:border-0 text-xs">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.status === 'ok' ? 'bg-success' : r.status === 'error' ? 'bg-danger' : 'bg-strong'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-secondary">{r.automation_name || '—'}</span>
                      {r.action_type && <span className="text-tertiary"> · {actionLabel(r.action_type)}</span>}
                      <span className={`block truncate ${r.status === 'error' ? 'text-danger' : 'text-tertiary'}`}>{r.detail}</span>
                    </span>
                    <span className="text-tertiary tabular-nums shrink-0">{ago(r.created_at)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {editing && (
        <AutomationEditor
          automation={editing} privy={privy} deps={deps}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </>
  );
}

function WebhookUrl({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = webhookUrl(token);
  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface-sunken ring-1 ring-subtle px-2.5 py-1.5">
      <Radio className="w-3.5 h-3.5 text-tertiary shrink-0" />
      <code className="flex-1 text-2xs font-mono text-secondary truncate">{url}</code>
      <button onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
        className="h-6 px-2 rounded-md text-2xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface inline-flex items-center gap-1">
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Copy
      </button>
    </div>
  );
}
