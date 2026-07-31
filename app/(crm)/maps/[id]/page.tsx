'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { loadMindMap, saveMindMap, type MindMapGraph } from '@/lib/crm/mindmaps';

// React Flow measures the DOM on mount and has no server rendering to do, so
// prerendering it only costs a hydration pass and risks a window reference
// during SSR. Loaded on the client, with a placeholder that holds the height so
// the page doesn't jump when it arrives.
const MindMapCanvas = dynamic(() => import('@/components/crm/MindMapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center text-tertiary">
      <Loader2 className="w-6 h-6 animate-spin" />
    </div>
  ),
});

const AUTOSAVE_MS = 1200;

export default function MindMapPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const { id } = useParams<{ id: string }>();

  const [title, setTitle] = useState('');
  const [initial, setInitial] = useState<MindMapGraph | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState('');

  useEffect(() => {
    if (!ready || !privy || !id) return;
    loadMindMap(privy, id).then(({ map, error: err }) => {
      if (err || !map) { setError(err || 'Map not found.'); return; }
      setTitle(map.title);
      setInitial(map.graph);
    });
  }, [ready, privy, id]);

  // Debounced autosave. Dragging a box fires a change per frame, so saving on
  // every change would be a request per frame; this collapses a drag into one.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<MindMapGraph | null>(null);

  const flush = useCallback(async () => {
    if (!privy || !id || !pending.current) return;
    const graph = pending.current;
    pending.current = null;
    setSaving(true);
    const { error: err } = await saveMindMap(privy, id, graph);
    setSaving(false);
    if (err) setError(err);
    else setSavedAt(`Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
  }, [privy, id]);

  const onDirty = useCallback((g: MindMapGraph) => {
    pending.current = g;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_MS);
  }, [flush]);

  // A pending edit must not die with the page. This is best-effort — the browser
  // gives an unload handler no time for a round trip — but it catches the common
  // case of navigating away a beat after the last change.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); flush(); } }, [flush]);

  const renameSaved = useRef(title);
  const commitTitle = async () => {
    const next = title.trim();
    if (!privy || !id || !next || next === renameSaved.current) return;
    renameSaved.current = next;
    await saveMindMap(privy, id, undefined, next);
  };
  useEffect(() => { renameSaved.current = title; /* eslint-disable-next-line */ }, [initial]);

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 px-5 lg:px-7">
        <Link href="/maps" aria-label="Back to maps"
          className="h-8 w-8 -ml-1 inline-flex items-center justify-center rounded-lg text-tertiary hover:text-primary hover:bg-surface-hover transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          aria-label="Map title"
          className="text-md font-medium text-primary bg-transparent outline-none rounded px-1 -mx-1 hover:bg-surface-hover focus:bg-surface-hover min-w-0 flex-1 max-w-sm"
        />
      </header>

      {error && (
        <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg bg-danger/10 text-danger px-3 py-2 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" /> <span>{error}</span>
        </div>
      )}

      {/* min-h-0 so the canvas can actually take the remaining height inside a
          flex column — without it the child grows and the page scrolls instead. */}
      <div className="flex-1 min-h-0">
        {!ready || (!initial && !error) ? (
          <div className="h-full flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : initial ? (
          <MindMapCanvas initial={initial} saving={saving} savedAt={savedAt} onDirty={onDirty} />
        ) : null}
      </div>
    </>
  );
}
