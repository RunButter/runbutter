'use client';

import { useEffect, useState } from 'react';
import { Activity, AlertCircle } from 'lucide-react';
import {
  getAIUsage, fmtTokens, cacheRate, FEATURE_LABEL,
  type AIUsage,
} from '@/lib/crm/ai-usage';

/**
 * What AI has cost this workspace (0101).
 *
 * Its own file because a page can only export a default, which makes anything
 * declared in a page file unrenderable without signing in — the same reason
 * `ObjectCards.tsx` exists.
 *
 * TOKENS, NEVER MONEY. Converting to a currency needs a per-model price table,
 * and that table is wrong the week after it is written: providers change
 * prices, OpenRouter's vary by upstream, and a `custom` gateway could be a
 * local Ollama costing nothing at all. A confident dollar figure derived from a
 * stale table is the same lie as a fabricated sparkline — so this reports what
 * was counted and lets the provider's own billing page do arithmetic it is
 * qualified to do.
 */
export default function AIUsagePanel({ privy, ws }: { privy: string | null; ws: string | null }) {
  const [usage, setUsage] = useState<AIUsage | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!privy || !ws) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    getAIUsage(privy, ws, days).then((u) => {
      if (cancelled) return;
      setUsage(u); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [privy, ws, days]);

  // 0101 not run, or nothing to show. Silent either way: a cost panel that says
  // "no data" on a workspace that has never used AI is a worry with no cause.
  if (loading || !usage || usage.totals.calls === 0) return null;

  const t = usage.totals;
  const rate = cacheRate(t.input, t.cached);

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-tertiary" />
          <span className="text-2xs font-medium uppercase tracking-wider text-tertiary">AI usage</span>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="h-7 px-1.5 text-xs rounded-md bg-transparent text-secondary ring-1 ring-subtle"
        >
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="Sent in" value={fmtTokens(t.input)} sub={rate !== null ? `${rate}% cached` : undefined} />
        <Stat label="Came back" value={fmtTokens(t.output)} />
        <Stat label="Calls" value={String(t.calls)} sub={t.failed ? `${t.failed} failed` : undefined} />
      </div>

      {/* The share bar. Proportions of the total, so "which feature is the
          bill" is answerable without reading any numbers. */}
      <Bars rows={usage.by_feature.map((f) => ({
        key: f.feature,
        label: FEATURE_LABEL[f.feature] || f.feature,
        value: f.input + f.output,
        note: `${f.calls} call${f.calls === 1 ? '' : 's'}`,
      }))} />

      {usage.by_model.length > 1 && (
        <div className="mt-4 pt-3 border-t border-subtle">
          <div className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-2">By model</div>
          <Bars rows={usage.by_model.map((m) => ({
            key: m.model || 'unknown',
            label: m.model || 'not reported',
            value: m.input + m.output,
            note: `${m.calls} call${m.calls === 1 ? '' : 's'}`,
            mono: true,
          }))} />
        </div>
      )}

      {/* Said plainly, because the alternative is a total that looks complete
          and is not. A gateway that omits `usage` is common, and a workspace
          reading a confident number that excludes an unknown share of its spend
          is worse off than one that knows the number is partial. */}
      {t.unreported > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-2xs text-tertiary">
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          <span>
            {t.unreported} of {t.calls} call{t.calls === 1 ? '' : 's'} reported no token count — some
            gateways omit it. Those are missing from the totals above rather than counted as zero.
          </span>
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-2xs text-tertiary mb-0.5">{label}</div>
      <div className="text-md font-medium text-primary tabular-nums">{value}</div>
      {sub && <div className="text-3xs text-tertiary mt-0.5">{sub}</div>}
    </div>
  );
}

function Bars({ rows }: { rows: { key: string; label: string; value: number; note: string; mono?: boolean }[] }) {
  // Against the LARGEST row, not the sum: proportional-to-total bars are all
  // slivers as soon as there are six features, and the question this answers is
  // "what is biggest", which is a comparison between rows.
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2.5">
          <div className={`w-36 shrink-0 truncate text-xs text-secondary ${r.mono ? 'font-mono !text-2xs' : ''}`} title={r.label}>
            {r.label}
          </div>
          <div className="flex-1 h-1.5 rounded-full bg-surface-sunken overflow-hidden">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
          <div className="w-16 shrink-0 text-right text-2xs text-tertiary tabular-nums">{fmtTokens(r.value)}</div>
          <div className="w-14 shrink-0 text-right text-3xs text-tertiary tabular-nums">{r.note}</div>
        </div>
      ))}
    </div>
  );
}
