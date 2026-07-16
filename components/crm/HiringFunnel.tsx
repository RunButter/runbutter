// Horizontal hiring funnel — shared by the Home dashboard and the HR Overview.
// Pure CSS bars (no chart dep), scaled to the largest stage.
export default function HiringFunnel({ stages }: { stages: { key: string; label: string; count: number; tone: string }[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="space-y-2.5">
      {stages.map((s) => (
        <div key={s.key} className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-[12px] font-medium text-secondary">{s.label}</span>
          <div className="flex-1 h-6 rounded-md bg-surface-sunken ring-1 ring-subtle overflow-hidden">
            <div className="h-full rounded-md transition-all duration-500" style={{ width: `${Math.max(3, (s.count / max) * 100)}%`, background: s.tone }} />
          </div>
          <span className="w-9 shrink-0 text-right text-[13px] font-semibold tabular-nums text-secondary">{s.count}</span>
        </div>
      ))}
    </div>
  );
}
