'use client';

import { useState } from 'react';
import { BookOpen, Plus, Trash2, Pencil, X, Loader2, Check } from 'lucide-react';
import { Github } from '@/components/ui/BrandIcons';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { useDialog } from '@/components/ui/Dialog';
import { saveSkill, deleteSkill, importSkillsFromGithub, type Skill, type SkillPreview } from '@/lib/crm/skills';
import Thinking from '@/components/ui/Thinking';

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

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-tertiary">Skills</h2>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setImporting(true)}>
            <Github className="w-3.5 h-3.5" /> Import
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing({ name: '', description: '', instructions: '', suggested_tools: [] })}>
            <Plus className="w-3.5 h-3.5" /> New skill
          </Button>
        </div>
      </div>
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
