'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { rpc } from '@/lib/rpc';
import { formatLimit, getLimit, normalizePlan, type PlanLimits } from '@/lib/plans';

/**
 * Where this workspace stands against what it pays for.
 *
 * ── A CEILING YOU CANNOT SEE IS ONE YOU DISCOVER BY BEING REFUSED ───────────
 * 0108 and 0126 made six limits real; this is the other half of that and is not
 * optional. Without it the first time anybody learns about `maxRecords` is an
 * error message in the middle of doing something else, which reads as the
 * product breaking rather than as a plan being outgrown.
 *
 * ── ONE COUNT, SHARED WITH THE THING THAT BLOCKS YOU ────────────────────────
 * `get_plan_usage` is the same function the enforcement path reads. Two
 * implementations of "how many records is that" eventually disagree, and being
 * refused at 500 while this bar says 486 is worse than showing no bar at all.
 *
 * Unlimited rows are dropped rather than drawn as an empty bar. "0 of
 * Unlimited" is a progress bar that can never move and tells nobody anything;
 * on Business and Enterprise this renders nothing, which is correct.
 */

const ROWS: { key: keyof PlanLimits; usage: string; label: string }[] = [
  { key: 'maxRecords', usage: 'records', label: 'Records' },
  { key: 'maxSeats', usage: 'seats', label: 'People' },
  { key: 'maxAutomations', usage: 'automations', label: 'Automations' },
  { key: 'maxPositions', usage: 'positions', label: 'Open positions' },
  { key: 'maxCandidates', usage: 'candidates', label: 'Candidates' },
  { key: 'maxESignPerMonth', usage: 'esign_month', label: 'E-signatures this month' },
];

export default function PlanUsage({ privy, workspaceId, plan }: {
  privy: string; workspaceId: string; plan: string;
}) {
  const [usage, setUsage] = useState<Record<string, number> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    rpc('get_plan_usage', { p_privy: privy, p_workspace: workspaceId }, { quiet: true }).then(({ data, error }) => {
      if (!live) return;
      if (error || !data) { setFailed(true); return; }
      setUsage(data as Record<string, number>);
    });
    return () => { live = false; };
  }, [privy, workspaceId]);

  const p = normalizePlan(plan);
  const rows = ROWS
    .map((r) => ({ ...r, max: getLimit(p, r.key), used: Number(usage?.[r.usage] ?? 0) }))
    .filter((r) => isFinite(r.max));

  // Nothing finite to show, or the read failed. A silent absence is right here:
  // this panel is context, and an error banner about a usage bar on the billing
  // screen is noise on a page somebody opened to change their plan.
  if (!rows.length || failed || !usage) return null;

  return (
    <div className="rounded-2xl ring-1 ring-subtle bg-surface p-5 mb-6">
      <h3 className="text-sm font-medium text-primary">What you are using</h3>
      <p className="mt-0.5 text-2xs text-tertiary">
        Counted live. E-signatures reset on the 1st, UTC; everything else is a total.
      </p>
      <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((r) => {
          const pct = r.max > 0 ? Math.min(100, (r.used / r.max) * 100) : 100;
          // Two thresholds, because "you are close" and "you are stopped" are
          // different messages and only one of them is urgent.
          const full = r.used >= r.max;
          const near = !full && pct >= 80;
          return (
            <div key={r.key}>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xs text-secondary flex-1 truncate">{r.label}</span>
                <span className={`text-2xs font-semibold tabular-nums ${full ? 'text-danger' : near ? 'text-warning' : 'text-primary'}`}>
                  {r.used.toLocaleString()}
                </span>
                <span className="text-2xs text-tertiary tabular-nums">/ {formatLimit(r.max)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-sunken overflow-hidden">
                <div className={`h-full rounded-full ${full ? 'bg-danger' : near ? 'bg-warning' : 'bg-accent'}`}
                  style={{ width: `${Math.max(pct, r.used > 0 ? 3 : 0)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      {rows.some((r) => r.used >= r.max) && (
        <p className="mt-3 text-2xs text-danger inline-flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          Something here is full, so new ones will be refused until you upgrade. Nothing you already
          have is affected — existing records stay editable whatever the plan says.
        </p>
      )}
    </div>
  );
}
