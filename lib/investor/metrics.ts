/**
 * The numbers an investor update is made of, computed rather than written.
 *
 * ── THE MODEL NEVER PRODUCES A FIGURE ───────────────────────────────────────
 * Everything here is arithmetic over the ledger and the pipeline. The AI is
 * given these numbers and writes the sentences AROUND them; it is never asked
 * what the revenue was. That is not a stylistic choice — an investor update is
 * the single document where a hallucinated number does real damage, and it is
 * forwarded to people who will remember it next quarter.
 *
 * Everything is also SHOWN on screen beside the draft, so every figure in the
 * prose can be checked against the thing it came from before anybody sends it.
 *
 * ── NOTHING IS INVENTED WHEN THE DATA IS THIN ───────────────────────────────
 * A metric that cannot be computed honestly comes back null and is omitted from
 * both the screen and the prompt. This codebase already refuses to draw a
 * sparkline it cannot support and refuses to report a runway from sample data;
 * a made-up growth rate in a document sent to investors is the same mistake
 * with a much worse blast radius.
 *
 * Pure — no imports beyond the runway helper's types, so it can be tested and
 * so a route handler can use it.
 */

export interface MonthPoint { month: string; label: string; revenue: number; costs: number }

export interface InvestorMetrics {
  /** The last COMPLETE month, which is the one an update is about. */
  period: string | null;
  revenue: number | null;
  revenuePrev: number | null;
  /** Month-on-month, as a percentage. Null unless both months are real. */
  growthPct: number | null;
  costs: number | null;
  net: number | null;
  outstanding: number | null;
  cash: number | null;
  runwayMonths: number | null;
  burn: number | null;
  /** Open pipeline value and count, when a board was readable. */
  pipelineValue: number | null;
  pipelineCount: number | null;
  headcount: number | null;
  /** Which figures could NOT be computed, so the screen can say so. */
  missing: string[];
}

const CURRENT_KEY = () => {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * Complete months only, newest last.
 *
 * THE PARTIAL MONTH IS DROPPED for the same reason lib/finance/runway.ts drops
 * it: on the 3rd of the month the ledger holds three days, and reporting that
 * as the month's revenue understates it by an order of magnitude. An update
 * written on the 2nd would otherwise open with a catastrophe that has not
 * happened.
 */
export function completeMonths(series: MonthPoint[]): MonthPoint[] {
  const current = CURRENT_KEY();
  return (series || []).filter((p) => p && p.month && p.month < current);
}

export interface GatherInput {
  series: MonthPoint[];
  cash: number | null;
  outstanding: number | null;
  runwayMonths: number | null;
  burn: number | null;
  pipelineValue: number | null;
  pipelineCount: number | null;
  headcount: number | null;
  /** False when the screen is showing sample data — then nothing is reported. */
  live: boolean;
}

export function gatherMetrics(input: GatherInput): InvestorMetrics {
  const missing: string[] = [];
  const empty: InvestorMetrics = {
    period: null, revenue: null, revenuePrev: null, growthPct: null, costs: null,
    net: null, outstanding: null, cash: null, runwayMonths: null, burn: null,
    pipelineValue: null, pipelineCount: null, headcount: null, missing,
  };

  // Sample data must never reach an investor update. Same rule RunwayCard
  // applies: a fabricated number about somebody's company is the one output
  // this product must never produce.
  if (!input.live) {
    missing.push('Connect your workspace — this is sample data, so no figures are reported.');
    return empty;
  }

  const months = completeMonths(input.series);
  const last = months[months.length - 1] || null;
  const prev = months[months.length - 2] || null;

  if (!last) missing.push('No complete month in the ledger yet, so there is nothing to report on.');

  const revenue = last ? last.revenue : null;
  const revenuePrev = prev ? prev.revenue : null;

  // Growth needs two real months AND a non-zero base. Dividing by zero produces
  // Infinity, and "∞% growth" in an investor update is a joke at the sender's
  // expense.
  const growthPct = revenue !== null && revenuePrev !== null && revenuePrev > 0
    ? ((revenue - revenuePrev) / revenuePrev) * 100
    : null;
  if (growthPct === null && revenue !== null) missing.push('Growth needs two complete months with revenue in the earlier one.');

  if (input.runwayMonths === null) missing.push('Runway needs a cash balance and a few months of history.');
  if (input.headcount === null) missing.push('Headcount could not be read.');

  return {
    period: last ? last.label || last.month : null,
    revenue,
    revenuePrev,
    growthPct,
    costs: last ? last.costs : null,
    net: last ? last.revenue - last.costs : null,
    outstanding: input.outstanding,
    cash: input.cash,
    runwayMonths: input.runwayMonths,
    burn: input.burn,
    pipelineValue: input.pipelineValue,
    pipelineCount: input.pipelineCount,
    headcount: input.headcount,
    missing,
  };
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** The figures, as lines a model is given. Only what is actually known. */
export function metricsPrompt(m: InvestorMetrics): string {
  const lines: string[] = [];
  if (m.period) lines.push(`Period: ${m.period}`);
  if (m.revenue !== null) lines.push(`Revenue: ${money(m.revenue)}`);
  if (m.revenuePrev !== null) lines.push(`Revenue previous month: ${money(m.revenuePrev)}`);
  if (m.growthPct !== null) lines.push(`Month-on-month growth: ${m.growthPct.toFixed(1)}%`);
  if (m.costs !== null) lines.push(`Costs: ${money(m.costs)}`);
  if (m.net !== null) lines.push(`Net: ${money(m.net)}`);
  if (m.cash !== null) lines.push(`Cash: ${money(m.cash)}`);
  if (m.burn !== null && m.burn > 0) lines.push(`Average monthly net burn: ${money(m.burn)}`);
  if (m.runwayMonths !== null) lines.push(`Runway: ${m.runwayMonths.toFixed(1)} months`);
  if (m.outstanding !== null && m.outstanding > 0) lines.push(`Outstanding invoices: ${money(m.outstanding)}`);
  if (m.pipelineValue !== null) lines.push(`Open pipeline: ${money(m.pipelineValue)} across ${m.pipelineCount ?? 0} deals`);
  if (m.headcount !== null) lines.push(`Headcount: ${m.headcount}`);
  return lines.join('\n');
}

/** True when there is enough to write about at all. */
export const hasEnough = (m: InvestorMetrics) =>
  m.revenue !== null || m.cash !== null || m.pipelineValue !== null;
