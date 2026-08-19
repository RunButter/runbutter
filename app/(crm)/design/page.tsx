'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Check, Copy, Download, Loader2, Save, Sparkles, TriangleAlert } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import AppLoading from '@/components/ui/AppLoading';
import { getWorkspace, loadBranding, type WorkspaceContext } from '@/lib/crm/data';
import { listSkills, saveSkill } from '@/lib/crm/skills';
import { gaps, toDesignMd, type DesignTokens } from '@/lib/design/tokens';
import { loadDesign, saveDesign, seedFrom } from '@/lib/design/store';
import { bundleName, designFiles, designSkill } from '@/lib/design/export';
import { buildPlugin } from '@/lib/plugins/agent-plugin';
import { zipSync } from '@/lib/plugins/zip';
import TokenEditor from '@/components/design/TokenEditor';
import DesignPreview from '@/components/design/DesignPreview';
import BrandIntake, { type IntakePatch } from '@/components/design/BrandIntake';

/**
 * The design studio.
 *
 * ── WHY THIS IS A PRODUCT SCREEN AND NOT A DOCS PAGE ────────────────────────
 * "Write a DESIGN.md and your AI will stay on brand" is good advice that almost
 * nobody follows, because writing one means retyping values out of a PDF into
 * a format you are guessing at, with no way to tell whether it worked. Both
 * halves of that are fixable: the values can be READ out of the files that
 * already hold them, and "did it work" is a preview.
 *
 * ── THE SPEC IS THE SOURCE; EVERY FILE IS GENERATED ─────────────────────────
 * DESIGN.md, design.json, tokens.css and the Tailwind fragment all come from
 * one `DesignTokens`. Nothing is stored as text beside the values it describes,
 * because that is how a palette ends up right in one file and eighteen months
 * stale in another — the same rule /llms.txt and the sitemap follow.
 *
 * ── SAVING THE SPEC AND PUBLISHING IT TO AGENTS ARE TWO ACTS ────────────────
 * Save writes the document. "Give it to the agents" writes a SKILL, which every
 * agent in the workspace then carries into its system prompt. Deliberately
 * separate: editing a draft palette should not silently change what a
 * scheduled agent is doing at three in the morning.
 */

