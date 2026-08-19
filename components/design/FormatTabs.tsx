'use client';

import { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import DesignPreview from '@/components/design/DesignPreview';
import { toDesignJson, toDesignMd, type DesignTokens } from '@/lib/design/tokens';
import { bundleName, designFiles, tailwindFragment, tailwindV4, tokensCss } from '@/lib/design/export';
import { zipSync } from '@/lib/plugins/zip';

/**
 * The same spec, in whichever format the reader's stack wants.
 *
 * ── A DOWNLOAD IS THE WRONG UNIT ────────────────────────────────────────────
 * Somebody deciding whether a style is right for them is deciding about the
 * FILE, and asking them to download a zip to find out is asking them to commit
 * before they can look. It also loses the person who does not want the bundle
 * at all — they want one of the five formats, on the clipboard, now, and they
 * know which one before they arrive.
 *
 * ── EVERY TAB IS GENERATED FROM ONE `DesignTokens` ──────────────────────────
 * So the CSS and the markdown and the Tailwind cannot disagree with the
 * preview, which is the failure that makes most design-token exports untrusted:
 * a picture, and a file, kept in step by somebody remembering to.
 *
 * Two Tailwind tabs on purpose. v4 is CSS-first and NEVER READS a JS config, so
 * handing a v4 project a `tailwind.config.js` produces no error and no
 * utilities — the worst possible failure for a file whose whole job is to be
 * pasted somewhere and work.
 */

type Tab = 'preview' | 'md' | 'v4' | 'css' | 'json' | 'v3';

const TABS: { id: Tab; label: string }[] = [
  { id: 'preview', label: 'Preview' },
  { id: 'md', label: 'DESIGN.md' },
  { id: 'v4', label: 'Tailwind v4' },
  { id: 'css', label: 'CSS Variables' },
  { id: 'json', label: 'design.json' },
  { id: 'v3', label: 'Tailwind v3' },
];

export default function FormatTabs({ tokens, logoUrl, initial = 'preview' }: {
  tokens: DesignTokens; logoUrl?: string | null; initial?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initial);
  const [copied, setCopied] = useState(false);

  const text = (t: Tab): string => {
    switch (t) {
      case 'md': return toDesignMd(tokens);
      case 'v4': return tailwindV4(tokens);
      case 'css': return tokensCss(tokens);
      case 'json': return JSON.stringify(toDesignJson(tokens), null, 2);
      case 'v3': return tailwindFragment(tokens);
      default: return '';
    }
  };

  const copy = async () => {
    await navigator.clipboard?.writeText(text(tab));
    setCopied(true); window.setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    const dir = bundleName(tokens);
    const bytes = zipSync(designFiles(tokens, null).map((f) => ({ path: `${dir}/${f.path}`, content: f.content })));
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${dir}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        {TABS.map((x) => (
          <button key={x.id} onClick={() => setTab(x.id)}
            className={`h-9 px-4 rounded-full text-sm font-medium transition-colors ${tab === x.id
              ? 'bg-inverse text-inverse-fg'
              : 'text-secondary ring-1 ring-subtle hover:bg-surface-hover'}`}>
            {x.label}
          </button>
        ))}
        <span className="flex-1" />
        {tab === 'preview' ? (
          <button onClick={download}
            className="h-9 px-4 inline-flex items-center gap-1.5 rounded-full text-sm font-medium text-secondary ring-1 ring-subtle hover:bg-surface-hover">
            <Download className="w-4 h-4" /> All files
          </button>
        ) : (
          <button onClick={copy}
            className="h-9 px-4 inline-flex items-center gap-1.5 rounded-full text-sm font-medium text-secondary ring-1 ring-subtle hover:bg-surface-hover">
            {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>

      {tab === 'preview' ? (
        <DesignPreview tokens={tokens} logoUrl={logoUrl} />
      ) : (
        <pre className="rounded-xl ring-1 ring-subtle bg-surface-sunken p-4 text-2xs font-mono text-secondary leading-relaxed overflow-x-auto max-h-[36rem] overflow-y-auto whitespace-pre">
          {text(tab)}
        </pre>
      )}
    </div>
  );
}
