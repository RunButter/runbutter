import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, ArrowDownRight, ArrowRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// Premium KPI tile for dashboards. Everything past label/value is optional and
// only shown when the caller passes REAL data — no fabricated trends/sparklines
// (same discipline as the removed fake cognitive score). Built on tokens; when
// `href` is set the whole tile becomes a link with a hover affordance.

export type StatTrend = { dir: 'up' | 'down'; label: string; good?: boolean };

type StatCardProps = {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon?: LucideIcon;
  /** Value color, e.g. 'text-success' | 'text-danger'. Defaults to text-primary. */
  tone?: string;
  trend?: StatTrend;
  /** Raw series for a mini sparkline; drawn only if 2+ points. */
  spark?: number[];
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
  label, value, sub, icon: Icon, tone, trend, spark, href, className,
}: StatCardProps) {
  const interactive = !!href;
  const TrendArrow = trend?.dir === 'up' ? ArrowUpRight : ArrowDownRight;
  // A rise isn't always good (costs up is bad); callers can override via good.
  const trendGood = trend ? (trend.good ?? trend.dir === 'up') : false;

  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">{label}</span>
        {Icon && (
          <span className="w-7 h-7 -mr-0.5 rounded-lg bg-surface-sunken ring-1 ring-subtle flex items-center justify-center shrink-0">
            <Icon className={cn('w-3.5 h-3.5', tone || 'text-tertiary')} />
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className={cn('text-[26px] leading-none font-semibold tabular-nums truncate', tone || 'text-primary')}>
            {value}
          </div>
          {sub && <div className="mt-1.5 text-[11px] font-medium text-tertiary truncate">{sub}</div>}
        </div>
        {spark && spark.length >= 2 && (
          <span className={cn('shrink-0 self-center', tone || 'text-tertiary')}><Sparkline data={spark} /></span>
        )}
      </div>

      {trend && (
        <div className="mt-3 flex items-center gap-1.5">
          <span className={cn(
            'inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-[11px] font-semibold',
            trendGood ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
          )}>
            <TrendArrow className="w-3 h-3" />{trend.label}
          </span>
          {interactive && <ArrowRight className="w-3 h-3 text-tertiary ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />}
        </div>
      )}
    </>
  );

  const base = cn(
    'block rounded-xl bg-surface ring-1 ring-subtle p-4',
    interactive && 'group hover:ring-strong hover:shadow-sm transition-all',
    className
  );

  return href ? <Link href={href} className={base}>{inner}</Link> : <div className={base}>{inner}</div>;
}
