'use client';

import type { Bucket } from '@/lib/insights/run';
import type { ChartKind } from '@/lib/insights/spec';

/**
 * The answer, drawn.
 *
 * Inline SVG rather than chart.js, for the reason FinanceChart already gives:
 * the dependency is ~110 kB, this scales to its container for free, and every
 * colour can be a semantic token — so it is correct in dark mode without a
 * second palette to keep in step.
 *
 * ONE SERIES ONLY, deliberately. A question has one answer; two axes of
 * comparison is a dashboard, and a dashboard is a different feature with a
 * different security story (see the snapshot rule for public sharing).
 */

const fmt = (n: number, currency: boolean) => {
  const abs = Math.abs(n);
  const s = abs >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : abs >= 1000 ? `${(n / 1000).toFixed(abs >= 10_000 ? 0 : 1)}k`
      : Number.isInteger(n) ? String(n) : n.toFixed(2);
  return currency ? `$${s}` : s;
};

const ACCENT = 'hsl(var(--accent))';

export default function InsightChart({ buckets, kind, currency = false, total }: {
  buckets: Bucket[]; kind: ChartKind; currency?: boolean; total: number;
}) {
  if (kind === 'number' || buckets.length <= 1) {
    return (
      <div className="flex flex-col items-center justify-center py-10">
        <div className="text-4xl font-medium text-primary tabular-nums">{fmt(total, currency)}</div>
        <div className="mt-1 text-2xs text-tertiary">{buckets[0]?.n ?? 0} record{(buckets[0]?.n ?? 0) === 1 ? '' : 's'}</div>
      </div>
    );
  }

  if (kind === 'pie') return <Pie buckets={buckets} currency={currency} />;
  if (kind === 'line') return <Line buckets={buckets} currency={currency} />;
  return <Bars buckets={buckets} currency={currency} />;
}

/** Horizontal bars: labels are words, and words are readable along an axis. */
function Bars({ buckets, currency }: { buckets: Bucket[]; currency: boolean }) {
  const max = Math.max(1, ...buckets.map((b) => Math.abs(b.value)));
  return (
    <div className="flex flex-col gap-1.5 py-2">
      {buckets.map((b) => (
        <div key={b.label} className="flex items-center gap-2">
          <div className="w-32 shrink-0 text-2xs text-secondary truncate capitalize" title={b.label}>
            {b.label.replace(/_/g, ' ')}
          </div>
          <div className="flex-1 h-5 bg-surface-sunken rounded-sm overflow-hidden">
            <div className="h-full rounded-sm transition-all duration-300"
              style={{ width: `${Math.max((Math.abs(b.value) / max) * 100, 1.5)}%`, background: ACCENT }} />
          </div>
          <div className="w-20 shrink-0 text-2xs font-semibold text-primary tabular-nums text-right">
            {fmt(b.value, currency)}
          </div>
        </div>
      ))}
    </div>
  );
}

function Line({ buckets, currency }: { buckets: Bucket[]; currency: boolean }) {
  const W = 720, H = 220, padX = 36, padTop = 14, padBottom = 26;
  const plotW = W - padX * 2, plotH = H - padTop - padBottom;
  const max = Math.max(1, ...buckets.map((b) => b.value));
  const min = Math.min(0, ...buckets.map((b) => b.value));
  const span = max - min || 1;
  const x = (i: number) => padX + (buckets.length === 1 ? plotW / 2 : (i / (buckets.length - 1)) * plotW);
  const y = (v: number) => padTop + plotH - ((v - min) / span) * plotH;
  const d = buckets.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(b.value).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" preserveAspectRatio="xMidYMid meet"
      role="img" aria-label="Trend">
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={padX} x2={W - padX} y1={padTop + plotH * (1 - f)} y2={padTop + plotH * (1 - f)}
          stroke="hsl(var(--border-subtle))" strokeWidth="1" />
      ))}
      <path d={d} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {buckets.map((b, i) => <circle key={b.label} cx={x(i)} cy={y(b.value)} r="3" fill={ACCENT} />)}
      {buckets.map((b, i) => (
        // Every label would collide on a dense series; show a readable subset.
        (buckets.length <= 8 || i % Math.ceil(buckets.length / 8) === 0) && (
          <text key={`l${b.label}`} x={x(i)} y={H - 8} textAnchor="middle"
            fontSize="10" fill="hsl(var(--text-tertiary))">{b.label.slice(5)}</text>
        )
      ))}
      <text x={padX - 6} y={y(max) + 3} textAnchor="end" fontSize="10" fill="hsl(var(--text-tertiary))">
        {fmt(max, currency)}
      </text>
    </svg>
  );
}

function Pie({ buckets, currency }: { buckets: Bucket[]; currency: boolean }) {
  const total = buckets.reduce((a, b) => a + Math.abs(b.value), 0) || 1;
  const R = 70, C = 90;
  let angle = -Math.PI / 2;
  // One hue, stepped in lightness: a categorical rainbow implies a meaning the
  // categories do not have, and there is no accessible ordering in it.
  const slices = buckets.map((b, i) => {
    const frac = Math.abs(b.value) / total;
    const start = angle;
    const end = angle + frac * Math.PI * 2;
    angle = end;
    const large = end - start > Math.PI ? 1 : 0;
    const p = (a: number) => `${(C + R * Math.cos(a)).toFixed(2)},${(C + R * Math.sin(a)).toFixed(2)}`;
    return {
      d: `M${C},${C} L${p(start)} A${R},${R} 0 ${large} 1 ${p(end)} Z`,
      opacity: 1 - (i / Math.max(buckets.length, 1)) * 0.68,
      ...b, frac,
    };
  });

  return (
    <div className="flex items-center gap-6 py-2 flex-wrap">
      <svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label="Share of total">
        {slices.map((s) => <path key={s.label} d={s.d} fill={ACCENT} opacity={s.opacity} />)}
      </svg>
      <div className="flex flex-col gap-1 min-w-0">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-2xs">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: ACCENT, opacity: s.opacity }} />
            <span className="text-secondary capitalize truncate max-w-[12rem]">{s.label.replace(/_/g, ' ')}</span>
            <span className="text-primary font-semibold tabular-nums">{fmt(s.value, currency)}</span>
            <span className="text-tertiary tabular-nums">{Math.round(s.frac * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
