'use client';

import { rpc } from '@/lib/rpc';

/**
 * What AI has cost this workspace, across every feature that uses it (0101).
 *
 * The shape mirrors `get_ai_usage`, which unions `ai_usage` with `agent_runs` —
 * so this is deliberately NOT a second reader beside `getAgentUsage`. That one
 * answers "which agent", this one answers "what is AI costing me", and the join
 * that makes the second question honest lives in SQL where a caller cannot
 * forget it.
 */

export interface AIUsageTotals {
  calls: number; input: number; output: number; cached: number;
  failed: number; unreported: number;
}
export interface AIUsageFeature {
  feature: string; calls: number; input: number; output: number; cached: number; failed: number;
}
export interface AIUsageModel {
  model: string | null; provider: string; calls: number; input: number; output: number; cached: number;
}
export interface AIUsageDay { day: string; input: number; output: number }

export interface AIUsage {
  days: number;
  totals: AIUsageTotals;
  by_feature: AIUsageFeature[];
  by_model: AIUsageModel[];
  daily: AIUsageDay[];
}

/** Human names for the feature slugs. The slug is what is stored; this is only display. */
export const FEATURE_LABEL: Record<string, string> = {
  agents: 'Agents',
  assistant: 'Writing assistant',
  newsletter: 'Newsletter drafts',
  workspace: 'Workspace builder',
  skill: 'Skill generator',
  automation: 'Automations',
};

/** A workspace's own model prices (0104). Empty when none are set, or when 0104 has not run. */
export async function getModelPrices(privy: string, ws: string): Promise<Record<string, any>> {
  const { data, error } = await rpc('get_model_prices', { p_privy: privy, p_workspace: ws });
  if (error || !data || typeof data !== 'object') return {};
  return data as Record<string, any>;
}

export async function saveModelPrice(privy: string, ws: string, model: string, input: number, output: number, cached: number | null, note: string) {
  return rpc('save_model_price', {
    p_privy: privy, p_workspace: ws, p_model: model,
    p_input: input, p_output: output, p_cached: cached, p_note: note,
  });
}

export async function deleteModelPrice(privy: string, ws: string, model: string) {
  return rpc('delete_model_price', { p_privy: privy, p_workspace: ws, p_model: model });
}

export async function getAIUsage(privy: string, ws: string, days = 30): Promise<AIUsage | null> {
  const { data, error } = await rpc('get_ai_usage', { p_privy: privy, p_workspace: ws, p_days: days });
  // A missing function means 0101 has not been run. The panel hides itself
  // rather than showing an error over a screen nobody has enabled yet.
  if (error || !data) return null;
  return data as AIUsage;
}

/**
 * Tokens, shortened.
 *
 * Rounded to three significant figures rather than truncated: 1,250,000 reading
 * as "1M" hides a quarter of the bill, and the whole point of this screen is
 * that the number is the message.
 */
export function fmtTokens(n: number): string {
  if (!isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`;
}

/**
 * How much of the input was served from a cache, as a percentage.
 *
 * `cached` is a SUBSET of `input` on every provider (the client folds
 * Anthropic's out-of-band cache reads in before storing), so this is a ratio
 * and never a second number to add on.
 */
export function cacheRate(input: number, cached: number): number | null {
  if (!input || input <= 0 || cached <= 0) return null;
  return Math.min(100, Math.round((cached / input) * 100));
}
