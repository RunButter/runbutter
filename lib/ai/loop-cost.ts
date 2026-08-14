// What an AGENT costs, as opposed to what a call costs.
//
// The arithmetic every public LLM calculator does is `input × price + output ×
// price`. That is correct for one request and wrong for an agent by a large
// multiple, because an agent is a LOOP and the expensive part is the part that
// repeats: the system prompt and the tool definitions are re-sent on every
// single turn.
//
// A 20-step run with a 6,000-token prefix sends 120,000 prefix tokens. Billed at
// the headline input rate that is most of the cost; billed at a cache rate —
// roughly a tenth on Anthropic, half on OpenAI — it nearly vanishes. Those two
// answers lead to opposite decisions about whether to run an agent at all,
// which is why this file exists rather than a multiplication in a component.
//
// Pure and import-light on purpose: it is used by a PUBLIC page with no account
// and no network, so it must not reach for anything that needs either.

import { priceFor } from './pricing';

export interface LoopInput {
  /** Tool calls before the model gives its final answer. */
  steps: number;
  /** System prompt + tool definitions. Re-sent every step; the cacheable part. */
  systemTokens: number;
  /** Tool results and history added per step. Grows the prompt and is NOT cacheable. */
  perStepTokens: number;
  /** Tokens the model writes each step. */
  outputTokens: number;
  runsPerMonth: number;
}

export interface LoopCost {
  priced: boolean;
  perRunCached: number;
  perRunUncached: number;
  monthlyCached: number;
  monthlyUncached: number;
}

/**
 * The models worth putting side by side.
 *
 * Wide enough to be worth reading, short enough to keep current. The first
 * version listed only what the product itself defaults to, which made the page
 * a product brochure rather than a tool — somebody comparing DeepSeek against
 * Sonnet is exactly who the page is for, and they will not trust a table that
 * omits the cheap options.
 *
 * Every entry must have a price in `PRICES` or the table silently drops the
 * row, which is asserted in the tests rather than left to review.
 */
export const MODELS_FOR_COMPARISON: { id: string; vendor: string }[] = [
  { id: 'claude-opus-5', vendor: 'Anthropic' },
  { id: 'claude-sonnet-5', vendor: 'Anthropic' },
  { id: 'claude-haiku-4-5', vendor: 'Anthropic' },
  { id: 'gpt-4.1', vendor: 'OpenAI' },
  { id: 'gpt-4o', vendor: 'OpenAI' },
  { id: 'gpt-4o-mini', vendor: 'OpenAI' },
  { id: 'gpt-4.1-mini', vendor: 'OpenAI' },
  { id: 'o4-mini', vendor: 'OpenAI' },
  { id: 'gemini-2.5-pro', vendor: 'Google' },
  { id: 'gemini-2.5-flash', vendor: 'Google' },
  { id: 'gemini-2.5-flash-lite', vendor: 'Google' },
  { id: 'deepseek-chat', vendor: 'DeepSeek' },
  { id: 'deepseek-reasoner', vendor: 'DeepSeek' },
  { id: 'kimi-k2', vendor: 'Moonshot' },
  { id: 'mistral-large', vendor: 'Mistral' },
  { id: 'mistral-small', vendor: 'Mistral' },
  { id: 'llama-3.3-70b', vendor: 'Meta (hosted)' },
  { id: 'llama-3.1-8b', vendor: 'Meta (hosted)' },
  { id: 'qwen3-32b', vendor: 'Qwen' },
  { id: 'grok-4', vendor: 'xAI' },
  { id: 'grok-3-mini', vendor: 'xAI' },
  { id: 'gpt-oss-120b', vendor: 'Open weight' },
];

/**
 * Cost of one agent run, with and without prompt caching.
 *
 * THE PROMPT GROWS. Step n carries the system prefix plus every tool result so
 * far, so the uncached portion is triangular — `perStep × (1 + 2 + … + n)`, not
 * `perStep × n`. Treating it as linear under-states a long run badly, and a long
 * run is exactly the one somebody is trying to price.
 *
 * The FIRST step cannot be a cache hit: there is nothing in the cache yet. So
 * the prefix is billed at full rate once and at the cache rate `steps - 1`
 * times, which is also why caching does nothing for a one-step call.
 */
export function agentLoopCost(model: string, v: LoopInput): LoopCost {
  const p = priceFor(model);
  if (!p) return { priced: false, perRunCached: 0, perRunUncached: 0, monthlyCached: 0, monthlyUncached: 0 };

  const steps = Math.max(0, Math.round(v.steps));
  if (steps === 0) return { priced: true, perRunCached: 0, perRunUncached: 0, monthlyCached: 0, monthlyUncached: 0 };

  const sys = Math.max(0, v.systemTokens);
  const per = Math.max(0, v.perStepTokens);
  const out = Math.max(0, v.outputTokens);
  const runs = Math.max(0, Math.round(v.runsPerMonth));

  // Triangular: the accumulated history is re-sent each step.
  const growing = (per * steps * (steps + 1)) / 2;
  const outputTotal = out * steps;

  const M = 1_000_000;
  const cacheRate = p.cached ?? p.input;

  const uncached = ((sys * steps + growing) * p.input + outputTotal * p.output) / M;
  const cached =
    ((sys * p.input) + (sys * (steps - 1) * cacheRate) + (growing * p.input) + (outputTotal * p.output)) / M;

  return {
    priced: true,
    perRunCached: cached,
    perRunUncached: uncached,
    monthlyCached: cached * runs,
    monthlyUncached: uncached * runs,
  };
}
