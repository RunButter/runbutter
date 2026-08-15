/**
 * Cash-flow forecast. Facts in, months out, no dependencies.
 *
 * ── WHY THE ARITHMETIC LIVES HERE AND NOT IN SQL ────────────────────────────
 * A scenario slider has to move the chart in the same frame. A round trip per
 * drag turns a model you argue with back into a report you read, and a report
 * is exactly what this is replacing. 0116 returns the FACTS — cash, history,
 * open invoices, inferred run rates — and every assumption is applied here,
 * where it is visible, editable and testable without a database.
 *
 * ── EVERY MONTH CARRIES ITS OWN EXPLANATION ─────────────────────────────────
 * A projected month is four numbers people will disagree with, so each one
 * comes back separated: what is already invoiced, what is assumed to recur,
 * what is fixed cost, what is scenario. A single "expected in" figure is
 * unarguable in the bad way — nobody can see which half of it they doubt.
 *
 * ── NOTHING HERE IS A PROBABILITY ───────────────────────────────────────────
 * No confidence band, no Monte Carlo, no "87% likely to survive". The inputs
 * are a few averages over a few months of one company; a probability derived
 * from that is decoration on a guess, and decoration is what makes a guess
 * quotable. This says what follows from the assumptions on screen. Same rule as
 * the missing sparkline and the missing cognitive score.
 */

export interface DatedAmount { d: string; v: number }
export interface MonthPoint { month: string; revenue: number; costs: number }
export interface NamedMonthly { label: string; monthly: number; months: number }
export interface CostLine extends NamedMonthly { fixed: boolean }

export interface Basis {
  cash: number;
  window_months: number;
  months_of_history: number;
  collection_lag_days: number | null;
  collection_lag_based_on: number;
  history: MonthPoint[];
  receivables: DatedAmount[];
  payables: DatedAmount[];
  recurring_clients: NamedMonthly[];
  cost_mix: CostLine[];
}

export interface Scenario {
  /** Months to project. */
  horizon: number;
  /** Compounding month-on-month change to run-rate revenue, in percent. */
  growthPct: number;
  /** Change to VARIABLE costs only, in percent — see `hires` for headcount. */
  costChangePct: number;
  /** Headcount added, at a fully-loaded monthly cost, from month index `hireFrom`. */
  hires: number;
  hireCost: number;
  hireFrom: number;
  /** Shift every expected payment by this many days. Negative = paid sooner. */
  collectionShiftDays: number;
  /** Drop the largest inferred recurring client from month `churnFrom`. */
  loseTopClient: boolean;
  churnFrom: number;
  /** A single lump: funding round, tax bill, equipment. Signed. */
  oneOff: number;
  oneOffMonth: number;
}

export const DEFAULT_SCENARIO: Scenario = {
  horizon: 12, growthPct: 0, costChangePct: 0,
  hires: 0, hireCost: 8000, hireFrom: 1,
  collectionShiftDays: 0, loseTopClient: false, churnFrom: 1,
  oneOff: 0, oneOffMonth: 1,
};

export interface ProjectedMonth {
  month: string;
  open: number;
  /** Invoices already raised, landing this month. */
  invoiced: number;
  /** Run-rate revenue assumed to keep arriving, after growth and churn. */
  recurring: number;
  /** Bills already raised, due this month. */
  bills: number;
  fixedCosts: number;
  variableCosts: number;
  payroll: number;
  oneOff: number;
  net: number;
  close: number;
}

export interface Forecast {
  months: ProjectedMonth[];
  /** Key of the first month closing below zero, or null. */
  goesNegative: string | null;
  /** Whole months until that point, from now. */
  monthsOfCash: number | null;
  /** Run-rate net per month at the end of the horizon — the steady state. */
  endingNet: number;
  /** Assumptions that were guessed rather than measured, for the UI to admit. */
  notes: string[];
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Month keys from the current month forward, inclusive. */
function horizonKeys(n: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1))));
  return out;
}

/**
 * Shift a date by days and return its month key.
 *
 * The whole reason 0116 returns receivables by DATE rather than by month: a
 * fortnight of collection improvement has to be able to pull an invoice into
 * an earlier month, and it cannot do that against a pre-bucketed total.
 */
function shiftedMonth(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return '';
  return monthKey(new Date(t + days * 86_400_000));
}

/**
 * Average of the complete months on record.
 *
 * Divided by the months actually SEEN, never by the window: a workspace two
 * months old would otherwise have its burn divided by six and read as three
 * times safer than it is.
 */
function runRate(history: MonthPoint[]): { revenue: number; costs: number; n: number } {
  const n = history.length;
  if (!n) return { revenue: 0, costs: 0, n: 0 };
  const sum = history.reduce((a, h) => ({ r: a.r + (h.revenue || 0), c: a.c + (h.costs || 0) }), { r: 0, c: 0 });
  return { revenue: sum.r / n, costs: sum.c / n, n };
}

