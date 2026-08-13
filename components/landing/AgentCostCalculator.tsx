'use client';

import { useMemo, useState } from 'react';
import { MODELS_FOR_COMPARISON, agentLoopCost, type LoopInput } from '@/lib/ai/loop-cost';
import { fmtUSD, AS_OF } from '@/lib/ai/pricing';

/**
 * What an agent actually costs to run, which is not what a token calculator
 * tells you.
 *
 * EVERY PUBLIC LLM CALCULATOR COMPUTES `input × price + output × price`. That is
 * right for one call and wrong for an agent, and the gap is not small. An agent
 * is a LOOP: the system prompt and the tool definitions are re-sent on every
 * turn, so a 20-step run sends the same prefix twenty times. Bill that at the
 * headline input rate and a nightly agent looks unaffordable; bill it at the
 * cache rate — a tenth on Anthropic — and it is pocket change. The difference
 * between those two answers is the whole decision.
 *
 * So this models the loop, shows the cached and uncached figures side by side,
 * and names the saving. It is the one number somebody actually needs before
 * pointing an agent at their data, and nothing else on the web computes it.
 */

const PRESETS: { label: string; hint: string; v: LoopInput }[] = [
  {
    label: 'Nightly check',
    hint: 'A small agent reading a few records and writing a summary, once a day.',
    v: { steps: 6, systemTokens: 2500, perStepTokens: 700, outputTokens: 400, runsPerMonth: 30 },
  },
  {
    label: 'Copilot question',
    hint: 'Somebody asks the copilot something and it looks in three places.',
    v: { steps: 4, systemTokens: 4000, perStepTokens: 900, outputTokens: 350, runsPerMonth: 200 },
  },
  {
    label: 'Heavy research agent',
    hint: 'A long loop across many records, writing notes as it goes.',
    v: { steps: 20, systemTokens: 6000, perStepTokens: 1500, outputTokens: 800, runsPerMonth: 20 },
  },
];

export default function AgentCostCalculator() {
  const [v, setV] = useState<LoopInput>(PRESETS[0].v);
  const set = <K extends keyof LoopInput>(k: K, n: number) =>
    setV((p) => ({ ...p, [k]: Math.max(0, Math.min(200_000, n || 0)) }));

  const rows = useMemo(
    () => MODELS_FOR_COMPARISON.map((m) => ({ m, ...agentLoopCost(m.id, v) }))
      .filter((r) => r.priced)
      .sort((a, b) => a.monthlyCached - b.monthlyCached),
    [v],
  );
  const cheapest = rows[0];
  const dearest = rows[rows.length - 1];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => setV(p.v)}
            title={p.hint}
            className={`h-8 px-3 rounded-full text-xs font-medium ring-1 transition-colors ${
              JSON.stringify(p.v) === JSON.stringify(v)
                ? 'ring-accent bg-accent-soft text-accent-text'
                : 'ring-subtle text-secondary hover:bg-surface-hover'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Field label="Steps per run" hint="Tool calls before it answers" value={v.steps} onChange={(n) => set('steps', n)} />
        <Field label="System + tools" hint="Tokens, re-sent every step" value={v.systemTokens} onChange={(n) => set('systemTokens', n)} />
        <Field label="Added per step" hint="Tool results and history" value={v.perStepTokens} onChange={(n) => set('perStepTokens', n)} />
        <Field label="Reply length" hint="Tokens written per step" value={v.outputTokens} onChange={(n) => set('outputTokens', n)} />
        <Field label="Runs per month" hint="How often it fires" value={v.runsPerMonth} onChange={(n) => set('runsPerMonth', n)} />
      </div>

      <div className="rounded-2xl ring-1 ring-subtle bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-subtle text-left">
                <Th>Model</Th>
                <Th align="right">Per run</Th>
                <Th align="right">Per month</Th>
                <Th align="right">Without caching</Th>
                <Th align="right">Saved</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, perRunCached, monthlyCached, monthlyUncached }) => {
                const saved = monthlyUncached - monthlyCached;
                const pct = monthlyUncached > 0 ? Math.round((saved / monthlyUncached) * 100) : 0;
                return (
                  <tr key={m.id} className="border-b border-subtle last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-mono text-2xs text-primary">{m.id}</div>
                      <div className="text-3xs text-tertiary">{m.vendor}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-secondary">{fmtUSD(perRunCached)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-primary">{fmtUSD(monthlyCached)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-tertiary">{fmtUSD(monthlyUncached)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {/* A model with no separate cache rate saves nothing here,
                          and says so rather than showing a misleading 0%. */}
                      {saved > 0
                        ? <span className="text-success-text">{pct}%</span>
                        : <span className="text-tertiary" title="This model has no separate cache rate">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {cheapest && dearest && cheapest.m.id !== dearest.m.id && (
        <p className="text-sm text-secondary">
          At this shape of work, <span className="font-mono text-primary">{dearest.m.id}</span> costs{' '}
          <b className="text-primary font-medium">
            {Math.round(dearest.monthlyCached / Math.max(cheapest.monthlyCached, 1e-9))}×
          </b>{' '}
          what <span className="font-mono text-primary">{cheapest.m.id}</span> does — {fmtUSD(dearest.monthlyCached)}{' '}
          against {fmtUSD(cheapest.monthlyCached)} a month.
        </p>
      )}

      <p className="text-xs text-tertiary leading-relaxed">
        List prices as of {AS_OF}, in USD. Caching assumes the system prompt and tool definitions are
        marked cacheable and stay identical across a run, which is how a well-built agent works and
        what RunButter does. Output length is the one thing nobody can know in advance — it is
        treated as the same every step, so a run that writes more costs more than this says.
      </p>
    </div>
  );
}

function Field({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="block">
      <span className="block text-2xs font-medium text-secondary mb-1">{label}</span>
      <input
        type="number" min={0} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-9 px-2.5 rounded-lg ring-1 ring-subtle bg-surface text-sm text-primary tabular-nums outline-none focus:ring-accent"
      />
      <span className="block text-3xs text-tertiary mt-1">{hint}</span>
    </label>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`px-4 py-2 text-2xs font-medium uppercase tracking-wider text-tertiary ${align === 'right' ? 'text-right' : ''}`}>
      {children}
    </th>
  );
}
