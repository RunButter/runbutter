'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, FileJson, FileText, Plus, Trash2, Copy, Check, ChevronDown, Server, FolderPlus, ShieldAlert, Upload, Sparkles, Loader2 } from 'lucide-react';
import { buildPlugin, skillSlug, pluginSlug, isValidSkillName, parseToolList, resourcePath, SPEC_VERSION, type PluginFile } from '@/lib/plugins/agent-plugin';
import { zipSync } from '@/lib/plugins/zip';
import { lintProject, measureFiles, type LintCategory } from '@/lib/plugins/lint';
import { scoreProject, type CategoryScore } from '@/lib/plugins/quality';
import { unzip } from '@/lib/plugins/unzip';
import { importPlugin } from '@/lib/plugins/import';
import { RESOURCE_PRESETS, BODY_SCAFFOLD, TEMPLATES, type TemplateResource } from '@/lib/plugins/templates';
import { PLATFORMS, platformById, losses, type PlatformId, type BuildInput } from '@/lib/plugins/platforms';
import BorderBeam from '@/components/ui/BorderBeam';

/**
 * A free Agent Plugin builder that runs ENTIRELY in the browser.
 *
 * Nothing is uploaded, nothing is stored, and there is no account — which is
 * the point of it as a free tool, and also the only honest way to offer one:
 * a skill is a system prompt, and asking people to paste their working
 * instructions into someone else's server to get a zip back is a bad trade.
 *
 * `lib/plugins/agent-plugin.ts` and `lib/plugins/zip.ts` are both pure
 * (TextEncoder and string work, no Node APIs), so the same code that generates
 * this repo's own `plugin/` directory and the workspace export runs here.
 *
 * "Describe it" is the single exception, and it is opt-in by definition: you
 * have to type something and press a button. It posts one description, needs an
 * account, and runs on the user's own AI key. The finished skill still never
 * leaves the tab.
 *
 * ONE builder, not a second implementation. If the spec's rules change, they
 * change in one file and this page, the published plugin and the export all
 * move together — a lookalike here would drift within a release and produce
 * packages that fail in a client for reasons nobody could reproduce.
 */

type Res = TemplateResource;
interface Draft {
  id: number; name: string; description: string; instructions: string;
  whenToUse: string; allowedTools: string; resources: Res[];
}

let nextId = 1;
const blank = (): Draft => ({
  id: nextId++, name: '', description: '', instructions: '',
  whenToUse: '', allowedTools: '', resources: [],
});

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

/**
 * One category row: the bar, the number, and the reasons behind it.
 *
 * The reasons are behind a click rather than always open. Eight categories with
 * every finding expanded is a page of red text that reads as "this is broken"
 * whatever the score says, and the thing someone needs first is which ONE of the
 * eight is dragging the number down.
 */
