'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Copy, Download, FileJson } from 'lucide-react';
import DesignPreview from '@/components/design/DesignPreview';
import { toDesignJson, toDesignMd } from '@/lib/design/tokens';
import { bundleName, designFiles } from '@/lib/design/export';
import { zipSync } from '@/lib/plugins/zip';
import type { Preset } from '@/lib/design/presets';

/**
 * One style, read-only, with its file ready to copy.
 *
 * ── WHY EACH STYLE GETS ITS OWN PAGE ────────────────────────────────────────
 * Somebody searching "DESIGN.md for a landing page" is not searching for a
 * builder — they want to see one, decide in four seconds whether it is the
 * right flavour, and take the file. A gallery behind a click is invisible to
 * every crawler and every answer engine; six URLs with the real content in the
 * HTML are six answers to six different questions. Same reasoning as giving
 * each job posting its own URL rather than linking straight into the form.
 *
 * The page renders the SAME `DesignPreview` the editor does and the SAME
 * `toDesignMd` the export does, so what you see and what you copy cannot
 * disagree. "Open in the builder" hands the preset id to /brand.
 */

export default function StyleView({ preset }: { preset: Preset }) {
  const [copied, setCopied] = useState('');
  const t = preset.tokens;

  const flash = (what: string) => { setCopied(what); window.setTimeout(() => setCopied(''), 2000); };
  const copy = async (text: string, what: string) => {
    await navigator.clipboard?.writeText(text);
    flash(what);
  };

  const download = () => {
    const dir = bundleName(t);
    const files = designFiles(t, null);
    const bytes = zipSync(files.map((f) => ({ path: `${dir}/${f.path}`, content: f.content })));
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${dir}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    flash('bundle');
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => copy(toDesignMd(t), 'md')}
          className="h-9 px-4 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-inverse-fg bg-inverse hover:opacity-90">
          {copied === 'md' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied === 'md' ? 'Copied' : 'Copy DESIGN.md'}
        </button>
        <button onClick={() => copy(JSON.stringify(toDesignJson(t), null, 2), 'json')}
          className="h-9 px-4 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-primary border border-subtle bg-surface hover:bg-surface-hover">
          {copied === 'json' ? <Check className="w-4 h-4" /> : <FileJson className="w-4 h-4" />} design.json
        </button>
        <button onClick={download}
          className="h-9 px-4 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-primary border border-subtle bg-surface hover:bg-surface-hover">
          <Download className="w-4 h-4" /> Bundle
        </button>
        <Link href={`/brand?style=${preset.id}`}
          className="h-9 px-4 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-primary border border-subtle bg-surface hover:bg-surface-hover">
          Make it yours <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="rounded-2xl ring-1 ring-subtle bg-surface p-4">
        <DesignPreview tokens={t} />
      </div>

      {/* The file itself, on the page. Somebody deciding whether this is the
          right style is deciding about the FILE, and hiding it behind a copy
          button means judging a design system by a screenshot of a button. */}
      <details className="rounded-2xl ring-1 ring-subtle bg-surface-sunken overflow-hidden" open>
        <summary className="px-4 py-3 text-sm font-medium text-primary cursor-pointer select-none">
          DESIGN.md
        </summary>
        <pre className="px-4 pb-4 text-2xs font-mono text-secondary leading-relaxed overflow-x-auto whitespace-pre">
          {toDesignMd(t)}
        </pre>
      </details>
    </div>
  );
}
