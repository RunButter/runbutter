'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Timer, ArrowRight } from 'lucide-react';
import { runway, fmtRunway, type Runway } from '@/lib/finance/runway';
import { loadFinanceAnalytics, loadBankAccounts } from '@/lib/crm/data';

/**
 * How long the money lasts.
 *
 * The number a founder checks more often than any other, and it has been
 * computable here the whole time — the ledger and the bank balances are in the
 * same database, and nothing joined them. Everybody was opening a spreadsheet
 * to do a division this product could have done.
 *
 * It hides itself unless there is CASH AND HISTORY. A runway card on a
 * workspace with no bank account is a card about nothing, and a workspace that
 * has been open a fortnight has no complete month to average — showing "no
 * data" in both cases teaches people the feature is broken rather than that
 * they have not used it yet.
 */
export default function RunwayCard({ privy }: { privy: string | null }) {
  const [r, setR] = useState<Runway | null>(null);

  useEffect(() => {
    if (!privy) return;
    let off = false;
    // Both loaders take the privy id and resolve the workspace themselves, and
    // both fall back to sample data when unauthenticated — which is exactly why
    // `live` is checked below rather than assumed.
    // `loadFinance` returns totals only; the MONTHLY series lives on
    // `loadFinanceAnalytics`. Six months asked for, three averaged — the extra
    // months are what make a gap month harmless.
    Promise.all([loadFinanceAnalytics(privy, 6), loadBankAccounts(privy)])
      .then(([fin, accounts]) => {
        if (off) return;
        // Sample data must never produce a runway. A fabricated number about
        // somebody's survival is the worst possible thing to fabricate, and the
        // rest of the app already draws this line with the amber "Sample" badge.
        if (!fin?.live) return;
        if (!accounts?.live) return;
        const cash = (accounts.accounts || []).reduce((sum: number, a: any) => sum + (Number(a.balance) || 0), 0);
        setR(runway(fin.series || [], cash));
      })
      .catch(() => {});
    return () => { off = true; };
  }, [privy]);

  if (!r) return null;
  // Profitable is worth saying; the other two silences are not worth a card.
  if (r.months === null && r.reason !== 'profitable') return null;

  const low = r.months !== null && r.months < 6;

  return (
    <section className="card-surface p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Timer className="w-3.5 h-3.5 text-tertiary" />
          <span className="text-2xs font-medium uppercase tracking-wider text-tertiary">Runway</span>
        </div>
        <Link href="/finance/overview" className="text-xs text-secondary hover:text-primary inline-flex items-center gap-1">
          Finance <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {r.months === null ? (
        <>
          <div className="text-md font-medium text-success-text">Not burning</div>
          <p className="text-xs text-secondary mt-1.5 leading-relaxed">
            Revenue has covered costs across the last {r.basedOn} month{r.basedOn === 1 ? '' : 's'}, so there is
            no runway to run out of.
          </p>
        </>
      ) : (
        <>
          <div className={`text-md font-medium tabular-nums ${low ? 'text-warning' : 'text-primary'}`}>
            {fmtRunway(r.months)}
          </div>
          <p className="text-xs text-secondary mt-1.5 leading-relaxed">
            {fmtMoney(r.cash)} in the bank against {fmtMoney(r.burn)} a month, averaged over the last{' '}
            {r.basedOn} complete month{r.basedOn === 1 ? '' : 's'}.
            {/* Said plainly, because it is the single thing that makes the
                number trustworthy — and the thing a spreadsheet gets wrong on
                the 2nd of every month. */}
            {' '}This month is still running, so it is not counted.
          </p>
        </>
      )}
    </section>
  );
}

/** Whole units. Runway is a planning number; the pennies are noise. */
function fmtMoney(n: number): string {
  const v = Math.round(Math.abs(n));
  return `${n < 0 ? '-' : ''}${v.toLocaleString()}`;
}
