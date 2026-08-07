'use client';

import { useMemo, useState } from 'react';
import { Download, FileJson, FileText, Plus, Trash2, Copy, Check, AlertTriangle, Server } from 'lucide-react';
import { buildPlugin, skillSlug, pluginSlug, isValidSkillName, SPEC_VERSION, type PluginFile } from '@/lib/plugins/agent-plugin';
import { zipSync } from '@/lib/plugins/zip';

/**
 * A free Agent Plugin builder that runs ENTIRELY in the browser.
 *
 * Nothing is uploaded, nothing is stored, and there is no account — which is
 * the point of it as a free tool, and also the only honest way to offer one:
 * a skill is a system prompt, and asking people to paste their working
 * instructions into someone else's server to get a zip back is a bad trade.
 * `lib/plugins/agent-plugin.ts` and `lib/plugins/zip.ts` are both pure
 * (TextEncoder and string work, no Node APIs), so the same code that generates
 * this repo's own `plugin/` directory and the workspace export runs here.
 *
 * ONE builder, not a second implementation. If the spec's rules change, they
 * change in one file and this page, the published plugin and the export all
 * move together — a lookalike here would drift within a release and produce
 * packages that fail in a client for reasons nobody could reproduce.
 */

interface Draft { id: number; name: string; description: string; instructions: string }

let nextId = 1;
const blank = (): Draft => ({ id: nextId++, name: '', description: '', instructions: '' });

const TEMPLATES: { label: string; skill: Omit<Draft, 'id'> }[] = [
  {
    label: 'House writing style',
    skill: {
      name: 'House writing style',
      description: 'How we write to customers. Use for any outbound email, changelog entry or release note.',
      instructions: `Write the way a competent colleague talks.

- Lead with the answer, then the reason. Never the other way round.
- One idea per sentence. Cut every adverb that is not load-bearing.
- Name things exactly: "invoice 1042", not "your recent invoice".
- Never apologise for something that did not happen, and never say "we
  understand your frustration".
- If you do not know, say so and say who does.

Banned: "seamless", "leverage", "reach out", "circle back", "at your earliest
convenience", exclamation marks.`,
    },
  },
  {
    label: 'Invoice reminder tone',
    skill: {
      name: 'Invoice reminder tone',
      description: 'How this company chases an unpaid invoice. Use when writing any payment reminder, first notice through final.',
      instructions: `First reminder (1–14 days late): assume an oversight. Friendly, three
sentences, no consequences mentioned.

Second (15–30): state the invoice number, the original due date and the days
outstanding. Ask directly when it will be paid. Still no threats.

Final (30+): factual and short. State the amount, the terms that were agreed,
and what happens next according to those terms.

Always:
- Name the invoice number and the original due date.
- Attach or link the invoice itself.
- Check for a partial payment before writing — chasing the full amount after
  someone has paid most of it is the fastest way to lose them.

Never: offer a discount, offer a payment plan, or imply the debt is disputed.
Those are decisions a person makes.`,
    },
  },
  {
    label: 'Weekly numbers review',
    skill: {
      name: 'Weekly numbers review',
      description: 'How to read the week and what counts as worth flagging. Use for any recurring numbers summary or status report.',
      instructions: `Report only what moved, and say by how much against what baseline.

Rules:
- Compare to the same weekday range last week, not to a rolling average — the
  average hides a weekend.
- Never report a percentage without the absolute number underneath it. "Up 50%"
  on a base of four is noise.
- Drop the current partial period. A month three days in is not a data point.
- If a number cannot be computed, say the number is missing. Do not substitute
  a similar one and do not estimate.

Flag, in this order: anything overdue, anything that changed by more than a
third, anything that stopped moving entirely.`,
    },
  },
];

