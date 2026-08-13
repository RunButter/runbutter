'use client';

import { useEffect, useState } from 'react';
import { Activity, AlertCircle } from 'lucide-react';
import {
  getAIUsage, getModelPrices, fmtTokens, cacheRate, FEATURE_LABEL,
  type AIUsage,
} from '@/lib/crm/ai-usage';
import { spendFor, fmtUSD, AS_OF } from '@/lib/ai/pricing';

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
  // The workspace's own prices (0104). Empty is the normal case and means
  // "use the shipped list prices"; it is never a reason to hide a cost.
  const [prices, setPrices] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!privy || !ws) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    getAIUsage(privy, ws, days).then((u) => {
      if (cancelled) return;
      setUsage(u); setLoading(false);
    });
    getModelPrices(privy, ws).then((p) => { if (!cancelled) setPrices(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [privy, ws, days]);

  // 0101 not run, or nothing to show. Silent either way: a cost panel that says
  // "no data" on a workspace that has never used AI is a worry with no cause.
  if (loading || !usage || usage.totals.calls === 0) return null;

  const t = usage.totals;
  const rate = cacheRate(t.input, t.cached);

  /**
   * Cost is summed PER MODEL, never from the totals.
   *
   * The totals row has no model on it, and the whole point of the number is
   * that a month on Haiku and a month on Opus are not the same money. Summing
   * `by_model` is the only arithmetic that can be right — and it is also what
   * makes the unpriced share visible, because a model this build has no price
   * for contributes tokens to the total and nothing to the cost.
   */
  const priced = usage.by_model.reduce(
    (acc, m) => {
      const s = spendFor(m.model || '', m, prices);
      if (s.priced) { acc.usd += s.usd; acc.calls += m.calls; }
      else acc.unpriced += m.calls;
      return acc;
    },
    { usd: 0, calls: 0, unpriced: 0 },
  );

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

      <div className="grid grid-cols-4 gap-3 mb-4">
        <Stat label="Sent in" value={fmtTokens(t.input)} sub={rate !== null ? `${rate}% cached` : undefined} />
        <Stat label="Came back" value={fmtTokens(t.output)} />
        <Stat label="Calls" value={String(t.calls)} sub={t.failed ? `${t.failed} failed` : undefined} />
        {/* An estimate, and labelled as one. It is arithmetic over a price list
            in this build, not a figure from anybody's billing page — so it is
            dated, and it says how many calls it could not price rather than
            quietly leaving them out of a confident number. */}
        <Stat
          label="Est. cost"
          value={priced.calls ? fmtUSD(priced.usd) : '—'}
          sub={priced.unpriced ? `${priced.unpriced} unpriced` : `list prices, ${AS_OF}`}
        />
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
          <Bars rows={usage.by_model.map((m) => {
            const s = spendFor(m.model || '', m, prices);
            return {
              key: m.model || 'unknown',
              label: m.model || 'not reported',
              value: m.input + m.output,
              // The cost of THIS model, or a dash. A dash is a real answer here
              // — it says "we do not know what this one costs", which is the
              // thing somebody needs in order to go and look it up.
              note: s.priced ? fmtUSD(s.usd) : '—',
              mono: true,
            };
          })} />
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