export function forecast(basis: Basis, s: Scenario): Forecast {
  const keys = horizonKeys(Math.max(1, Math.min(s.horizon || 12, 36)));
  const notes: string[] = [];

  /*
   * Lag is applied on top of whatever the user asked for. A workspace that has
   * never marked an invoice paid has no measured lag, and assuming a plausible
   * 30 days would be inventing the single number this forecast most depends on
   * — so it assumes on time and SAYS so.
   */
  const lag = basis.collection_lag_days ?? 0;
  if (basis.collection_lag_days === null) {
    notes.push('No invoice has been marked paid yet, so payments are assumed to arrive on their due date. Mark invoices paid and this corrects itself.');
  }
  const inShift = lag + (s.collectionShiftDays || 0);

  // Already-raised money, dropped into the month it is expected to land.
  const inByMonth = new Map<string, number>();
  for (const r of basis.receivables || []) {
    const k = shiftedMonth(r.d, inShift);
    if (k) inByMonth.set(k, (inByMonth.get(k) || 0) + Number(r.v || 0));
  }
  const outByMonth = new Map<string, number>();
  for (const p of basis.payables || []) {
    // Bills are NOT shifted by the collection lever. How late our clients pay
    // us says nothing about when our own suppliers expect their money, and
    // moving both together would let a slider improve cash for free.
    const k = shiftedMonth(p.d, 0);
    if (k) outByMonth.set(k, (outByMonth.get(k) || 0) + Number(p.v || 0));
  }

  const rate = runRate(basis.history || []);
  if (rate.n === 0) notes.push('No complete month of history yet — the run-rate lines are zero, so only invoices already raised are projected.');
  else if (rate.n < 3) notes.push(`Run rates are averaged over ${rate.n} month${rate.n === 1 ? '' : 's'} of history, which is thin.`);

  const recurringTotal = (basis.recurring_clients || []).reduce((a, c) => a + Number(c.monthly || 0), 0);
  const top = (basis.recurring_clients || [])[0];

  /*
   * Recurring revenue is the smaller of two readings, and the choice matters.
   * Summing per-client averages counts a client who invoiced three times in six
   * months at their full monthly rate; the overall revenue run rate does not.
   * Taking the lower avoids a forecast that is optimistic by construction —
   * which is the failure mode of every forecast anybody has ever regretted.
   */
  const baseRecurring = rate.n > 0 ? Math.min(recurringTotal, rate.revenue) : recurringTotal;
  if (recurringTotal > rate.revenue && rate.n > 0) {
    notes.push('Recurring revenue is capped at the measured revenue run rate — the per-client averages add up to more than the company has actually billed per month.');
  }

  const fixed = (basis.cost_mix || []).filter((c) => c.fixed).reduce((a, c) => a + Number(c.monthly || 0), 0);
  const variableRaw = (basis.cost_mix || []).filter((c) => !c.fixed).reduce((a, c) => a + Number(c.monthly || 0), 0);
  // The mix is capped the same way and for the same reason as revenue.
  const scale = rate.n > 0 && fixed + variableRaw > rate.costs && fixed + variableRaw > 0
    ? rate.costs / (fixed + variableRaw) : 1;
  const fixedCosts = fixed * scale;
  const variableBase = variableRaw * scale;

  const months: ProjectedMonth[] = [];
  let cash = Number(basis.cash || 0);
  let goesNegative: string | null = null;

  keys.forEach((k, i) => {
    const open = cash;

    // Growth compounds from the first PROJECTED month, so month 0 is the run
    // rate as measured. Compounding from month 0 would apply a month of growth
    // that has not happened yet.
    const growth = Math.pow(1 + (s.growthPct || 0) / 100, i);
    const churned = s.loseTopClient && top && i >= (s.churnFrom || 0) ? Number(top.monthly || 0) : 0;
    const recurring = Math.max(0, (baseRecurring - churned) * growth);

    const invoiced = inByMonth.get(k) || 0;
    const bills = outByMonth.get(k) || 0;

    const variableCosts = variableBase * (1 + (s.costChangePct || 0) / 100) * growth;
    const payroll = i >= (s.hireFrom || 0) ? (s.hires || 0) * (s.hireCost || 0) : 0;
    const oneOff = i === (s.oneOffMonth || 0) ? Number(s.oneOff || 0) : 0;

    const net = invoiced + recurring + oneOff - bills - fixedCosts - variableCosts - payroll;
    cash = open + net;
    if (cash < 0 && !goesNegative) goesNegative = k;

    months.push({ month: k, open, invoiced, recurring, bills, fixedCosts, variableCosts, payroll, oneOff, net, close: cash });
  });

  const idx = goesNegative ? months.findIndex((m) => m.month === goesNegative) : -1;
  return {
    months,
    goesNegative,
    monthsOfCash: idx >= 0 ? idx : null,
    endingNet: months.length ? months[months.length - 1].net : 0,
    notes,
  };
}

/** "Mar 2027" — a forecast is read across a year boundary more often than not. */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}
