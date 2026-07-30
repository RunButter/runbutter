import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, ArrowDownRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// Premium KPI tile for dashboards. Everything past label/value is optional and
// only shown when the caller passes REAL data — no fabricated trends/sparklines
// (same discipline as the removed fake cognitive score). Built on tokens; when
// `href` is set the whole tile becomes a link with a hover affordance.

export type StatTrend = { dir: 'up' | 'down'; label: string; good?: boolean };

// Real month-over-month momentum from a chronological (oldest→newest) monthly
// series. The LAST point is the current, still-partial month, so it's dropped —
// comparing a mid-month total against a full month would fake a drop. Returns
// the change between the two most recent COMPLETE months, or undefined when
// there isn't enough data or the move is just noise (<0.5%). `upIsGood=false`
// for metrics where a rise is bad (costs).
export function monthlyMomentum(series: number[] | undefined, opts?: { upIsGood?: boolean }): StatTrend | undefined {
  if (!series || series.length < 3) return undefined;
  const complete = series.slice(0, -1);            // drop the partial current month
  const cur = complete[complete.length - 1];
  const prev = complete[complete.length - 2];
  if (!prev) return undefined;                     // can't divide by zero
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  if (!isFinite(pct) || Math.abs(pct) < 0.5) return undefined;
  const dir: 'up' | 'down' = pct >= 0 ? 'up' : 'down';
  const upIsGood = opts?.upIsGood ?? true;
  return { dir, label: `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`, good: dir === 'up' ? upIsGood : !upIsGood };
}

type StatCardProps = {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon?: LucideIcon;
  /**
   * Value color — ONLY when the number itself carries that meaning, e.g.
   * 'text-danger' on an overdue balance. Not decoration.
   *
   * A dashboard used to pass a different tone per card just to add variety, so
   * "3 candidates" was blue, "3 assessed" green and "0 interviews" amber. None
   * of it meant anything, and six tinted numbers in a grid is the single loudest
   * source of visual noise on a screen. Default is text-primary; leave it there.
   */
  tone?: string;
  trend?: StatTrend;
  /** Raw series for a mini sparkline; drawn only if 2+ points. */
  spark?: number[];
  /** Extra content rendered under the value (e.g. a share bar). */
  footer?: React.ReactNode;
  href?: string;
  className?: string;
};

// Tiny dependency-free sparkline. Uses currentColor so it inherits the tone.
function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null;
  const w = 72, h = 22, pad = 2;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const step = (w - pad * 2) / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (h - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" className="overflow-visible" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      <circle cx={lx} cy={ly} r={1.75} fill="currentColor" />
    </svg>
  );
}

export default function StatCard({
  label, value, sub, icon: Icon, tone, trend, spark, footer, href, className,
}: StatCardProps) {
  const interactive = !!href;
  const TrendArrow = trend?.dir === 'up' ? ArrowUpRight : ArrowDownRight;
  // A rise isn't always good (costs up is bad); callers can override via good.
  const trendGood = trend ? (trend.good ?? trend.dir === 'up') : false;

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        {/* Icon inline with the label as a quiet glyph — it used to be a boxed
            chip floating top-right, carrying no information the label didn't
            already give, and it shared that slot with the trend badge so a row
            of cards showed a green badge on one and a grey box on the rest.
            Top-right is now real data or nothing.

            Small uppercase label over a large figure. Uppercase is noticeably
            wider than sentence case, which is why the KPI grid drops to TWO
            across on a phone rather than three — at three, "Candidates" and
            "Interviews" truncated mid-word. The icon still drops below sm to buy
            the label back some width. */}
        <span className="flex items-center gap-1.5 min-w-0">
          {Icon && <Icon className="w-3.5 h-3.5 shrink-0 text-tertiary hidden sm:block" />}
          <span className="text-3xs font-medium uppercase tracking-wider text-tertiary truncate">{label}</span>
        </span>
        {trend && (
          <span className={cn(
            'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-2xs font-semibold shrink-0',
            trendGood ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
          )}>
            <TrendArrow className="w-3 h-3" />{trend.label}
          </span>
        )}
      </div>

      <div className="mt-2 sm:mt-3 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className={cn('text-2xl sm:text-stat font-medium tracking-tight tabular-nums truncate', tone || 'text-primary')}>
            {value}
          </div>
          {sub && <div className="mt-1 text-xs font-medium text-tertiary truncate">{sub}</div>}
        </div>
        {spark && spark.length >= 2 && (
          <span className={cn('shrink-0 self-center', tone || 'text-tertiary')}><Sparkline data={spark} /></span>
        )}
      </div>

      {footer && <div className="mt-2">{footer}</div>}
    </>
  );

  const base = cn(
    'block card-surface p-4 sm:p-5',
    interactive && 'group hover:ring-strong hover:shadow-elevated transition-all',
    className
  );

  return href ? <Link href={href} className={base}>{inner}</Link> : <div className={base}>{inner}</div>;
}