export default function DesignPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [t, setT] = useState<DesignTokens | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeded, setSeeded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  // The uploaded logo lives in the tab: bytes for the zip, an object URL for
  // the preview. Not persisted — a workspace logo belongs in Branding, and
  // duplicating it here would give one brand two logos that drift.
  const logo = useRef<{ name: string; url: string; bytes: Uint8Array } | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!privy) { setLoading(false); return; }
    (async () => {
      const w = await getWorkspace(privy);
      if (!w) { setLoading(false); return; }
      setWs(w);
      const [stored, branding] = await Promise.all([loadDesign(privy, w.id), loadBranding(privy, w.id)]);
      if (stored.error) setErr(stored.error);
      if (stored.saved) {
        setT(stored.tokens);
      } else {
        // Seeded from what the workspace already branded itself with, so the
        // studio opens on something correct rather than something empty.
        setT(seedFrom(branding?.name || w.name || '', branding?.accent_color));
        setSeeded(true);
      }
      if (branding?.logo_url) setLogoUrl(branding.logo_url);
      setLoading(false);
    })();
  }, [ready, privy]);

  const set = useCallback((fn: (prev: DesignTokens) => DesignTokens) => {
    setT((prev) => (prev ? fn(prev) : prev));
    setDirty(true); setNote('');
  }, []);

  const takeLogo = (r: { name: string; url: string; bytes: Uint8Array } | null) => {
    if (logo.current?.url) URL.revokeObjectURL(logo.current.url);
    logo.current = r;
    setLogoUrl(r?.url ?? null);
    // The token records a PATH inside the bundle, never a blob or signed URL:
    // both are dead the moment the file leaves this tab.
    set((p) => ({ ...p, brand: { ...p.brand, logo: r ? `assets/${r.name}` : undefined } }));
  };

  /** Merge what the intake found. Same-named colours are replaced, not doubled. */
  const applyPatch = (patch: IntakePatch) => set((p) => {
    const colors = [...p.colors];
    for (const c of patch.colors || []) {
      const i = colors.findIndex((x) => x.name === c.name);
      if (i >= 0) colors[i] = { ...colors[i], hex: c.hex };
      else colors.push(c);
    }
    return {
      ...p,
      colors,
      type: { ...p.type, ...(patch.type || {}) },
      radius: patch.radius?.length ? patch.radius : p.radius,
      rules: patch.rules
        ? {
            do: [...p.rules.do, ...patch.rules.do.filter((x) => !p.rules.do.includes(x))],
            dont: [...p.rules.dont, ...patch.rules.dont.filter((x) => !p.rules.dont.includes(x))],
          }
        : p.rules,
    };
  });

  const save = async () => {
    if (!privy || !ws || !t) return;
    setBusy('save'); setErr(''); setNote('');
    const { error } = await saveDesign(privy, ws.id, t);
    setBusy('');
    if (error) { setErr(error); return; }
    setDirty(false); setSeeded(false); setNote('Saved.');
  };

  const downloadBundle = () => {
    if (!t) return;
    const files = designFiles(t, logo.current ? { name: logo.current.name, bytes: logo.current.bytes } : null);
    const dir = bundleName(t);
    const bytes = zipSync(files.map((f) => ({ path: `${dir}/${f.path}`, content: f.content })));
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${dir}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setNote('Downloaded.');
  };

  const downloadPlugin = () => {
    if (!t) return;
    const name = bundleName(t);
    const files = buildPlugin({
      manifest: { name, description: `Design spec for ${t.brand.name || 'this brand'}.`, version: '1.0.0', license: 'UNLICENSED' },
      skills: [designSkill(t)],
      // DESIGN.md at the ROOT as well as inside the skill. Agent Plugins allows
      // extra files, and a coding agent looks for DESIGN.md where the code is —
      // it does not go reading a plugin's skills directory to find one.
      extraFiles: [{ path: 'DESIGN.md', content: toDesignMd(t) }],
    });
    const bytes = zipSync(files.map((f) => ({ path: `${name}/${f.path}`, content: f.content })));
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${name}-plugin.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setNote('Downloaded.');
  };

  const copyMd = async () => {
    if (!t) return;
    await navigator.clipboard?.writeText(toDesignMd(t));
    setNote('DESIGN.md copied.');
  };

  /** Publish to the agents. Updates the existing `design` skill rather than adding a second. */
  const publishSkill = async () => {
    if (!privy || !ws || !t) return;
    setBusy('skill'); setErr(''); setNote('');
    const existing = (await listSkills(privy, ws.id)).find((s) => /^design$/i.test(s.name));
    const s = designSkill(t);
    const { error } = await saveSkill(privy, ws.id, {
      id: existing?.id, name: 'design', description: s.description,
      instructions: s.instructions, suggested_tools: existing?.suggested_tools || [], source: 'local',
    });
    setBusy('');
    if (error) { setErr(error.message || 'Could not save the skill.'); return; }
    setNote(existing ? 'Updated the design skill — every agent carries it.' : 'Saved as a skill — every agent carries it now.');
  };

  const missing = useMemo(() => (t ? gaps(t) : []), [t]);

  if (!ready || loading) return <AppLoading />;

  if (!privy || !ws || !t) {
    return (
      <>
        <PageHeader title="Design" />
        <div className="flex-1 overflow-auto p-6">
          <div className="page-body rounded-lg ring-1 ring-subtle bg-surface-sunken p-4 text-sm text-secondary">
            Sign in to build a design spec.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Design">
        {dirty && <span className="text-2xs text-tertiary">Unsaved</span>}
        {note && !dirty && <span className="text-2xs text-success inline-flex items-center gap-1"><Check className="w-3 h-3" />{note}</span>}
        <button onClick={copyMd}
          className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
          <Copy className="w-3.5 h-3.5" /> Copy DESIGN.md
        </button>
        <button onClick={downloadBundle}
          className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
          <Download className="w-3.5 h-3.5" /> Download
        </button>
        <button onClick={save} disabled={busy === 'save'}
          className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
          {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
        </button>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-6 2xl:p-8 flex flex-col gap-4 max-w-[1600px] mx-auto w-full">
          {err && <p className="text-2xs text-danger">{err}</p>}

          <div className="card-surface p-4">
            <h2 className="text-sm font-medium text-primary">
              {seeded ? 'Start from what you already have' : 'Add to it'}
            </h2>
            <p className="mt-0.5 text-2xs text-tertiary">
              {seeded
                ? 'This is seeded from your workspace branding. Drop in a logo and your guidelines and the exact values come out of them — nothing is uploaded, it all happens in this tab.'
                : 'Upload a logo or a brand document at any time. Everything found is shown before it is applied.'}
            </p>
            <div className="mt-3"><BrandIntake onLogo={takeLogo} onApply={applyPatch} /></div>
          </div>

          <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 items-start">
            <TokenEditor t={t} set={set} />

            <div className="xl:sticky xl:top-4 flex flex-col gap-3">
              <div className="card-surface p-4">
                <h2 className="text-sm font-medium text-primary">Preview</h2>
                <p className="mt-0.5 text-2xs text-tertiary">
                  Drawn with these values and nothing else. Nine swatches in a row always look fine;
                  a button, a table and a contrast ratio are where a palette tells the truth.
                </p>
                <div className="mt-3"><DesignPreview tokens={t} logoUrl={logoUrl} /></div>
              </div>

              {!!missing.length && (
                <div className="card-surface p-4">
                  <h2 className="text-sm font-medium text-primary inline-flex items-center gap-1.5">
                    <TriangleAlert className="w-3.5 h-3.5 text-warning" /> Still missing
                  </h2>
                  <p className="mt-0.5 text-2xs text-tertiary">
                    In the order it is worth fixing. Deliberately not a score — a brand is not 78% done.
                  </p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {missing.map((g, i) => <li key={i} className="text-2xs text-secondary">• {g}</li>)}
                  </ul>
                </div>
              )}

              <div className="card-surface p-4">
                <h2 className="text-sm font-medium text-primary">Give it to the agents</h2>
                <p className="mt-0.5 text-2xs text-tertiary">
                  Saves this as a skill called <code className="bg-surface-hover rounded px-1">design</code>.
                  Every agent in the workspace carries it, so "write the launch email" and "draft the
                  invoice note" come out in your colours and your words without being told each time.
                </p>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <button onClick={publishSkill} disabled={busy === 'skill'}
                    className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
                    {busy === 'skill' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    Save as a skill
                  </button>
                  <button onClick={downloadPlugin}
                    className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
                    <Download className="w-3.5 h-3.5" /> Export as a plugin
                  </button>
                </div>
                <p className="mt-2 text-3xs text-tertiary">
                  The plugin zip is the Agent Plugins 1.0 layout — <code>skills/design/SKILL.md</code> plus{' '}
                  <code>DESIGN.md</code> at the root, which is where Claude Code, Cursor and Copilot look.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
