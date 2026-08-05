'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import {
  Bot, Plus, Play, Loader2, Trash2, Pencil, X, Check, ShieldCheck, Zap, ChevronRight,
  Wallet, AlarmClock, TrendingUp, UserSearch, FileSearch, Handshake, Sunrise,
  type LucideIcon,
} from 'lucide-react';
import { getWorkspace, type WorkspaceContext } from '@/lib/crm/data';
import {
  listAgents, saveAgent, deleteAgent, setAgentEnabled, listRuns, runAgentTask, approveRun,
  DEFAULT_TOOLS, WRITE_TOOLS, AGENT_OBJECTS, TOOL_CATALOG, TOOL_GROUPS,
  SCHEDULE_LABEL,
  type Agent, type AgentRun,
} from '@/lib/crm/agents';
import { AGENT_TEMPLATES, type AgentTemplate } from '@/lib/agents/templates';
import { listSkills, type Skill } from '@/lib/crm/skills';
import SkillsSection from '@/components/crm/SkillsSection';
import { ThinkingLine } from '@/components/ui/Thinking';
import PageHeader from '@/components/dashboard/PageHeader';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { useDialog } from '@/components/ui/Dialog';
import AppLoading from '@/components/ui/AppLoading';

const BLANK: Partial<Agent> = {
  name: '', role: '', instructions: '', model: '',
  allowed_tools: [...DEFAULT_TOOLS], allowed_objects: [], skill_ids: [], autonomy: 'suggest', max_steps: 12,
  schedule: 'off', schedule_hour: 9, schedule_task: '',
};

/** A template is just a prefilled editor payload — no id, so saving creates. */
function fromTemplate(t: AgentTemplate): Partial<Agent> {
  return {
    name: t.name, role: t.role, instructions: t.instructions, model: '',
    allowed_tools: [...t.allowed_tools], allowed_objects: [...t.allowed_objects],
    // Deliberately not taken from the template: a gallery agent installed in ten
    // seconds must not be able to write before someone has watched it run once.
    autonomy: 'suggest', max_steps: t.max_steps, skill_ids: [],
    // Same reasoning as the autonomy pin above: a gallery agent installed in
    // ten seconds must not start running unattended before anyone has watched
    // it do anything.
    schedule: 'off', schedule_hour: 9, schedule_task: '',
  };
}

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  Wallet, AlarmClock, TrendingUp, UserSearch, FileSearch, ShieldCheck, Handshake, Sunrise,
};

function TemplateIcon({ name }: { name: string }) {
  const Icon = TEMPLATE_ICONS[name] ?? Bot;
  return (
    <span className="w-7 h-7 rounded-md bg-surface-hover flex items-center justify-center shrink-0">
      <Icon className="w-3.5 h-3.5 text-accent" />
    </span>
  );
}