// ── Download ────────────────────────────────────────────────────────────────
// A local helper rather than reusing lib/pdf/toolkit's: that module pulls in
// pdf-lib, which is ~350KB this page has no use for.
function download(name: string, bytes: Uint8Array) {
  // Copy into a fresh ArrayBuffer: a Uint8Array view can be a window onto a
  // larger buffer, and Blob would then serialise the whole thing.
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }, () => {}); }}
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-subtle bg-surface text-secondary hover:text-primary text-2xs font-medium transition-colors">
      {done ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function PluginBuilder() {
  const [pluginName, setPluginName] = useState('my-team-skills');
  const [pluginDescription, setPluginDescription] = useState('');
  const [author, setAuthor] = useState('');
  const [withMcp, setWithMcp] = useState(false);
  const [mcpUrl, setMcpUrl] = useState('https://runbutter.app/api/mcp');
  const [skills, setSkills] = useState<Draft[]>([{ ...blank(), ...TEMPLATES[0].skill }]);
  const [open, setOpen] = useState(0);
  const [shown, setShown] = useState<string | null>(null);

  const files: PluginFile[] = useMemo(() => buildPlugin({
    manifest: {
      name: pluginName,
      version: '0.1.0',
      description: pluginDescription || undefined,
      author: author ? { name: author } : undefined,
      license: 'MIT',
    },
    // A skill with no name has no directory to live in, so it is not a file
    // yet. Filtering here rather than erroring keeps the preview live while
    // someone is halfway through typing.
    skills: skills.filter((s) => s.name.trim()),
    mcpUrl: withMcp && mcpUrl.trim() ? mcpUrl.trim() : undefined,
  }), [pluginName, pluginDescription, author, skills, withMcp, mcpUrl]);

  const active = files.find((f) => f.path === shown) || files[0];

  /**
   * Problems worth saying out loud, in the order someone hits them.
   *
   * These are spec rules, not taste: a client that reads an invalid name or an
   * empty description reports "invalid skill" and stops, with nothing pointing
   * at which of the two it was.
   */
  const notes = useMemo(() => {
    const out: string[] = [];
    const named = skills.filter((s) => s.name.trim());
    if (!named.length) out.push('Add at least one skill — a plugin with no skills installs but does nothing.');

    for (const s of named) {
      const slug = skillSlug(s.name);
      if (!isValidSkillName(slug)) out.push(`“${s.name}” cannot be turned into a valid directory name.`);
      // Only when the slug LOSES something. Warning that "House writing style"
      // becomes house-writing-style is true and useless: lowercasing and
      // hyphenating spaces is the expected, correct behaviour, and firing on
      // every ordinary title-cased name buried the warnings that matter under
      // three that did not.
      else if (slug !== s.name.trim().toLowerCase().replace(/\s+/g, '-')) {
        out.push(`“${s.name}” becomes skills/${slug}/ — names are lowercase letters, digits and single hyphens, so the rest is dropped.`);
      }
      if (!s.description.trim()) out.push(`“${s.name}” has no description. That line is what a model reads to decide whether the skill applies, so without it the skill is effectively invisible.`);
      else if (s.description.length > 1024) out.push(`“${s.name}” description is ${s.description.length} characters; the limit is 1024.`);
      // Same heuristic scripts/check-plugin.mjs applies in CI. A description
      // that says only WHAT a skill does leaves the model guessing about WHEN,
      // and getting that told to you here beats finding out from a linter
      // later — or never, because most people will never run one.
      else if (!/\buse (when|for|if)\b/i.test(s.description)) {
        out.push(`“${s.name}” describes what it does but not when to use it. Adding “Use when…” is what makes a model reach for it at the right moment.`);
      }
      if (!s.instructions.trim()) out.push(`“${s.name}” has no instructions yet.`);
      else if (s.instructions.trim().length < 40) out.push(`“${s.name}” has very little for a model to act on.`);
    }

    // buildPlugin suffixes collisions rather than dropping one, but silently.
    const slugs = named.map((s) => skillSlug(s.name));
    if (new Set(slugs).size !== slugs.length) out.push('Two skills produce the same directory name; the duplicates are numbered so nothing is lost.');

    if (pluginSlug(pluginName) !== pluginName.trim().toLowerCase().replace(/\s+/g, '-')) {
      out.push(`The plugin is named ${pluginSlug(pluginName)} in the manifest.`);
    }
    return out;
  }, [skills, pluginName]);

  const setSkill = (id: number, patch: Partial<Draft>) =>
    setSkills((xs) => xs.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const bytes = () => zipSync(files);

  return (
    <div className="grid lg:grid-cols-[1fr_1fr] gap-5 items-start">
      {/* ── Left: the form ───────────────────────────────────────────────── */}
      <div className="space-y-4 min-w-0">
        <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card p-4 sm:p-5">
          <h3 className="text-sm font-medium text-primary">Plugin</h3>
          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-secondary block mb-1">Name</span>
              <input value={pluginName} onChange={(e) => setPluginName(e.target.value)} className="input-field" placeholder="my-team-skills" />
            </label>
            <label className="block">
              <span className="text-xs text-secondary block mb-1">Author <span className="text-tertiary">(optional)</span></span>
              <input value={author} onChange={(e) => setAuthor(e.target.value)} className="input-field" placeholder="Your name" />
            </label>
          </div>
          <label className="block mt-3">
            <span className="text-xs text-secondary block mb-1">Description <span className="text-tertiary">(optional)</span></span>
            <input value={pluginDescription} onChange={(e) => setPluginDescription(e.target.value)} className="input-field" placeholder="How our team writes, bills and reports" />
          </label>

          <div className="mt-4 pt-4 border-t border-subtle">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={withMcp} onChange={(e) => setWithMcp(e.target.checked)} className="mt-0.5 rounded border-strong accent-accent" />
              <span className="min-w-0">
                <span className="text-xs font-medium text-primary flex items-center gap-1.5"><Server className="w-3.5 h-3.5" /> Include an MCP server</span>
                <span className="text-2xs text-tertiary block mt-0.5 leading-relaxed">
                  Adds <code className="font-mono">mcp.json</code> so the plugin also gives an agent tools, not just instructions.
                </span>
              </span>
            </label>
            {withMcp && (
              <>
                <input value={mcpUrl} onChange={(e) => setMcpUrl(e.target.value)} className="input-field mt-2.5 font-mono text-2xs" placeholder="https://example.com/mcp" />
                {/* Spec §7.2, and the reason there is no field for a key here. */}
                <p className="mt-2 text-2xs text-tertiary leading-relaxed">
                  No API key goes in this file. Agent Plugins {SPEC_VERSION} treats header values as visible package
                  data and forbids embedding credentials, so whoever installs the plugin supplies their own.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Skills */}
        <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card">
          <div className="flex items-center gap-2 px-4 sm:px-5 h-12 border-b border-subtle">
            <h3 className="text-sm font-medium text-primary flex-1">Skills</h3>
            <button onClick={() => { setSkills((xs) => [...xs, blank()]); setOpen(skills.length); }}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-subtle text-secondary hover:text-primary text-2xs font-medium transition-colors">
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>

          {skills.map((s, i) => (
            <div key={s.id} className="border-b border-subtle last:border-b-0">
              <div className="flex items-center gap-2 px-4 sm:px-5 h-11">
                <button onClick={() => setOpen(open === i ? -1 : i)} className="flex-1 text-left min-w-0">
                  <span className="text-xs font-medium text-primary truncate block">{s.name.trim() || 'Untitled skill'}</span>
                  {s.name.trim() && <span className="text-3xs font-mono text-tertiary">skills/{skillSlug(s.name)}/SKILL.md</span>}
                </button>
                {skills.length > 1 && (
                  <button onClick={() => { setSkills((xs) => xs.filter((x) => x.id !== s.id)); setOpen(0); }}
                    aria-label={`Remove ${s.name || 'skill'}`}
                    className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {open === i && (
                <div className="px-4 sm:px-5 pb-4 space-y-3">
                  <label className="block">
                    <span className="text-xs text-secondary block mb-1">Name</span>
                    <input value={s.name} onChange={(e) => setSkill(s.id, { name: e.target.value })} className="input-field" placeholder="Invoice reminder tone" />
                  </label>
                  <label className="block">
                    <span className="text-xs text-secondary block mb-1">
                      Description <span className="text-tertiary">— when should an agent reach for this?</span>
                    </span>
                    <input value={s.description} onChange={(e) => setSkill(s.id, { description: e.target.value })} className="input-field" placeholder="How this company chases an unpaid invoice." />
                  </label>
                  <label className="block">
                    <span className="text-xs text-secondary block mb-1">Instructions</span>
                    <textarea value={s.instructions} onChange={(e) => setSkill(s.id, { instructions: e.target.value })} rows={12}
                      className="input-field !h-auto py-2 resize-y font-mono text-2xs"
                      placeholder={'First reminder is friendly and assumes an oversight.\nAlways name the invoice number and the original due date.\nNever offer a discount or a payment plan.'} />
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xs text-tertiary">Start from:</span>
          {TEMPLATES.map((t) => (
            <button key={t.label} onClick={() => { setSkills((xs) => [...xs, { ...blank(), ...t.skill }]); setOpen(skills.length); }}
              className="h-7 px-2.5 rounded-md border border-subtle bg-surface text-secondary hover:text-primary text-2xs font-medium transition-colors">
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Right: the package as it will actually be written ────────────── */}
      <div className="lg:sticky lg:top-20 min-w-0">
        <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card overflow-hidden">
          <div className="flex items-center gap-2 px-4 h-12 border-b border-subtle bg-surface-sunken">
            <span className="text-xs font-medium text-primary flex-1 truncate">{pluginSlug(pluginName)}/</span>
            <CopyButton text={active?.content || ''} />
            <button onClick={() => download(`${pluginSlug(pluginName)}.zip`, bytes())}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-inverse text-inverse-fg text-2xs font-medium hover:opacity-90 transition-opacity">
              <Download className="w-3 h-3" /> Download
            </button>
          </div>

          <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-subtle">
            {files.map((f) => {
              const on = f.path === active?.path;
              const Icon = f.path.endsWith('.json') ? FileJson : FileText;
              return (
                <button key={f.path} onClick={() => setShown(f.path)}
                  className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-3xs font-mono transition-colors ${
                    on ? 'bg-inverse text-inverse-fg' : 'text-tertiary hover:text-primary hover:bg-surface-hover'}`}>
                  <Icon className="w-3 h-3" /> {f.path}
                </button>
              );
            })}
          </div>

          <pre className="p-4 text-2xs font-mono leading-relaxed text-secondary overflow-auto max-h-[460px] whitespace-pre-wrap break-words">
            {active?.content}
          </pre>
        </div>

        {notes.length > 0 && (
          <div className="mt-3 rounded-xl border border-subtle bg-surface-sunken p-3.5">
            <div className="flex items-center gap-1.5 mb-2">
              <AlertTriangle className="w-3.5 h-3.5 text-warning" />
              <span className="text-xs font-medium text-primary">Worth fixing before you ship</span>
            </div>
            <ul className="space-y-1.5">
              {notes.map((n) => <li key={n} className="text-2xs text-secondary leading-relaxed">{n}</li>)}
            </ul>
          </div>
        )}

        <p className="mt-3 text-2xs text-tertiary leading-relaxed">
          Everything above is built in this tab. Nothing is uploaded and nothing is stored — a skill is a
          system prompt, and pasting your working instructions into someone else&apos;s server to get a zip
          back is a bad trade.
        </p>
      </div>
    </div>
  );
}
