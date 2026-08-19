'use client';

import { useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, FileJson, Package, TriangleAlert } from 'lucide-react';
import { gaps, toDesignJson, toDesignMd, type DesignTokens } from '@/lib/design/tokens';
import { bundleName, designFiles, designSkill } from '@/lib/design/export';
import { buildPlugin } from '@/lib/plugins/agent-plugin';
import { zipSync } from '@/lib/plugins/zip';
import TokenEditor from '@/components/design/TokenEditor';
import DesignPreview from '@/components/design/DesignPreview';
import BrandIntake, { type IntakePatch } from '@/components/design/BrandIntake';

/**
 * The studio itself — intake, editor, preview, export.
 *
 * ── ONE IMPLEMENTATION, TWO PAGES ───────────────────────────────────────────
 * The signed-in screen at /design and the free public tool at /brand render
 * THIS. The in-app one adds saving and publishing to agents; the public one
 * adds marketing chrome and a localStorage draft. Nothing else differs, which
 * is the point: the moment they are two components, the public one is the one
 * nobody remembers to update — exactly what happened to the in-app skills
 * editor before it started reading the same TEMPLATES as /plugins.
 *
 * Everything here is pure browser work. lib/design/* has no Node APIs and no
 * network calls, so the whole tool runs with no account, which is what makes it
 * worth linking to at all.
 */

export default function DesignStudio({
  t, set, logoUrl, onLogo, intro, sidebar,
}: {
  t: DesignTokens;
  set: (fn: (prev: DesignTokens) => DesignTokens) => void;
  /** A logo already known to the caller — workspace branding, say. */
  logoUrl?: string | null;
  onLogo?: (url: string | null) => void;
  intro?: React.ReactNode;
  /** Anything only one of the two pages has: saving, publishing to agents. */
  sidebar?: React.ReactNode;
}) {
  const [note, setNote] = useState('');
  // The uploaded logo lives in the tab: bytes for the zip, an object URL for
  // the preview. Never persisted — a signed URL is dead before a zip is opened,
  // and a workspace logo belongs in Branding rather than duplicated here.
  const logo = useRef<{ name: string; url: string; bytes: Uint8Array } | null>(null);
  const [shownLogo, setShownLogo] = useState<string | null>(logoUrl ?? null);

  const takeLogo = (r: { name: string; url: string; bytes: Uint8Array } | null) => {
    if (logo.current?.url) URL.revokeObjectURL(logo.current.url);
    logo.current = r;
    const url = r?.url ?? logoUrl ?? null;
    setShownLogo(url);
    onLogo?.(url);
    // The token records a PATH inside the bundle, never a blob or a signed URL.
    set((p) => ({ ...p, brand: { ...p.brand, logo: r ? `assets/${r.name}` : undefined } }));
  };

  /** Merge what the intake found. A same-named colour is replaced, not doubled. */
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

  const flash = (m: string) => { setNote(m); window.setTimeout(() => setNote(''), 2500); };

  const saveZip = (bytes: Uint8Array, name: string) => {
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    // Revoking immediately cancels the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    flash('Downloaded.');
  };

  const downloadBundle = () => {
    const files = designFiles(t, logo.current ? { name: logo.current.name, bytes: logo.current.bytes } : null);
    const dir = bundleName(t);
    saveZip(zipSync(files.map((f) => ({ path: `${dir}/${f.path}`, content: f.content }))), `${dir}.zip`);
  };

  const downloadPlugin = () => {
    const name = bundleName(t);
    const files = buildPlugin({
      manifest: { name, description: `Design spec for ${t.brand.name || 'this brand'}.`, version: '1.0.0', license: 'UNLICENSED' },
      skills: [designSkill(t)],
      // DESIGN.md at the ROOT as well as inside the skill. The spec allows extra
      // files, and a coding agent looks for DESIGN.md where the code is — it
      // does not go reading a plugin's skills directory to find one.
      extraFiles: [{ path: 'DESIGN.md', content: toDesignMd(t) }],
    });
    saveZip(zipSync(files.map((f) => ({ path: `${name}/${f.path}`, content: f.content }))), `${name}-plugin.zip`);
  };

  const copy = async (text: string, what: string) => {
    await navigator.clipboard?.writeText(text);
    flash(`${what} copied.`);
  };

  const missing = useMemo(() => gaps(t), [t]);

  return (
    <div className="flex flex-col gap-4">
      <div className="card-surface p-4">
        {intro}
        <div className={intro ? 'mt-3' : ''}><BrandIntake onLogo={takeLogo} onApply={applyPatch} /></div>
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
            <div className="mt-3"><DesignPreview tokens={t} logoUrl={shownLogo} /></div>
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
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-primary flex-1">Take it away</h2>
              {note && <span className="text-2xs text-success inline-flex items-center gap-1"><Check className="w-3 h-3" />{note}</span>}
            </div>
            <p className="mt-0.5 text-2xs text-tertiary">
              Four files, four readers, one source — so they cannot disagree with each other.
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <button onClick={downloadBundle}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">
                <Download className="w-3.5 h-3.5" /> Download the bundle
              </button>
              <button onClick={() => copy(toDesignMd(t), 'DESIGN.md')}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
                <Copy className="w-3.5 h-3.5" /> DESIGN.md
              </button>
              <button onClick={() => copy(JSON.stringify(toDesignJson(t), null, 2), 'design.json')}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
                <FileJson className="w-3.5 h-3.5" /> design.json
              </button>
              <button onClick={downloadPlugin}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
                <Package className="w-3.5 h-3.5" /> Agent plugin
              </button>
            </div>
            <p className="mt-2 text-3xs text-tertiary">
              <code className="bg-surface-hover rounded px-1">DESIGN.md</code> · <code className="bg-surface-hover rounded px-1">design.json</code> ·{' '}
              <code className="bg-surface-hover rounded px-1">tokens.css</code> · <code className="bg-surface-hover rounded px-1">tailwind.tokens.js</code>{' '}
              · a README saying where each goes · your logo as bytes. The plugin zip is the Agent
              Plugins 1.0 layout: <code className="bg-surface-hover rounded px-1">skills/design/SKILL.md</code>{' '}
              plus <code className="bg-surface-hover rounded px-1">DESIGN.md</code> at the root, where Claude
              Code, Cursor and Copilot look.
            </p>
          </div>

          {sidebar}
        </div>
      </div>
    </div>
  );
}