function ScoreRow({ c, open, onToggle }: { c: CategoryScore; open: boolean; onToggle: () => void }) {
  // Colour carries no information the number doesn't; it is there so the eye
  // lands on the low row first. The amber band is wide because a single missing
  // thing costs 40 points — at a 70 cutoff every ordinary gap came out red, and
  // eight red bars say "this is broken" about a package that is merely
  // improvable.
  const tone = c.score >= 85 ? 'bg-success' : c.score >= 45 ? 'bg-warning' : 'bg-danger';
  return (
    <div>
      <button onClick={onToggle} aria-expanded={open}
        className="w-full flex items-center gap-3 h-8 text-left group">
        <ChevronDown className={`w-3 h-3 text-tertiary shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
        <span className="text-2xs text-secondary group-hover:text-primary transition-colors w-[104px] shrink-0">{c.label}</span>
        <span className="flex-1 h-1 rounded-full bg-surface-sunken overflow-hidden">
          <span className={`block h-full rounded-full ${tone}`} style={{ width: `${c.score}%` }} />
        </span>
        <span className="text-2xs font-mono text-secondary w-7 text-right shrink-0">{c.score}</span>
      </button>
      {open && (
        <ul className="pl-[124px] pr-1 pb-2 space-y-1">
          {c.reasons.map((r, i) => (
            <li key={i} className="text-2xs text-tertiary leading-relaxed">{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PluginBuilder() {
  const [pluginName, setPluginName] = useState('my-team-skills');
  const [pluginDescription, setPluginDescription] = useState('');
  const [author, setAuthor] = useState('');
  const [withMcp, setWithMcp] = useState(false);
  // On by default: it is one small file and it is the difference between "here
  // is a zip, put it somewhere" and a one-line install.
  const [platform, setPlatform] = useState<PlatformId>('agent-plugin');
  const [mcpUrl, setMcpUrl] = useState('https://runbutter.app/api/mcp');
  const [skills, setSkills] = useState<Draft[]>([{ ...blank(), ...TEMPLATES[0].skill }]);
  const [open, setOpen] = useState(0);
  const [shown, setShown] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [importNote, setImportNote] = useState('');
  // `undefined` means nobody has chosen, so the weakest category opens itself —
  // which is the one row worth reading. Once a row is clicked the choice sticks,
  // rather than the panel reshuffling under the cursor on the next keystroke.
  const [pinnedCat, setPinnedCat] = useState<LintCategory | null | undefined>(undefined);

  // ── Describe it ───────────────────────────────────────────────────────────
  // The one thing on this page that leaves the browser, and the one thing that
  // needs an account. It runs on the user's own AI key — RunButter charges
  // nothing for tokens — which is exactly why it cannot be anonymous: there is
  // no key to run it with until somebody has saved one.
  //
  // NO PRIVY SDK HERE, deliberately. `usePrivy()` costs 487 KB of JavaScript on
  // a public page most visitors will never sign in on, to answer a question the
  // server can answer for free: the route reads the signed cookie, and a 401
  // comes back with `signin: true`. So the button is always live, the signed-in
  // case works on the first click, and everyone else pays nothing for the
  // feature they are not using.
  const [ask, setAsk] = useState('');
  const [thinking, setThinking] = useState(false);
  const [genNote, setGenNote] = useState('');
  const [genError, setGenError] = useState('');
  const [needsSignin, setNeedsSignin] = useState(false);

  // One project, described once. The chosen platform decides the LAYOUT and
  // nothing else — which is the whole point of keeping adapters in one file
  // instead of scattering `if (target === …)` through the builder.
  const project: BuildInput = useMemo(() => ({
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
    skills: skills.filter((s) => s.name.trim()).map((s) => ({
      name: s.name,
      description: s.description,
      instructions: s.instructions,
      when_to_use: s.whenToUse,
      allowed_tools: parseToolList(s.allowedTools),
      resources: s.resources,
    })),
    mcpUrl: withMcp && mcpUrl.trim() ? mcpUrl.trim() : undefined,
  }), [pluginName, pluginDescription, author, skills, withMcp, mcpUrl]);

  const files: PluginFile[] = useMemo(
    () => platformById(platform).build(project), [platform, project]);
  const dropped = useMemo(() => losses(platform, project), [platform, project]);

  const active = files.find((f) => f.path === shown) || files[0];

  // The path shown beside a skill comes from the FILES, not from a second copy
  // of the prefix rule. Project skills live under .claude/skills/, and a hint
  // that says otherwise is a small lie people act on.
  const pathOf = (name: string) => {
    const slug = skillSlug(name);
    return files.find((f) => f.path.endsWith(`/${slug}/SKILL.md`))?.path || `skills/${slug}/SKILL.md`;
  };


  /**
   * Everything checkable, in one pass.
   *
   * The linter runs over the project AND over the generated files, so the
   * credential scan covers anything that reaches the package — instructions,
   * descriptions, every supporting file, the manifest and mcp.json — without
   * this component needing to know which fields exist.
   */
  const { findings, secrets } = useMemo(() => lintProject(project, files), [project, files]);

  /**
   * The two token figures worth telling someone apart.
   *
   * SKILL.md is read in full every time the skill fires; a supporting file is
   * read only when the model decides it needs it. Reporting one total would hide
   * the entire reason supporting files exist — 8k tokens sitting in a reference
   * costs nothing on the runs that never open it, and 8k in the body costs it
   * every single time.
   */
  const report = useMemo(
    () => scoreProject(findings, { skillCount: project.skills.length, ...measureFiles(files) }),
    [findings, files, project.skills.length],
  );

  // Re-arm the gate whenever the findings change. Without this, waving through
  // one deliberate placeholder would leave the download unblocked for a REAL
  // key pasted a minute later — an override that outlives what it was granted
  // for is worse than no gate, because it looks like one.
  const secretSig = secrets.map((f) => `${f.where}:${f.preview}`).join('|');
  useEffect(() => { setOverride(false); }, [secretSig]);

  /**
   * Load dropped files into the editor.
   *
   * REPLACES the project rather than merging into it. Merging sounds friendlier
   * and produces a silent mess — two manifests, duplicate skill names, an mcp
   * url from one and a description from the other — with no undo. Replacing is
   * one obvious thing, and the previous state is still on disk in whatever the
   * user just dropped.
   */
  async function takeFiles(list: FileList | null) {
    const picked = Array.from(list || []);
    if (!picked.length) return;
    setImportNote('Reading…');
    try {
      const entries: { path: string; content: string }[] = [];
      for (const f of picked) {
        if (/\.zip$/i.test(f.name)) {
          entries.push(...(await unzip(await f.arrayBuffer())));
        } else {
          // webkitRelativePath is set when a whole FOLDER is chosen, and it is
          // the only way to learn the directory a SKILL.md sat in — which is
          // the skill's name. Without it every file looks top-level.
          const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
          entries.push({ path: rel || f.name, content: await f.text() });
        }
      }
      if (!entries.length) return setImportNote('Nothing readable in that.');

      const p = importPlugin(entries);
      if (!p.skills.length) {
        return setImportNote('No SKILL.md found. A skill is a directory containing one.');
      }

      if (p.name) setPluginName(p.name);
      if (p.description) setPluginDescription(p.description);
      if (p.author) setAuthor(p.author);
      setWithMcp(!!p.mcpUrl);
      if (p.mcpUrl) setMcpUrl(p.mcpUrl);
      setPlatform(p.hadMarketplace ? 'claude-marketplace' : 'agent-plugin');
      setSkills(p.skills.map((s) => ({ ...blank(), ...s })));
      setOpen(0);
      setShown(null);
      setImportNote(
        `Loaded ${p.skills.length} skill${p.skills.length === 1 ? '' : 's'}` +
        (p.ignored.length ? ` — ${p.ignored.length} other file${p.ignored.length === 1 ? '' : 's'} ignored.` : '.'),
      );
    } catch (e: any) {
      // A corrupt archive is the user's problem to see, not something to
      // swallow into a dead drop zone.
      setImportNote(e?.message || 'Could not read that file.');
    }
  }

  const worstCat = useMemo(() => {
    const weak = report.categories.filter((c) => c.score < 100);
    if (!weak.length) return null;
    // Ties broken by weight: at equal scores the category that moves the total
    // most is the one worth opening.
    return weak.sort((a, b) => a.score - b.score || b.weight - a.weight)[0].category;
  }, [report]);
  const openCat = pinnedCat === undefined ? worstCat : pinnedCat;
  const setOpenCat = (c: LintCategory | null) => setPinnedCat(c);

  /**
   * Generate a skill and ADD it — never replace what is already there.
   *
   * A generator that overwrites the editor is one mis-click away from deleting
   * something somebody wrote, in a tool with no undo and no save. Appending
   * costs a scroll and loses nothing.
   */
  async function generate() {
    const text = ask.trim();
    if (!text || thinking) return;
    setThinking(true); setGenError(''); setGenNote(''); setNeedsSignin(false);
    try {
      const res = await fetch('/api/plugins/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.skill) {
        setGenError(body?.error || 'Could not write that skill.');
        setNeedsSignin(!!body?.signin);
        return;
      }
      const s = body.skill;
      setSkills((xs) => [...xs, {
        ...blank(),
        name: s.name, description: s.description, instructions: s.instructions,
        whenToUse: s.whenToUse || '', allowedTools: '',
        resources: (s.resources || []).map((r: any) => ({ path: r.path, purpose: r.purpose, content: r.content })),
      }]);
      setOpen(skills.length);
      setAsk('');
      // Say how many passes it took and what it could not fix. A loop that
      // silently gave up after three attempts, reported as a clean success,
      // would be the same lie as a score that ignores its own findings.
      const passes = body.attempts > 1 ? ` after ${body.attempts} passes` : '';
      setGenNote((body.remaining || []).length
        ? `Written${passes}, with ${body.remaining.length} thing${body.remaining.length === 1 ? '' : 's'} it could not fix — see the score below.`
        : `Written${passes}. Nothing left that can be checked without running it.`);
    } catch (e: any) {
      setGenError(e?.message || 'Could not reach the server.');
    } finally { setThinking(false); }
  }

  const setSkill = (id: number, patch: Partial<Draft>) =>
    setSkills((xs) => xs.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const bytes = () => zipSync(files);

  return (
    <div className="grid lg:grid-cols-[1fr_1fr] gap-6 xl:gap-10 items-start">
      {/* ── Left: the form ───────────────────────────────────────────────── */}
      <div className="space-y-6 min-w-0">
        <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card p-5 sm:p-6">
          <h3 className="text-sm font-medium text-primary">Plugin</h3>
          <div className="mt-4 grid sm:grid-cols-2 gap-4">
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

          {/* ── Target ────────────────────────────────────────────────────
              Two checkboxes asked people to know what a marketplace manifest
              is. A target asks what they are actually trying to do. */}
          <div className="mt-6 pt-6 border-t border-subtle">
            <span className="text-xs text-secondary block mb-2.5">Build for</span>
            <div className="grid sm:grid-cols-2 gap-2">
              {PLATFORMS.map((pf) => {
                const on = pf.id === platform;
                const card = (
                  <button type="button" onClick={() => setPlatform(pf.id)} aria-pressed={on}
                    className={`w-full h-full text-left rounded-xl p-3 transition-colors ${
                      on ? 'bg-surface ring-1 ring-strong' : 'bg-surface-sunken/60 hover:bg-surface-hover'}`}>
                    <span className="text-xs font-medium text-primary block">{pf.label}</span>
                    <span className="text-2xs text-tertiary block mt-0.5 leading-relaxed">{pf.blurb}</span>
                  </button>
                );
                // The beam marks the ACTIVE target only. Every card glowing at
                // once would be decoration; one is a pointer.
                return on
                  ? <BorderBeam key={pf.id} size="sm" colorVariant="ocean" strength={0.7}>{card}</BorderBeam>
                  : <div key={pf.id}>{card}</div>;
              })}
            </div>
            <p className="mt-2.5 text-2xs text-tertiary leading-relaxed">{platformById(platform).notes}</p>

            <label className="flex items-center gap-2.5 cursor-pointer mt-5 pt-5 border-t border-subtle">
              <input type="checkbox" checked={withMcp} onChange={(e) => setWithMcp(e.target.checked)} className="rounded border-strong accent-accent" />
              <span className="text-xs font-medium text-primary flex items-center gap-1.5"><Server className="w-3.5 h-3.5" /> Bring an MCP server</span>
            </label>
            {withMcp && (
              <>
                <input value={mcpUrl} onChange={(e) => setMcpUrl(e.target.value)} className="input-field mt-2.5 font-mono text-2xs" placeholder="https://example.com/mcp" />
                {/* Spec §7.2, and the reason there is no field for a key here. */}
                <p className="mt-2 text-2xs text-tertiary leading-relaxed">
                  No API key goes in this file — the spec forbids it. Whoever installs supplies their own.
                </p>
              </>
            )}
          </div>
        </div>

        {/* ── Describe it ──────────────────────────────────────────────────
            Not a wrapper around a prompt. The draft is linted before it is
            returned and the findings go back to the model as the next
            instruction, so what lands here has an output contract, a worked
            example and a failure path — the three things a first attempt
            reliably lacks. */}
        <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card p-5 sm:p-6">
          <h3 className="text-sm font-medium text-primary flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Describe it
          </h3>
          <p className="mt-1.5 text-2xs text-tertiary leading-relaxed">
            Say what the skill should do in your own words. It gets written, checked against every
            rule in the panel opposite, and rewritten until they pass — then it lands in the editor
            for you to read.
          </p>

          <textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={3}
            disabled={thinking}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') generate(); }}
            className="input-field !h-auto py-2 mt-3 resize-y text-2xs"
            placeholder="How we handle a refund request: when to approve one on the spot, when it goes to a manager, and what to say either way." />

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button onClick={generate} disabled={!ask.trim() || thinking}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-inverse text-inverse-fg text-2xs font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed">
              {thinking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {thinking ? 'Writing and checking…' : 'Write it'}
            </button>
            <span className="text-2xs text-tertiary leading-relaxed">
              Needs a free account and your own AI key — we never charge for tokens.
            </span>
          </div>

          {genError && (
            <p className="mt-2.5 text-2xs text-danger leading-relaxed">
              {genError}
              {needsSignin && (
                <>
                  {' '}
                  {/* No ?next= — /auth/login does not read one, and a link that
                      quietly ignores half of itself is worse than a plain one. */}
                  <a href="/auth/login" className="underline underline-offset-2 hover:text-primary">Sign in</a>
                </>
              )}
            </p>
          )}
          {genNote && <p className="mt-2.5 text-2xs text-secondary leading-relaxed">{genNote}</p>}
        </div>

        {/* Skills */}
        <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card">
          <div className="flex items-center gap-2 px-5 sm:px-6 h-14 border-b border-subtle">
            <h3 className="text-sm font-medium text-primary flex-1">Skills</h3>
            <button onClick={() => { setSkills((xs) => [...xs, blank()]); setOpen(skills.length); }}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-subtle text-secondary hover:text-primary text-2xs font-medium transition-colors">
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>

          {skills.map((s, i) => (
            <div key={s.id} className="border-b border-subtle last:border-b-0">
              <div className="flex items-center gap-3 px-5 sm:px-6 h-12">
                <button onClick={() => setOpen(open === i ? -1 : i)} className="flex-1 text-left min-w-0">
                  <span className="text-xs font-medium text-primary truncate block">{s.name.trim() || 'Untitled skill'}</span>
                  {s.name.trim() && <span className="text-3xs font-mono text-tertiary">{pathOf(s.name)}</span>}
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
                <div className="px-5 sm:px-6 pb-6 pt-1 space-y-4">
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
                  {/* NOT a <label> wrapper, because this row holds a button.
                      A <button> inside a <label> is folded into the field's
                      accessible name ("Instructions + structure") and a click
                      on it is also forwarded to the labelled control. htmlFor
                      keeps the association without nesting. */}
                  <div className="block">
                    <div className="text-xs text-secondary mb-1 flex items-center gap-2">
                      <label htmlFor={`instr-${s.id}`}>Instructions</label>
                      {/* Appends rather than replaces, and only offers itself
                          when the body does not already have the headings —
                          silently overwriting somebody's written skill because
                          they mis-clicked is unforgivable in a tool with no
                          undo. */}
                      {!/^##\s/m.test(s.instructions) && (
                        <button type="button"
                          onClick={() => setSkill(s.id, { instructions: (s.instructions.trim() ? s.instructions.trimEnd() + '\n\n' : '') + BODY_SCAFFOLD })}
                          className="ml-auto h-6 px-2 rounded-md border border-subtle text-2xs font-medium text-secondary hover:text-primary transition-colors">
                          + structure
                        </button>
                      )}
                    </div>
                    <textarea id={`instr-${s.id}`} value={s.instructions} onChange={(e) => setSkill(s.id, { instructions: e.target.value })} rows={12}
                      className="input-field !h-auto py-2 resize-y font-mono text-2xs"
                      placeholder={'First reminder is friendly and assumes an oversight.\nAlways name the invoice number and the original due date.\nNever offer a discount or a payment plan.'} />
                  </div>

                  {/* ── Supporting files ───────────────────────────────────
                      The difference between a long prompt and a skill. These
                      are read only when the model decides it needs them, so
                      they can be as long as the material actually is without
                      costing anything on the runs that don't touch them. */}
                  <div className="pt-4 border-t border-subtle">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-primary flex items-center gap-1.5">
                        <FolderPlus className="w-3.5 h-3.5" /> Supporting files
                      </span>
                      <span className="ml-auto flex gap-1.5">
                        {RESOURCE_PRESETS.map((r) => (
                          <button key={r.label} type="button"
                            disabled={s.resources.some((x) => x.path === r.res.path)}
                            onClick={() => setSkill(s.id, { resources: [...s.resources, { ...r.res }] })}
                            className="h-6 px-2 rounded-md border border-subtle text-2xs font-mono text-secondary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                            + {r.label}
                          </button>
                        ))}
                      </span>
                    </div>
                    <p className="mt-1.5 text-2xs text-tertiary leading-relaxed">
                      Read only when needed, not on every run — so the long material lives here and the
                      instructions above stay short. SKILL.md lists them automatically, which is what tells
                      the model when to open one.
                    </p>

                    {s.resources.map((r, ri) => (
                      <div key={ri} className="mt-2.5 rounded-lg border border-subtle p-2.5">
                        <div className="flex items-center gap-2">
                          <input value={r.path}
                            onChange={(e) => setSkill(s.id, { resources: s.resources.map((x, n) => n === ri ? { ...x, path: e.target.value } : x) })}
                            className="input-field !h-7 font-mono text-2xs flex-1" placeholder="reference.md" />
                          <button type="button" aria-label={`Remove ${r.path}`}
                            onClick={() => setSkill(s.id, { resources: s.resources.filter((_, n) => n !== ri) })}
                            className="p-1 rounded-md text-tertiary hover:text-danger hover:bg-danger/10 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <input value={r.purpose}
                          onChange={(e) => setSkill(s.id, { resources: s.resources.map((x, n) => n === ri ? { ...x, purpose: e.target.value } : x) })}
                          className="input-field !h-7 text-2xs mt-1.5" placeholder="What is in it, and when should it be read?" />
                        <textarea value={r.content} rows={6}
                          onChange={(e) => setSkill(s.id, { resources: s.resources.map((x, n) => n === ri ? { ...x, content: e.target.value } : x) })}
                          className="input-field !h-auto py-2 mt-1.5 resize-y font-mono text-2xs" />
                      </div>
                    ))}
                  </div>

                  {/* ── Optional frontmatter ───────────────────────────────── */}
                  <div className="pt-4 border-t border-subtle space-y-3">
                    <label className="block">
                      <span className="text-xs text-secondary block mb-1">
                        When to use <span className="text-tertiary">— optional, trigger phrases</span>
                      </span>
                      <input value={s.whenToUse} onChange={(e) => setSkill(s.id, { whenToUse: e.target.value })}
                        className="input-field" placeholder="When the user asks to chase a payment, or mentions an overdue invoice." />
                    </label>
                    <label className="block">
                      <span className="text-xs text-secondary block mb-1">
                        Pre-approved tools <span className="text-tertiary">— optional</span>
                      </span>
                      <input value={s.allowedTools} onChange={(e) => setSkill(s.id, { allowedTools: e.target.value })}
                        className="input-field font-mono text-2xs" placeholder="Read Grep" />
                      {/* Unlike a "suggested tools" hint, this one is real. */}
                      <span className="text-2xs text-tertiary block mt-1 leading-relaxed">
                        A real grant, not a hint: these run without asking during the turn the skill fires.
                        Leave empty and every tool still asks.
                      </span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── Bring what you already have ─────────────────────────────────
            The builder could only create, which made it useless to anyone with
            existing skills — i.e. everyone worth reaching. Drop a zip or a
            folder and it loads into the editor; export closes the loop. */}
        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); takeFiles(e.dataTransfer.files); }}
          className={`block rounded-xl border border-dashed p-4 text-center cursor-pointer transition-colors ${
            dragging ? 'border-accent bg-accent/5' : 'border-strong hover:bg-surface-hover'}`}>
          <input type="file" multiple accept=".zip,.md,.json" className="sr-only"
            onChange={(e) => { takeFiles(e.target.files); e.target.value = ''; }} />
          <span className="text-xs font-medium text-primary flex items-center justify-center gap-1.5">
            <Upload className="w-3.5 h-3.5" /> Import a plugin
          </span>
          <span className="text-2xs text-tertiary block mt-1 leading-relaxed">
            Drop a <span className="font-mono">.zip</span> or a folder of{' '}
            <span className="font-mono">SKILL.md</span> files. A repo download, a{' '}
            <span className="font-mono">.claude/skills/</span> folder or a single file all work.
          </span>
          {importNote && <span className="text-2xs text-secondary block mt-2">{importNote}</span>}
        </label>

        <div className="flex flex-wrap items-center gap-2 pt-1">
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
            {/* Blocked while a credential is in the package. This is the one
                gate worth having: the output is a directory people commit and
                push, and a key deleted in a later commit is still readable in
                the one that added it. Overridable, because a skill teaching
                someone what a key LOOKS like is legitimate and a tool that
                cannot be argued with gets worked around instead. */}
            <button
              onClick={() => download(`${pluginSlug(pluginName)}.zip`, bytes())}
              disabled={secrets.length > 0 && !override}
              title={secrets.length > 0 && !override ? 'A credential was found in this package' : undefined}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-inverse text-inverse-fg text-2xs font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed">
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

        {secrets.length > 0 && (
          <div className="mt-3 rounded-xl border border-danger/40 bg-danger/5 p-3.5">
            <div className="flex items-center gap-1.5 mb-1">
              <ShieldAlert className="w-3.5 h-3.5 text-danger" />
              <span className="text-xs font-medium text-primary">
                {secrets.length === 1 ? 'A credential is in this package' : `${secrets.length} credentials are in this package`}
              </span>
            </div>
            <p className="text-2xs text-secondary leading-relaxed">
              A plugin is a folder people commit and push. Once this is in a repository it stays readable in
              that commit even after a later one removes it — so rotate anything real that got this far.
            </p>
            <ul className="mt-2.5 space-y-1.5">
              {secrets.slice(0, 8).map((f, i) => (
                <li key={i} className="text-2xs text-secondary flex flex-wrap items-baseline gap-x-1.5">
                  <span className="font-medium text-primary">{f.label}</span>
                  <span className="font-mono text-tertiary">{f.where}</span>
                  {/* Redacted: enough to locate, never enough to use. */}
                  <span className="font-mono text-danger">{f.preview}</span>
                </li>
              ))}
              {secrets.length > 8 && <li className="text-2xs text-tertiary">…and {secrets.length - 8} more.</li>}
            </ul>
            {!override && (
              <button onClick={() => setOverride(true)}
                className="mt-2.5 text-2xs text-tertiary hover:text-primary underline underline-offset-2">
                These are placeholders — let me download anyway
              </button>
            )}
            {override && <p className="mt-2.5 text-2xs text-tertiary">Download unblocked for this session.</p>}
          </div>
        )}

        {/* ── The score ───────────────────────────────────────────────────
            Deliberately below the package rather than above it: the files are
            what someone came for, and a report card at the top of the page
            would read as a gate. */}
        <div className="mt-3 rounded-xl bg-surface ring-1 ring-subtle shadow-card p-4 sm:p-5">
          <div className="flex items-baseline gap-2.5">
            <span className="text-2xl font-medium text-primary tabular-nums leading-none">{report.overall}</span>
            <span className="text-2xs text-tertiary">/ 100</span>
            <span className="ml-auto text-2xs text-tertiary">Quality</span>
          </div>
          <p className="mt-1.5 text-2xs text-secondary leading-relaxed">{report.verdict}</p>

          <div className="mt-3.5 pt-1 border-t border-subtle">
            {report.categories.map((c) => (
              <ScoreRow key={c.category} c={c} open={openCat === c.category}
                onToggle={() => setOpenCat(openCat === c.category ? null : c.category)} />
            ))}
          </div>

          {/* The one measurement on this page, and it is an estimate — said so
              here rather than in a tooltip nobody opens. */}
          <p className="mt-3 pt-3 border-t border-subtle text-2xs text-tertiary leading-relaxed">
            ≈{report.tokensPerRun.toLocaleString('en-US')} tokens load every time a skill fires
            {report.tokensOnDemand > 0 && <>, ≈{report.tokensOnDemand.toLocaleString('en-US')} more only when the model opens a supporting file</>}.
            {' '}Estimated from length, not counted with a tokenizer.
          </p>
          <p className="mt-1.5 text-2xs text-tertiary leading-relaxed">
            This scores how the skill is <em>written</em> — nothing has been run.
          </p>
        </div>

        {dropped.length > 0 && (
          <div className="mt-3 rounded-xl border border-subtle bg-surface-sunken p-3.5">
            <span className="text-xs font-medium text-primary block mb-1.5">{platformById(platform).label}</span>
            <ul className="space-y-1">
              {dropped.map((d) => <li key={d} className="text-2xs text-secondary leading-relaxed">{d}</li>)}
            </ul>
            <p className="mt-2 text-2xs text-tertiary">{platformById(platform).install}</p>
          </div>
        )}


      </div>
    </div>
  );
}
