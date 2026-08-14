'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import InsightChart from '@/components/crm/InsightChart';
import type { Bucket } from '@/lib/insights/run';
import type { ChartKind } from '@/lib/insights/spec';

/**
 * A published chart, for anyone with the link.
 *
 * SERVES A FROZEN SNAPSHOT, NEVER A LIVE QUERY (0109). Everything on this page
 * came out of one jsonb column that was computed when somebody pressed Publish.
 * There is no query to re-run, no object to name, and therefore nothing here
 * that can be talked into returning a row it was not given.
 *
 * NO DRILL-DOWN, and that is the feature rather than a missing one: the rows
 * behind a chart are the part somebody did not decide to share.
 */
interface Snapshot {
  title: string;
  data: { buckets: Bucket[]; total: number; chart: ChartKind; currency?: boolean; query?: string };
  created_at: string;
  brand?: { name?: string; logo_url?: string | null; accent?: string | null } | null;
}

export default function PublicInsight() {
  const token = String(useParams().token || '');
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'gone'>('loading');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/insights/s/${encodeURIComponent(token)}`)
      .then(async (r) => (r.ok ? r.json() : null))
      .then((j) => { if (cancelled) return; if (j) { setSnap(j); setState('ok'); } else setState('gone'); })
      .catch(() => { if (!cancelled) setState('gone'); });
    return () => { cancelled = true; };
  }, [token]);

  if (state === 'loading') {
    return <main className="min-h-screen bg-canvas flex items-center justify-center">
      <p className="text-sm text-tertiary">Loading…</p>
    </main>;
  }

  // One message for missing, revoked and expired. Distinguishing them would
  // confirm that a token once existed.
  if (state === 'gone' || !snap) {
    return <main className="min-h-screen bg-canvas flex items-center justify-center px-6">
      <div className="text-center">
        <h1 className="text-md font-medium text-primary">This link isn’t available</h1>
        <p className="mt-1 text-sm text-secondary">It may have been revoked or have expired.</p>
      </div>
    </main>;
  }

  const brand = snap.brand || {};
  const d = snap.data || ({} as Snapshot['data']);

  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center gap-2.5 mb-6">
          {brand.logo_url
            ? <img src={brand.logo_url} alt="" className="w-6 h-6 rounded object-contain" />
            : <span className="w-6 h-6 rounded bg-surface-sunken" />}
          <span className="text-sm font-medium text-secondary">{brand.name || 'Shared report'}</span>
        </div>

        <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-6">
          <h1 className="text-md font-medium text-primary">{snap.title}</h1>
          {d.query && <p className="mt-0.5 text-2xs text-tertiary">{d.query}</p>}
          <div className="mt-5">
            <InsightChart
              buckets={Array.isArray(d.buckets) ? d.buckets : []}
              kind={(d.chart || 'bar') as ChartKind}
              currency={!!d.currency}
              total={Number(d.total) || 0}
            />
          </div>
          <p className="mt-5 text-2xs text-tertiary">
            Snapshot taken {new Date(snap.created_at).toLocaleDateString()}. Figures are as at that date.
          </p>
        </div>

        <p className="mt-4 text-center text-2xs text-tertiary">
          Made with <a href="https://runbutter.app" className="text-accent hover:underline">RunButter</a>
        </p>
      </div>
    </main>
  );
}
