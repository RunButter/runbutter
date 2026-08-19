'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import DesignStudio from '@/components/design/DesignStudio';
import { normalizeTokens, starterTokens, type DesignTokens } from '@/lib/design/tokens';

/**
 * The free studio, with nowhere to save.
 *
 * ── THE DRAFT LIVES IN THIS BROWSER AND NOWHERE ELSE ────────────────────────
 * Nobody is signed in, so there is no workspace to write to — and the draft is
 * a brand somebody is still deciding on, which is precisely the material you do
 * not post to a server to get a zip back. localStorage keeps twenty minutes of
 * work through a refresh; the copy says so plainly rather than implying a
 * backup that does not exist.
 *
 * Same component as the signed-in screen, and the whole point of that is that
 * the free version cannot quietly fall behind the paid one.
 */

const KEY = 'rb-design-draft';

export default function BrandStudioClient() {
  const [t, setT] = useState<DesignTokens>(() => starterTokens('', '#4653CE'));
  const [restored, setRestored] = useState(false);
  const loaded = useRef(false);

  // Read after mount, never during render: the server has no localStorage, and
  // seeding state from it directly is a hydration mismatch on every visit.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) { setT(normalizeTokens(JSON.parse(raw))); setRestored(true); }
    } catch { /* private mode, or somebody's extension. Not worth a message. */ }
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try { window.localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* quota or private mode */ }
  }, [t]);

  const set = useCallback((fn: (prev: DesignTokens) => DesignTokens) => setT((p) => fn(p)), []);

  const reset = () => {
    setT(starterTokens('', '#4653CE'));
    setRestored(false);
    try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
  };

  return (
    <DesignStudio
      t={t} set={set}
      intro={
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium text-primary">Start with your logo</h2>
            <p className="mt-0.5 text-2xs text-tertiary">
              The colours come straight out of it — exactly, not approximately. Add your brand PDF
              and the hex codes, fonts, sizes and rules come out of that too. Nothing is uploaded:
              the canvas reads the image and pdf.js reads the document, both in this tab.
              {restored ? ' Your last draft was restored from this browser.' : ' Your work is kept in this browser only — download the bundle to keep it.'}
            </p>
          </div>
          <button onClick={reset}
            className="h-7 px-2 shrink-0 inline-flex items-center gap-1 rounded-md text-2xs font-semibold text-tertiary ring-1 ring-subtle hover:bg-surface-hover">
            <RotateCcw className="w-3 h-3" /> Start over
          </button>
        </div>
      }
    />
  );
}
