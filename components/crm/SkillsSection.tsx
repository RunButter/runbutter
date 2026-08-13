'use client';

import { useMemo, useState } from 'react';
import { BookOpen, Plus, Trash2, Pencil, X, Loader2, Check, Sparkles, LayoutTemplate } from 'lucide-react';
import { Github } from '@/components/ui/BrandIcons';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { useDialog } from '@/components/ui/Dialog';
import { saveSkill, deleteSkill, importSkillsFromGithub, generateSkill, type Skill, type SkillPreview } from '@/lib/crm/skills';
import { lintProject } from '@/lib/plugins/lint';
import { scoreProject } from '@/lib/plugins/quality';
import { buildPlugin, skillSlug } from '@/lib/plugins/agent-plugin';
import Thinking from '@/components/ui/Thinking';
import { TEMPLATES } from '@/lib/plugins/templates';

/**
 * Skills manager. A skill is a reusable instruction pack — "how this company
 * chases an invoice", "our expense categories" — that any agent can carry.
 * Separate from an agent's own instructions because that knowledge outlives any
 * one agent and is usually needed by several.
 */
export default function SkillsSection({
  skills, ws, privy, onChange,
}: { skills: Skill[]; ws: string; privy: string; onChange: () => void }) {
  const { confirm: confirmDialog } = useDialog();
  const [editing, setEditing] = useState<Partial<Skill> | null>(null);
  const [importing, setImporting] = useState(false);
  // Writing a skill with AI used to exist only on the PUBLIC /plugins page,
  // which cannot save into a workspace — so a signed-in user had to leave the
  // app, generate, download a zip, and paste it back in by hand. It lands in
  // the editor rather than being saved, because a generated skill becomes part
  // of an agent's system prompt and a person should read it first.
  const [describing, setDescribing] = useState(false);
  // Starting points, from the SAME `TEMPLATES` the public builder at /plugins
  // uses. The in-app screen had none, so "New skill" opened an empty box — and
  // an empty box is the hardest possible version of "write a system prompt".
  // Sharing the array rather than copying it is the rule this file already
  // follows for the linter and the plugin builder: two lists drift, and the
  // in-app one is the one nobody remembers to update.
  const [templating, setTemplating] = useState(false);

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-tertiary">Skills</h2>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setDescribing(true)}>
            <Sparkles className="w-3.5 h-3.5" /> Describe it
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setImporting(true)}>
            <Github className="w-3.5 h-3.5" /> Import
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setTemplating((t) => !t)}>
            <LayoutTemplate className="w-3.5 h-3.5" /> Templates
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing({ name: '', description: '', instructions: '', suggested_tools: [] })}>
            <Plus className="w-3.5 h-3.5" /> New skill
          </Button>
        </div>
      </div>
      {templating && (
        <div className="mb-3 grid sm:grid-cols-3 gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              onClick={() => {
                // Opens the EDITOR pre-filled rather than saving. A template is
                // a starting point somebody edits, and one that saved itself
                // would put three identical skills in every workspace that
                // clicked around.
                // `TemplateSkill` has no suggested_tools — a template is instructions, and
                // the tool hints belong to the agent that carries it. Defaulted here
                // rather than widened there: `templates.ts` is import-free on purpose
                // and adding a field for one consumer is how that stops being true.
                setEditing({ name: t.skill.name, description: t.skill.description, instructions: t.skill.instructions, suggested_tools: [] });
                setTemplating(false);
              }}
              className="text-left rounded-xl ring-1 ring-subtle bg-surface p-3 hover:bg-surface-hover"
            >
              <div className="text-xs font-semibold text-primary mb-0.5">{t.label}</div>
              <div className="text-2xs text-tertiary line-clamp-2">{t.skill.description}</div>
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-secondary mb-3 max-w-2xl">
        Reusable instructions any agent can carry — how you number invoices, the tone of a reminder,
        which categories map where. Attach them to an agent in its editor. A skill never grants an
        agent tools it wasn&apos;t already given.
      </p>

      {skills.length === 0 ? (
        <div className="rounded-lg border border-dashed border-subtle p-8 text-center">
          <BookOpen className="w-5 h-5 text-tertiary mx-auto mb-2" />
          <p className="text-sm text-secondary">No skills yet. Write one, or import a repo of SKILL.md files.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {skills.map((s) => (
            <div key={s.id} className="rounded-lg border border-subtle bg-surface p-3.5 flex flex-col">
              <div className="flex items-start gap-2">
                <BookOpen className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <h3 className="text-sm font-medium text-primary flex-1 min-w-0 truncate">{s.name}</h3>
              </div>
              <p className="text-xs text-secondary mt-1.5 line-clamp-2 min-h-[2.75rem]">{s.description || 'No description.'}</p>
              <div className="flex items-center gap-1.5 mt-2">
                {/* Badge title-cases its content, so these stay single words. */}
                {s.source === 'github' ? <Badge tone="neutral"><Github className="w-3 h-3 mr-0.5 inline" />imported</Badge> : <Badge tone="neutral">custom</Badge>}
                <div className="ml-auto flex items-center gap-0.5">
                  <button onClick={() => setEditing(s)} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><Pencil className="w-3.5 h-3.5" /></button>
                  <button
                    onClick={async () => { if (await confirmDialog(`Delete skill "${s.name}"? Agents using it will lose it.`)) { await deleteSkill(privy, ws, s.id); onChange(); } }}
                    className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><Trash2 className="w-3.5 h-3.5 text-danger" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <SkillEditor initial={editing} onClose={() => setEditing(null)}
          onSave={async (s) => { await saveSkill(privy, ws, s); setEditing(null); onChange(); }} />
      )}
      {describing && (
        <DescribeModal
          onClose={() => setDescribing(false)}
          onDraft={(draft) => { setDescribing(false); setEditing(draft); }} />
      )}

      {importing && (
        <ImportModal ws={ws} privy={privy} onClose={() => setImporting(false)} onDone={() => { setImporting(false); onChange(); }} />
      )}
    </section>
  );
}

function SkillEditor({ initial, onClose, onSave }: { initial: Partial<Skill>; onClose: () => void; onSave: (s: Partial<Skill>) => Promise<void> }) {
  const [s, setS] = useState<Partial<Skill>>({ ...initial });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Skill, v: any) => setS((p) => ({ ...p, [k]: v }));
  const tooLong = (s.instructions || '').length > 20000;

  /**
   * The same score the public builder shows, on the screen where workspace
   * skills are actually written. It was only ever visible at /plugins, so the
   * skills an agent here follows every day were the ones nobody checked.
   *
   * Errors and warnings only. `idea`-severity findings are fine to ignore, and
   * a modal is not the place to argue about them.
   */
  const review = useMemo(() => {
    const name = (s.name || '').trim();
    if (!name || !(s.instructions || '').trim()) return null;
    const project = {
      manifest: { name: skillSlug(name) },
      skills: [{ name, description: s.description || '', instructions: s.instructions || '' }],
    };
    const { findings } = lintProject(project as any, buildPlugin(project as any));
    const report = scoreProject(findings, { skillCount: 1, perRunChars: (s.instructions || '').length, onDemandChars: 0 });
    return { score: report.overall, notes: findings.filter((f) => f.severity !== 'idea').map((f) => f.fix || f.message) };
  }, [s.name, s.description, s.instructions]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="bg-surface border border-subtle rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 flex items-center justify-between px-4 border-b border-subtle sticky top-0 bg-surface">
          <h3 className="text-sm font-medium text-primary">{initial.id ? 'Edit skill' : 'New skill'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-4">
          <label className="block">
            <span className="text-xs text-secondary block mb-1">Name</span>
            <input value={s.name || ''} onChange={(e) => set('name', e.target.value)} className="input-field" placeholder="Invoice reminder tone" />
          </label>
          <label className="block">
            <span className="text-xs text-secondary block mb-1">Description</span>
            <input value={s.description || ''} onChange={(e) => set('description', e.target.value)} className="input-field" placeholder="How we word a payment chase" />
          </label>
          <label className="block">
            <span className="text-xs text-secondary block mb-1">Instructions</span>
            <textarea value={s.instructions || ''} onChange={(e) => set('instructions', e.target.value)} rows={10}
              className="input-field !h-auto py-2 resize-y font-mono text-2xs"
              placeholder={'First reminder is friendly and assumes an oversight.\nAlways name the invoice number and the original due date.\nNever offer a discount or a payment plan.'} />
            <span className={`text-3xs mt-1 block ${tooLong ? 'text-danger' : 'text-tertiary'}`}>
              {(s.instructions || '').length.toLocaleString()} / 20,000 characters
            </span>
          </label>
          {review && (
            <div className="rounded-md border border-subtle bg-surface-sunken p-3">
              <div className="flex items-baseline gap-2">
                <span className={`text-sm font-medium tabular-nums ${review.score >= 85 ? 'text-success' : review.score >= 45 ? 'text-warning' : 'text-danger'}`}>
                  {review.score}
                </span>
                <span className="text-2xs text-tertiary">/ 100 · how it is written, nothing has been run</span>
              </div>
              {review.notes.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {review.notes.slice(0, 4).map((n, i) => (
                    <li key={i} className="text-2xs text-secondary leading-relaxed">{n}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {s.source === 'github' && s.source_url && (
            <p className="text-2xs text-tertiary">Imported from <span className="font-mono">{s.source_url}</span></p>
          )}
        </div>
        <div className="h-14 flex items-center justify-end gap-2 px-4 border-t border-subtle sticky bottom-0 bg-surface">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={saving || !s.name?.trim() || tooLong}
            onClick={async () => { setSaving(true); await onSave(s); setSaving(false); }}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save skill
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Import previews first and saves only what the user ticks. An imported skill
 * becomes part of a system prompt, so it is shown before it is stored — the
 * route itself writes nothing.
 */
function ImportModal({ ws, privy, onClose, onDone }: { ws: string; privy: string; onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [found, setFound] = useState<SkillPreview[] | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<SkillPreview | null>(null);

  const scan = async () => {
    setBusy(true); setErr(''); setFound(null);
    try {
      const r = await importSkillsFromGithub(url);
      setFound(r.skills); setSourceUrl(r.source_url);
      setPicked(new Set(r.skills.map((s) => s.path)));
    } catch (e: any) { setErr(e.message || 'Import failed'); }
    finally { setBusy(false); }
  };

  const install = async () => {
    if (!found) return;
    setBusy(true); setErr('');
    try {
      for (const s of found.filter((x) => picked.has(x.path))) {
        const { error } = await saveSkill(privy, ws, {
          name: s.name, description: s.description, instructions: s.instructions,
          suggested_tools: s.suggested_tools, source: 'github', source_url: sourceUrl,
        });
        if (error) throw new Error(error.message || 'Could not save a skill');
      }
      onDone();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="bg-surface border border-subtle rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 flex items-center gap-2 px-4 border-b border-subtle sticky top-0 bg-surface">
          <Github className="w-4 h-4 text-secondary" />
          <h3 className="text-sm font-medium text-primary flex-1">Import skills from GitHub</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <input value={url} onChange={(e) => setUrl(e.target.value)} className="input-field flex-1"
              placeholder="github.com/owner/repo" onKeyDown={(e) => e.key === 'Enter' && url.trim() && scan()} />
            <Button variant="secondary" onClick={scan} disabled={busy || !url.trim()}>
              {/* Walks a public repo's tree looking for SKILL.md — a real
                  network crawl, not a form submit. */}
              {busy && !found ? <Thinking kind="searching" label="Scanning the repository" /> : 'Scan'}
            </Button>
          </div>
          <p className="text-2xs text-tertiary">
            Public repositories only. Looks for <span className="font-mono">SKILL.md</span> files. Nothing is saved
            until you choose — read what you install, it becomes part of your agent&apos;s instructions.
          </p>
          {/* A repo link and a subfolder link both work, and neither is obvious
              from the placeholder. Clicking fills the box rather than opening
              GitHub, because the next thing you want is to scan it. */}
          {!found && !busy && (
            <p className="text-2xs text-tertiary">
              Try{' '}
              <button type="button" onClick={() => setUrl('github.com/anthropics/skills')}
                className="font-mono text-accent hover:underline">anthropics/skills</button>
              {' '}— a subfolder works too, e.g. <span className="font-mono">…/tree/main/document-skills</span>.
            </p>
          )}

          {err && <div className="rounded-md border border-danger/30 bg-danger/5 p-2.5 text-xs text-danger">{err}</div>}

          {found && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-secondary">{found.length} skill{found.length === 1 ? '' : 's'} found</span>
                <button onClick={() => setPicked(picked.size === found.length ? new Set() : new Set(found.map((s) => s.path)))}
                  className="text-2xs text-tertiary hover:text-accent">
                  {picked.size === found.length ? 'none' : 'all'}
                </button>
              </div>
              {found.map((s) => (
                <div key={s.path} className="rounded-md border border-subtle p-2.5">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" checked={picked.has(s.path)}
                      onChange={() => setPicked((p) => { const n = new Set(p); n.has(s.path) ? n.delete(s.path) : n.add(s.path); return n; })}
                      className="mt-0.5 rounded border-strong accent-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="text-xs font-medium text-primary block truncate">{s.name}</span>
                      <span className="text-2xs text-tertiary block truncate">{s.path}</span>
                    </span>
                    <button onClick={(e) => { e.preventDefault(); setPreview(preview?.path === s.path ? null : s); }}
                      className="text-2xs text-tertiary hover:text-accent shrink-0">
                      {preview?.path === s.path ? 'hide' : 'read'}
                    </button>
                  </label>
                  {preview?.path === s.path && (
                    <pre className="mt-2 p-2 rounded bg-surface-sunken text-3xs text-secondary whitespace-pre-wrap max-h-56 overflow-y-auto">{s.instructions}</pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {found && (
          <div className="h-14 flex items-center justify-end gap-2 px-4 border-t border-subtle sticky bottom-0 bg-surface">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={install} disabled={busy || picked.size === 0}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Install {picked.size}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Describe a skill and get a draft, without leaving the workspace.
 *
 * Calls the same route the public builder uses: it writes, lints the draft
 * against every structural check, and hands the findings back to the model
 * until they are gone or the budget is spent. It runs on the workspace's own AI
 * key, so a missing key is a real and common answer and gets a link rather than
 * a shrug.
 *
 * The result opens in the editor. It is NOT saved: a generated skill becomes
 * part of a system prompt agents follow, which is exactly the kind of thing a
 * person should read once before it is real.
 */
function DescribeModal({ onClose, onDraft }: { onClose: () => void; onDraft: (d: Partial<Skill>) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const go = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await generateSkill(text.trim());
      if (r.error || !r.skill) { setErr(r.error || 'Could not write that skill.'); return; }
      onDraft(r.skill);
    } catch (e: any) {
      setErr(e?.message || 'Could not reach the server.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="bg-surface border border-subtle rounded-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 flex items-center justify-between px-4 border-b border-subtle">
          <h3 className="text-sm font-medium text-primary flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Describe a skill</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-2xs text-tertiary leading-relaxed">
            Say what it should do in your own words. It gets written, checked against every rule
            in the quality panel, and rewritten until they pass — then opens in the editor for you
            to read before it is saved.
          </p>
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={4} disabled={busy}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') go(); }}
            className="input-field !h-auto py-2 resize-y text-2xs"
            placeholder="How we handle a refund request: when to approve on the spot, when it goes to a manager, and what to say either way." />
          {err && <p className="text-2xs text-danger leading-relaxed">{err}</p>}
          <p className="text-2xs text-tertiary">Runs on your workspace AI key — set one in Account → AI keys.</p>
        </div>
        <div className="h-14 flex items-center justify-end gap-2 px-4 border-t border-subtle">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !text.trim()} onClick={go}>
            {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Writing and checking…</> : <><Sparkles className="w-3.5 h-3.5" /> Write it</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