export default function AgentsPage() {
  const { confirm: confirmDialog, notify } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Agent> | null>(null);
  const [running, setRunning] = useState<Agent | null>(null);

  const reload = useCallback(async (w: WorkspaceContext, p: string) => {
    const [a, r, sk] = await Promise.all([listAgents(p, w.id), listRuns(p, w.id), listSkills(p, w.id)]);
    setAgents(a); setRuns(r); setSkills(sk); setLoading(false);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!privy) { setLoading(false); return; }
    getWorkspace(privy).then((w) => { if (w) { setWs(w); reload(w, privy); } else setLoading(false); });
  }, [ready, privy, reload]);

  const refresh = () => { if (ws && privy) reload(ws, privy); };

  if (!ready || loading) {
    return <AppLoading />;
  }

  return (
    <>
      <PageHeader title="Agents" count={agents.length}>
        <Button size="sm" variant="primary" onClick={() => setEditing({ ...BLANK })} disabled={!privy}>
          <Plus className="w-3.5 h-3.5" /> New agent
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-auto p-5 2xl:p-7 lg:p-6">
        <div className="max-w-5xl mx-auto space-y-8">
          <p className="text-sm text-secondary max-w-2xl">
            Agents run on your own AI key and act through your workspace tools. Give one a role and
            instructions, scope which tools and objects it may touch, and choose whether it proposes
            changes for your approval or acts on its own.
          </p>

          {!privy && (
            <div className="rounded-lg border border-subtle bg-surface-sunken p-4 text-sm text-secondary">
              Sign in to create and run agents.
            </div>
          )}

          {/* Agents list */}
          <section className="grid sm:grid-cols-2 gap-3">
            {agents.map((a) => (
              <div key={a.id} className="rounded-lg border border-subtle bg-surface p-4 flex flex-col">
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 rounded-md bg-surface-hover flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-accent" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-primary truncate">{a.name}</h3>
                      {!a.enabled && <Badge tone="neutral">off</Badge>}
                    </div>
                    <p className="text-xs text-tertiary truncate">{a.role || 'No role set'}</p>
                  </div>
                </div>
                <p className="text-xs text-secondary mt-2.5 line-clamp-2 min-h-[2rem]">{a.instructions || 'No instructions yet.'}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                  <Badge tone={a.autonomy === 'auto' ? 'warning' : 'accent'}>
                    {a.autonomy === 'auto' ? <><Zap className="w-3 h-3 mr-0.5 inline" />autonomous</> : <><ShieldCheck className="w-3 h-3 mr-0.5 inline" />approve writes</>}
                  </Badge>
                  <Badge tone="neutral">{a.allowed_tools.filter((t) => WRITE_TOOLS.includes(t)).length ? 'read + write' : 'read only'}</Badge>
                  {/* An agent that runs on its own is the one fact worth
                      seeing without opening the editor — it is spending the
                      workspace's AI key while nobody is watching. */}
                  {a.schedule && a.schedule !== 'off' && (
                    <Badge tone="accent"><AlarmClock className="w-3 h-3 mr-0.5 inline" />{SCHEDULE_LABEL[a.schedule].toLowerCase()}</Badge>
                  )}
                  {a.model && <span className="text-2xs font-mono text-tertiary">{a.model}</span>}
                </div>
                <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-subtle">
                  <Button size="sm" variant="primary" onClick={() => setRunning(a)} disabled={!a.enabled}><Play className="w-3.5 h-3.5" /> Run</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(a)}><Pencil className="w-3.5 h-3.5" /></Button>
                  <label className="ml-auto flex items-center gap-1.5 text-2xs text-tertiary cursor-pointer select-none">
                    <input type="checkbox" checked={a.enabled} onChange={(e) => ws && privy && setAgentEnabled(privy, ws.id, a.id, e.target.checked).then(refresh)} className="rounded border-strong accent-accent" />
                    enabled
                  </label>
                  <Button size="sm" variant="ghost" onClick={async () => { if (ws && privy && await confirmDialog(`Delete agent "${a.name}"?`)) deleteAgent(privy, ws.id, a.id).then(refresh); }}><Trash2 className="w-3.5 h-3.5 text-danger" /></Button>
                </div>
              </div>
            ))}
            {agents.length === 0 && privy && (
              <div className="sm:col-span-2 rounded-lg border border-dashed border-subtle p-10 text-center">
                <Bot className="w-6 h-6 text-tertiary mx-auto mb-2" />
                <p className="text-sm text-secondary">No agents yet. Hire one below, or build your own.</p>
              </div>
            )}
          </section>

          {privy && ws && <SkillsSection skills={skills} ws={ws.id} privy={privy} onChange={refresh} />}

          {/* Gallery. A blank form is the wrong first screen: knowing that a
              finance agent needs get_finance_summary + get_ledger and should stay
              in suggest mode is exactly what a new user doesn't know yet. Each
              card opens the SAME editor, prefilled — not a second code path. */}
          {privy && (
            <section>
              <h2 className="text-xs font-medium uppercase tracking-wider text-tertiary mb-2">Hire an agent</h2>
              <p className="text-xs text-secondary mb-3 max-w-2xl">
                Ready-made configurations. Each one opens in the editor so you can read its
                instructions and adjust its access before saving — all of them start in approve-writes mode.
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {AGENT_TEMPLATES.map((t) => (
                  <button key={t.key} onClick={() => setEditing(fromTemplate(t))}
                    className="text-left rounded-lg border border-subtle bg-surface p-3.5 hover:border-strong hover:shadow-card transition-all">
                    <div className="flex items-center gap-2">
                      <TemplateIcon name={t.icon} />
                      <h3 className="text-sm font-medium text-primary truncate">{t.name}</h3>
                    </div>
                    <p className="text-xs text-secondary mt-1.5 line-clamp-2">{t.summary}</p>
                    <div className="flex items-center gap-1.5 mt-2.5">
                      <Badge tone="neutral">{t.group}</Badge>
                      <span className="text-3xs text-tertiary">{t.allowed_tools.length} tools</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Run history */}
          {runs.length > 0 && (
            <section>
              <h2 className="text-xs font-medium uppercase tracking-wider text-tertiary mb-2">Recent runs</h2>
              <div className="rounded-lg border border-subtle divide-y divide-subtle overflow-hidden">
                {runs.slice(0, 12).map((r) => <RunRow key={r.id} run={r} ws={ws} privy={privy} onChange={refresh} />)}
              </div>
            </section>
          )}
        </div>
      </div>

      {editing && ws && privy && (
        <AgentEditor initial={editing} skills={skills} onClose={() => setEditing(null)}
          onSave={async (a) => { await saveAgent(privy, ws.id, a); setEditing(null); refresh(); }} />
      )}
      {running && ws && privy && (
        <RunModal agent={running} ws={ws.id} privy={privy} onClose={() => { setRunning(null); refresh(); }} />
      )}
    </>
  );
}

// ── Run history row (expandable) ──────────────────────────────────────────────
function RunRow({ run, ws, privy, onChange }: { run: AgentRun; ws: WorkspaceContext | null; privy: string | null; onChange: () => void }) {
  const { notify } = useDialog();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const tone = run.status === 'done' ? 'success' : run.status === 'error' ? 'danger' : run.status === 'awaiting_approval' ? 'warning' : 'neutral';
  const approve = async () => {
    if (!ws || !privy) return;
    setBusy(true);
    try { await approveRun(privy, ws.id, run.id); onChange(); } catch (e: any) { notify(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="bg-surface">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2.5 px-3 h-11 text-left hover:bg-surface-hover transition-colors">
        <ChevronRight className={`w-3.5 h-3.5 text-tertiary transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="text-sm text-primary truncate flex-1">{run.agent_name}: <span className="text-secondary">{run.task}</span></span>
        <Badge tone={tone as any}>{run.status.replace('_', ' ')}</Badge>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 text-xs">
          {run.result && <p className="text-secondary whitespace-pre-wrap">{run.result}</p>}
          {run.proposed?.length > 0 && (
            <div className="rounded-md border border-warning/30 bg-warning/5 p-2.5">
              <div className="font-medium text-primary mb-1.5">{run.proposed.length} proposed change(s)</div>
              {run.proposed.map((p: any, i: number) => (
                <div key={i} className="font-mono text-2xs text-secondary">{p.name}({p.args?.object}) {JSON.stringify(p.args?.data || p.args?.id || {}).slice(0, 80)}</div>
              ))}
              {run.status === 'awaiting_approval' && (
                <Button size="sm" variant="primary" className="mt-2" onClick={approve} disabled={busy}>
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Approve &amp; apply
                </Button>
              )}
            </div>
          )}
          {run.steps?.filter((s: any) => s.type === 'tool').map((s: any, i: number) => (
            <div key={i} className="font-mono text-2xs text-tertiary truncate">→ {s.name}({s.args?.object || ''})</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Editor modal ──────────────────────────────────────────────────────────────
function AgentEditor({ initial, skills, onClose, onSave }: { initial: Partial<Agent>; skills: Skill[]; onClose: () => void; onSave: (a: Partial<Agent>) => Promise<void> }) {
  const [a, setA] = useState<Partial<Agent>>({ ...BLANK, ...initial, allowed_tools: initial.allowed_tools?.length ? initial.allowed_tools : [...DEFAULT_TOOLS], allowed_objects: initial.allowed_objects || [], skill_ids: initial.skill_ids || [] });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Agent, v: any) => setA((p) => ({ ...p, [k]: v }));
  const toggleTool = (t: string) => set('allowed_tools', a.allowed_tools?.includes(t) ? a.allowed_tools.filter((x) => x !== t) : [...(a.allowed_tools || []), t]);
  const toggleObj = (o: string) => set('allowed_objects', a.allowed_objects?.includes(o) ? a.allowed_objects.filter((x) => x !== o) : [...(a.allowed_objects || []), o]);
  const toggleSkill = (id: string) => set('skill_ids', a.skill_ids?.includes(id) ? a.skill_ids.filter((x) => x !== id) : [...(a.skill_ids || []), id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="bg-surface border border-subtle rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 flex items-center justify-between px-4 border-b border-subtle sticky top-0 bg-surface">
          <h3 className="text-sm font-medium text-primary">{initial.id ? 'Edit agent' : 'New agent'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-4">
          <Field label="Name"><input value={a.name || ''} onChange={(e) => set('name', e.target.value)} className="input-field" placeholder="Collections assistant" /></Field>
          <Field label="Role"><input value={a.role || ''} onChange={(e) => set('role', e.target.value)} className="input-field" placeholder="collections specialist" /></Field>
          <Field label="Instructions" hint="What the agent should do, and how.">
            <textarea value={a.instructions || ''} onChange={(e) => set('instructions', e.target.value)} rows={4} className="input-field !h-auto py-2 resize-y" placeholder="Find overdue invoices and draft a friendly reminder task for each." />
          </Field>
          <Field label="Model" hint="Optional. Leave blank to use your default AI key's model.">
            <input value={a.model || ''} onChange={(e) => set('model', e.target.value)} className="input-field font-mono" placeholder="claude-sonnet-5" />
          </Field>

          <Field label="Autonomy">
            <div className="grid grid-cols-2 gap-2">
              {(['suggest', 'auto'] as const).map((mode) => (
                <button key={mode} onClick={() => set('autonomy', mode)}
                  className={`text-left rounded-md border p-2.5 transition-colors ${a.autonomy === mode ? 'border-accent bg-accent/5' : 'border-subtle hover:border-strong'}`}>
                  <div className="text-xs font-medium text-primary flex items-center gap-1">
                    {mode === 'suggest' ? <ShieldCheck className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                    {mode === 'suggest' ? 'Approve writes' : 'Autonomous'}
                  </div>
                  <div className="text-2xs text-tertiary mt-0.5">{mode === 'suggest' ? 'Proposes changes; you approve.' : 'Writes on its own, within limits.'}</div>
                </button>
              ))}
            </div>
          </Field>

          {/* Grouped by module, and showing all 22 tools. The flat list here used
              to render a stale 6-name copy of the catalogue, so finance, files,
              candidate and analytics tools were simply not grantable. */}
          <Field label="Tools" hint="✎ marks a tool that changes data.">
            <div className="space-y-2.5">
              {TOOL_GROUPS.map((g) => {
                const inGroup = TOOL_CATALOG.filter((t) => t.group === g);
                const onCount = inGroup.filter((t) => a.allowed_tools?.includes(t.name)).length;
                const allOn = onCount === inGroup.length;
                return (
                  <div key={g}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-3xs uppercase tracking-wide text-tertiary">{g}</span>
                      <button
                        onClick={() => set('allowed_tools', allOn
                          ? (a.allowed_tools || []).filter((x) => !inGroup.some((t) => t.name === x))
                          : Array.from(new Set([...(a.allowed_tools || []), ...inGroup.map((t) => t.name)])))}
                        className="text-3xs text-tertiary hover:text-accent">
                        {allOn ? 'none' : 'all'}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {inGroup.map((t) => (
                        <button key={t.name} onClick={() => toggleTool(t.name)} title={t.name}
                          className={`text-2xs px-2 py-1 rounded border transition-colors ${a.allowed_tools?.includes(t.name) ? 'border-accent bg-accent/10 text-accent' : 'border-subtle text-tertiary hover:border-strong'}`}>
                          {t.label}{t.write ? ' ✎' : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Field>

          {skills.length > 0 && (
            <Field label="Skills" hint="Company knowledge this agent should apply. Never widens its tool access.">
              <div className="space-y-1">
                {skills.map((s) => {
                  const on = a.skill_ids?.includes(s.id);
                  return (
                    <label key={s.id} className={`flex items-start gap-2 rounded-md border p-2 cursor-pointer transition-colors ${on ? 'border-accent bg-accent/5' : 'border-subtle hover:border-strong'}`}>
                      <input type="checkbox" checked={!!on} onChange={() => toggleSkill(s.id)} className="mt-0.5 rounded border-strong accent-accent" />
                      <span className="min-w-0 flex-1">
                        <span className="text-xs font-medium text-primary block truncate">{s.name}</span>
                        {s.description && <span className="text-2xs text-tertiary block truncate">{s.description}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </Field>
          )}

          <Field label="Objects" hint="Leave all off to allow every object.">
            <div className="flex flex-wrap gap-1.5">
              {AGENT_OBJECTS.map((o) => (
                <button key={o} onClick={() => toggleObj(o)}
                  className={`text-2xs px-2 py-1 rounded border transition-colors ${a.allowed_objects?.includes(o) ? 'border-accent bg-accent/10 text-accent' : 'border-subtle text-tertiary hover:border-strong'}`}>{o}</button>
              ))}
            </div>
          </Field>

          {/* Unattended runs. Deliberately below Objects and Tools: what an
              agent MAY do has to be settled before deciding it may do it
              without being asked. */}
          <Field label="Run on a schedule" hint="Autonomy is unchanged — an approve-writes agent still only proposes, it just proposes without being asked.">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {(['off', 'hourly', 'daily', 'weekly'] as const).map((v) => (
                  <button key={v} onClick={() => set('schedule', v)}
                    className={`text-2xs px-2 py-1 rounded border transition-colors ${(a.schedule || 'off') === v ? 'border-accent bg-accent/10 text-accent' : 'border-subtle text-tertiary hover:border-strong'}`}>
                    {SCHEDULE_LABEL[v]}
                  </button>
                ))}
              </div>
              {(a.schedule && a.schedule !== 'off') && (
                <>
                  <textarea value={a.schedule_task || ''} onChange={(e) => set('schedule_task', e.target.value)}
                    rows={2} placeholder="What should it do each time? e.g. “Check every open deal for news and record what you find.”"
                    className="input-field !h-auto py-2 resize-none w-full text-xs" />
                  {a.schedule !== 'hourly' && (
                    <label className="flex items-center gap-2 text-2xs text-tertiary">
                      At
                      <select value={a.schedule_hour ?? 9} onChange={(e) => set('schedule_hour', Number(e.target.value))}
                        className="input-field !h-7 !text-xs w-20">
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                        ))}
                      </select>
                      UTC
                    </label>
                  )}
                  {/* Said plainly rather than discovered later: an unattended
                      run spends the workspace's own AI key. */}
                  <p className="text-2xs text-tertiary">
                    Each run uses your own AI key. Needs a cron job on{' '}
                    <span className="font-mono">/api/agents/dispatch</span>; without one, scheduled agents never fire.
                  </p>
                </>
              )}
            </div>
          </Field>

          <Field label="Max steps" hint="Upper bound on tool calls per run (1-40).">
            <input type="number" min={1} max={40} value={a.max_steps || 12} onChange={(e) => set('max_steps', Math.max(1, Math.min(40, Number(e.target.value) || 12)))} className="input-field w-24" />
          </Field>
        </div>
        <div className="h-14 flex items-center justify-end gap-2 px-4 border-t border-subtle sticky bottom-0 bg-surface">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={saving || !a.name?.trim()} onClick={async () => { setSaving(true); await onSave(a); setSaving(false); }}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save agent
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Run modal ─────────────────────────────────────────────────────────────────
function RunModal({ agent, ws, privy, onClose }: { agent: Agent; ws: string; privy: string; onClose: () => void }) {
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<any | null>(null);
  const [err, setErr] = useState('');
  const examples = AGENT_TEMPLATES.find((t) => t.name === agent.name)?.examples ?? [];

  const run = async () => {
    if (!task.trim()) return;
    setBusy(true); setErr(''); setOut(null);
    try { setOut(await runAgentTask(privy, ws, agent.id, task)); }
    catch (e: any) { setErr(e.message || 'Run failed'); }
    finally { setBusy(false); }
  };
  const approve = async () => {
    setBusy(true);
    try { await approveRun(privy, ws, out.runId); setOut({ ...out, status: 'done', result: (out.result || '') + '\n\nApplied.' }); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="bg-surface border border-subtle rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 flex items-center gap-2 px-4 border-b border-subtle">
          <Bot className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium text-primary flex-1 truncate">Run {agent.name}</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <textarea autoFocus value={task} onChange={(e) => setTask(e.target.value)} rows={3} className="input-field !h-auto py-2 resize-y" placeholder="Describe the task, e.g. 'List overdue invoices and draft a reminder task for each.'" />
          {/* Only shown for an agent still carrying a template's name — once it's
              renamed we no longer know these examples suit it. */}
          {examples.length > 0 && !task && (
            <div className="flex flex-wrap gap-1.5">
              {examples.map((ex) => (
                <button key={ex} onClick={() => setTask(ex)}
                  className="text-2xs text-left px-2 py-1 rounded border border-subtle text-tertiary hover:border-strong hover:text-secondary transition-colors">
                  {ex}
                </button>
              ))}
            </div>
          )}
          <Button variant="primary" onClick={run} disabled={busy || !task.trim()} className="w-full">
            {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Working…</> : <><Play className="w-3.5 h-3.5" /> Run</>}
          </Button>

          {/* An agent turn is the longest wait in the product — it can call
              several tools against a BYO key before it says anything. So the
              wait gets its own panel where the answer will land, rather than
              only a spinner inside the button the user just pressed. */}
          {busy && !out && (
            <ThinkingLine
              kind="composing"
              size="avatar"
              label={`${agent.name} is working`}
              hint="Reading your workspace and deciding what to do"
              className="rounded-md border border-subtle bg-surface-sunken py-6"
            />
          )}

          {err && <div className="rounded-md border border-danger/30 bg-danger/5 p-2.5 text-xs text-danger">{err}</div>}

          {out && (
            <div className="rounded-md border border-subtle bg-surface-sunken p-3 space-y-2 text-xs">
              <p className="text-secondary whitespace-pre-wrap">{out.result}</p>
              {out.proposed?.length > 0 && (
                <div className="rounded border border-warning/30 bg-warning/5 p-2">
                  <div className="font-medium text-primary mb-1">{out.proposed.length} proposed change(s)</div>
                  {out.proposed.map((p: any, i: number) => (
                    <div key={i} className="font-mono text-2xs text-secondary truncate">{p.name}({p.args?.object}) {JSON.stringify(p.args?.data || p.args?.id || {}).slice(0, 70)}</div>
                  ))}
                  {out.status === 'awaiting_approval' && (
                    <Button size="sm" variant="primary" className="mt-2" onClick={approve} disabled={busy}>
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Approve &amp; apply
                    </Button>
                  )}
                </div>
              )}
              <details className="text-tertiary">
                <summary className="cursor-pointer select-none">Steps ({out.steps?.length || 0})</summary>
                {(out.steps || []).map((s: any, i: number) => (
                  <div key={i} className="font-mono text-2xs mt-1 truncate">{s.type === 'tool' ? `→ ${s.name}(${s.args?.object || ''})` : s.type === 'thought' ? `· ${s.text?.slice(0, 90)}` : JSON.stringify(s).slice(0, 90)}</div>
                ))}
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-secondary mb-1">{label}</div>
      {children}
      {hint && <div className="text-2xs text-tertiary mt-1">{hint}</div>}
    </label>
  );
}
