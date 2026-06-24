import type { FinanceSeriesPoint } from '@/lib/crm/data';

// Lightweight grouped-bar chart (revenue vs costs) rendered as inline SVG — no
// charting dependency, scales to its container, matches the clean shell styling.
const REVENUE = '#10b981'; // emerald-500
const COSTS = '#94a3b8';   // slate-400

const kfmt = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);

export default function FinanceChart({ series }: { series: FinanceSeriesPoint[] }) {
  const W = 760, H = 260, padTop = 18, padBottom = 30, padX = 8;
  const plotW = W - padX * 2;
  const plotH = H - padTop - padBottom;
  const n = Math.max(series.length, 1);
  const max = Math.max(1, ...series.map((p) => Math.max(p.revenue, p.costs)));

  const groupW = plotW / n;
  const barW = Math.min(24, groupW * 0.3);
  const gap = barW * 0.34;
  const pairW = barW * 2 + gap;
  const yOf = (v: number) => padTop + plotH - (v / max) * plotH;
  const grid = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Revenue versus costs by month">
      {/* gridlines + y labels */}
      {grid.map((f) => {
        const y = padTop + plotH * (1 - f);
        return (
          <g key={f}>
            <line x1={padX} y1={y} x2={W - padX} y2={y} stroke="#f1f5f9" strokeWidth={1} />
            <text x={W - padX} y={y - 3} textAnchor="end" fontSize={9} fill="#cbd5e1" className="tabular-nums">{kfmt(max * f)}</text>
          </g>
        );
      })}

      {series.map((p, i) => {
        const groupX = padX + i * groupW;
        const pairX = groupX + (groupW - pairW) / 2;
        const rY = yOf(p.revenue), cY = yOf(p.costs);
        const baseY = padTop + plotH;
        return (
          <g key={p.month}>
            <rect x={pairX} y={rY} width={barW} height={Math.max(0, baseY - rY)} rx={3} fill={REVENUE}>
              <title>{`${p.label} · Revenue ${kfmt(p.revenue)}`}</title>
            </rect>
            <rect x={pairX + barW + gap} y={cY} width={barW} height={Math.max(0, baseY - cY)} rx={3} fill={COSTS}>
              <title>{`${p.label} · Costs ${kfmt(p.costs)}`}</title>
            </rect>
            <text x={groupX + groupW / 2} y={H - 10} textAnchor="middle" fontSize={10} fill="#94a3b8">{p.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
