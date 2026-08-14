'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, RotateCw, X } from 'lucide-react';
import { RPC_READ_FAILED, type RpcReadFailure } from '@/lib/rpc';

/**
 * "This did not load" — said out loud, once, over whatever empty state the page
 * drew underneath.
 *
 * The failure this exists for is not a crash. It is a screen that looks fine
 * and is lying: a list that failed to load renders exactly like a list with
 * nothing in it, so somebody concludes they have no integrations, no segments,
 * no subscribers. Settings → Integrations did that for months.
 *
 * DEDUPED BY FUNCTION NAME, because one broken screen usually fires several
 * reads and a stack of identical banners is its own kind of noise. The count
 * is shown instead, so "3 requests failed" is still visible.
 *
 * NOT A TOAST. A toast disappears, and the wrong conclusion — "we have no
 * data" — outlives it. This stays until it is dismissed or the page is
 * reloaded.
 */
export default function LoadErrorBanner() {
  const [failures, setFailures] = useState<RpcReadFailure[]>([]);

  useEffect(() => {
    const onFail = (e: Event) => {
      const detail = (e as CustomEvent<RpcReadFailure>).detail;
      if (!detail?.fn) return;
      setFailures((prev) => (prev.some((f) => f.fn === detail.fn) ? prev : [...prev, detail]));
    };
    window.addEventListener(RPC_READ_FAILED, onFail);
    return () => window.removeEventListener(RPC_READ_FAILED, onFail);
  }, []);

  if (failures.length === 0) return null;

  const first = failures[0];
  const more = failures.length - 1;

  return (
    <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-danger/10 border-b border-danger/20">
      <AlertTriangle className="w-3.5 h-3.5 text-danger shrink-0" />
      <span className="text-xs text-primary min-w-0 truncate">
        Some data could not be loaded — what you see may be incomplete.
        <span className="text-secondary"> {first.message}</span>
        {more > 0 && <span className="text-tertiary"> (+{more} more)</span>}
      </span>
      <button onClick={() => window.location.reload()}
        className="ml-auto h-6 px-2 inline-flex items-center gap-1 rounded-md text-2xs font-semibold text-danger hover:bg-danger/10 shrink-0">
        <RotateCw className="w-3 h-3" /> Retry
      </button>
      <button onClick={() => setFailures([])} aria-label="Dismiss"
        className="h-6 w-6 inline-flex items-center justify-center rounded-md text-tertiary hover:text-primary shrink-0">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
