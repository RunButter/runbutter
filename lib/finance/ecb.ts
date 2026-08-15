/**
 * The European Central Bank's reference-rate feed, parsed.
 *
 * Zero imports and no Node APIs, so it is testable without a database or a
 * network — the same reason lib/finance/runway.ts and lib/vault/password.ts are
 * shaped this way. It started life inside the route handler and could not be
 * exercised at all, which for a parser is the wrong way round.
 *
 * ── HAND-PARSED, DELIBERATELY ───────────────────────────────────────────────
 * The format has been stable for two decades and is three nested elements:
 *
 *   <Cube><Cube time='2026-08-14'><Cube currency='USD' rate='1.0921'/>…
 *
 * A small, stable, known input does not justify an XML dependency — the same
 * call lib/markdown.ts makes. What it DOES justify is care about one thing.
 */

export interface EcbDay { day: string; rates: Record<string, string> }

/**
 * Rates grouped by the day they were published under.
 *
 * SPLIT ON THE DATED CUBE FIRST. That is the whole correctness of this
 * function: the 90-day feed contains ninety `<Cube time=…>` blocks, and a flat
 * scan for `currency=` would attribute every rate in the file to one day —
 * producing a result that parses cleanly, looks entirely normal, and silently
 * values a March invoice at August's rate.
 */
export function parseEcb(xml: string): EcbDay[] {
  const out: EcbDay[] = [];
  const parts = String(xml || '').split(/<Cube\s+time=['"]/i).slice(1);
  for (const part of parts) {
    const day = part.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    // Only up to the next dated block, so a currency can never leak forward.
    const scope = part.split(/<Cube\s+time=['"]/i)[0];
    const rates: Record<string, string> = {};
    for (const m of scope.matchAll(/currency=['"]([A-Za-z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g)) {
      rates[m[1].toUpperCase()] = m[2];
    }
    if (Object.keys(rates).length) out.push({ day, rates });
  }
  return out;
}

export const ECB_DAILY = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
export const ECB_HIST90 = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';
