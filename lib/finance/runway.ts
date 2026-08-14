// Runway: how long the money lasts.
//
// The number a founder checks more often than any other, and the one currently
// living in everybody's spreadsheet because the ledger and the bank balance sit
// in the same database here and nothing joined them.
//
// Pure and dependency-free so it can be tested exactly, which matters more here
// than usual: this is a number people make hiring decisions on, and the three
// ways it goes wrong are all silent.

export interface MonthPoint { month: string; revenue: number; costs: number }

export interface Runway {
  /** Months of cash left, or null when it cannot honestly be said. */
  months: number | null;
  /** Average NET burn per month across the window actually used. */
  burn: number;
  /** How many complete months the average is based on. */
  basedOn: number;
  cash: number;
  /**
   * Why there is no number, when there isn't one. Never an empty string when
   * `months` is null — a blank space where a number should be is the thing that
   * makes somebody assume the feature is broken.
   */
  reason?: 'no-cash' | 'no-history' | 'profitable';
}

/**
 * @param series  Monthly revenue and costs, oldest first. The CURRENT month is
 *                expected to be present and is dropped — see below.
 * @param cash    Cash on hand across bank accounts.
 * @param window  How many complete months to average. Three is the usual
 *                convention: one month is noise, twelve is a different company.
 */
export function runway(series: MonthPoint[], cash: number, window = 3): Runway {
  const now = new Date();
  const currentKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  /**
   * THE PARTIAL MONTH IS DROPPED, AND THIS IS THE WHOLE CORRECTNESS OF THE
   * FEATURE. On the 2nd of the month the ledger holds two days of spend. Averaged
   * in, it halves the apparent burn and doubles the reported runway — so the
   * number is at its most wrong at the start of every month, cheerful, and
   * quietly recovers by the 28th. Nobody would ever catch that by looking.
   *
   * Same rule `monthlyMomentum` already applies to trends. Matched on the month
   * key rather than on array position, because a workspace with no activity this
   * month has no row for it and slicing off the last one would then discard a
   * complete month instead.
   */
  const complete = series.filter((p) => p.month && p.month < currentKey);

  const used = complete.slice(-Math.max(1, window));
  if (used.length === 0) return { months: null, burn: 0, basedOn: 0, cash, reason: 'no-history' };

  // NET burn, not gross costs. Revenue offsets spend, and a company whose
  // revenue covers its costs is not burning at all — reporting its gross costs
  // as burn would put a finite runway on a profitable business.
  const netPerMonth = used.map((p) => (p.costs || 0) - (p.revenue || 0));
  const burn = netPerMonth.reduce((a, b) => a + b, 0) / used.length;

  if (burn <= 0) return { months: null, burn, basedOn: used.length, cash, reason: 'profitable' };
  if (cash <= 0) return { months: null, burn, basedOn: used.length, cash, reason: 'no-cash' };

  return { months: cash / burn, burn, basedOn: used.length, cash };
}

/**
 * Months as people say them.
 *
 * Rounded DOWN, deliberately. Runway is a number somebody plans against, and
 * rounding 5.9 up to 6 tells them they have a month they do not have. Under two
 * months gets a decimal, because the difference between 1.2 and 1.9 is the
 * difference between two very different weeks.
 */
export function fmtRunway(months: number): string {
  if (!isFinite(months) || months <= 0) return '0 months';
  if (months < 2) return `${months.toFixed(1)} months`;
  if (months >= 60) return '5+ years';
  if (months >= 24) return `${Math.floor(months / 12)} years`;
  return `${Math.floor(months)} months`;
}
