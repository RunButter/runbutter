// Horizontal hiring funnel — shared by the Home dashboard and the HR Overview.
// Pure CSS bars (no chart dep), scaled to the largest stage.
//
// COLOUR: one accent hue, deepening along the funnel — not six colours.
//
// Each stage used to carry its own hardcoded hex (#60a5fa, #fbbf24, #a78bfa,
// #f59e0b, #34d399, #10b981). That was wrong three ways: it broke the
// semantic-token rule and so never adapted to dark mode; six unrelated hues
// implied six unrelated categories when a funnel is one ORDERED sequence; and
// the amber on "Screening" is the same tone the rest of the app uses to mean
// "warning", so a perfectly healthy pipeline looked like it had a problem.
//
// A single hue with rising intensity encodes the one thing that is actually
// true: later stages are further along.
export default function HiringFunnel({ stages }: { stages: { key: string; label: string; count: number; tone?: string }[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  const last = Math.max(1, stages.length - 1);

  return (
    <div className="space-y-2.5">
      {stages.map((s, i) => (
        <div key={s.key} className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-xs font-medium text-secondary">{s.label}</span>
          <div className="flex-1 h-6 rounded-md bg-surface-sunken ring-1 ring-subtle overflow-hidden">
            <div
              className="h-full rounded-md bg-accent transition-all duration-500"
              style={{
                width: `${Math.max(3, (s.count / max) * 100)}%`,
                // Floor at 0.4 so the first stage still reads as a bar, not a smudge.
                opacity: 0.4 + (0.6 * i) / last,
              }}
            />
          </div>
          <span className="w-9 shrink-0 text-right text-sm font-semibold tabular-nums text-primary">{s.count}</span>
        </div>
      ))}
    </div>
  );
}
