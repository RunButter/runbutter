'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import PageHeader from '@/components/dashboard/PageHeader';
import AppLoading from '@/components/ui/AppLoading';
import EmptyState from '@/components/ui/EmptyState';
import { getWorkspace } from '@/lib/crm/data';
import { rpc } from '@/lib/rpc';
import { forecast, monthLabel, DEFAULT_SCENARIO, type Basis, type Scenario } from '@/lib/finance/forecast';

/**
 * "What happens to our cash if…" — the spreadsheet every founder keeps, wired
 * to the ledger instead of retyped once a quarter.
 *
 * ── THE SLIDERS ARE THE FEATURE ─────────────────────────────────────────────
 * A forecast nobody can push on is a report, and people already have reports.
 * Every assumption is on screen and every one of them moves the chart in the
 * same frame, because the arithmetic runs here over facts 0116 supplied — no
 * round trip, no server-side model, nothing an AI touched.
 *
 * ── IT SHOWS ITS WORKING ────────────────────────────────────────────────────
 * Each month separates what is already invoiced from what is assumed to recur,
 * and the assumptions panel lists what was measured versus guessed. A single
 * "expected in" number is unarguable in the bad way: nobody can see which half
 * of it they disbelieve.
 */

const money = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : a >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));
  return `$${s}`;
};
const full = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function ForecastPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [basis, setBasis] = useState<Basis | null>(null);
  const [loading, setLoading] = useState(true);
  const [s, setS] = useState<Scenario>(DEFAULT_SCENARIO);

  useEffect(() => {
    if (!privy) { setLoading(false); return; }
    let cancelled = false;
    getWorkspace(privy).then(async (w) => {
      if (!w || cancelled) { setLoading(false); return; }
      const { data } = await rpc('get_cash_forecast_basis', { p_privy: privy, p_workspace: w.id, p_months: 6 });
      if (!cancelled) { setBasis((data as Basis) ?? null); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [privy]);

  const f = useMemo(() => (basis ? forecast(basis, s) : null), [basis, s]);
  const set = <K extends keyof Scenario>(k: K, v: Scenario[K]) => setS((p) => ({ ...p, [k]: v }));

  if (!ready || loading) return <AppLoading label="Reading your ledger…" />;

  if (!basis || !f) {
    return (
      <>
        <PageHeader title="Cash forecast" />
        <div className="flex-1 min-h-0 overflow-y-auto"><div className="page-body p-6 2xl:p-8">
          <EmptyState title="Nothing to forecast yet"
            description="Add a bank account and a few invoices or expenses, and this projects your cash forward from them." />
        </div></div>
      </>
    );
  }

  const changed = JSON.stringify(s) !== JSON.stringify(DEFAULT_SCENARIO);
  const top = basis.recurring_clients?.[0];

  return (
    <>
      <PageHeader title="Cash forecast" />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="page-body p-6 2xl:p-8 flex flex-col gap-5">

          <Headline f={f} changed={changed} horizon={s.horizon} />

          <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-5">
            <h2 className="text-sm font-medium text-primary">Cash, month by month</h2>
            <Chart months={f.months} />
          </div>

          <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-primary">What if…</h2>
                <p className="mt-0.5 text-2xs text-tertiary">
                  Nothing here is saved or sent. Move a control and the whole projection recalculates.
                </p>
              </div>
              {changed && (
                <button onClick={() => setS(DEFAULT_SCENARIO)}
                  className="h-7 px-2.5 rounded-md text-2xs text-secondary hover:bg-surface-hover ring-1 ring-subtle">
                  Reset
                </button>
              )}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Slider label="Revenue growth" value={s.growthPct} min={-30} max={30} step={1}
                display={`${s.growthPct > 0 ? '+' : ''}${s.growthPct}% / month`}
                note="Compounds. Applies to run-rate revenue, not to invoices already raised."
                onChange={(v) => set('growthPct', v)} />

              <Slider label="Variable costs" value={s.costChangePct} min={-50} max={50} step={5}
                display={`${s.costChangePct > 0 ? '+' : ''}${s.costChangePct}%`}
                note="Only the categories that do not bill every month. Payroll is not cut by a slider."
                onChange={(v) => set('costChangePct', v)} />

              <Slider label="Get paid" value={s.collectionShiftDays} min={-30} max={60} step={5}
                display={s.collectionShiftDays === 0 ? 'as usual'
                  : `${Math.abs(s.collectionShiftDays)} days ${s.collectionShiftDays < 0 ? 'sooner' : 'later'}`}
                note={basis.collection_lag_days !== null
                  ? `Measured: clients pay ${basis.collection_lag_days > 0 ? `${basis.collection_lag_days} days late` : `${Math.abs(basis.collection_lag_days)} days early`} on average, across ${basis.collection_lag_based_on} invoice${basis.collection_lag_based_on === 1 ? '' : 's'}.`
                  : 'No payment has been observed yet, so on-time is assumed.'}
                onChange={(v) => set('collectionShiftDays', v)} />

              <Slider label="New hires" value={s.hires} min={0} max={10} step={1}
                display={s.hires === 0 ? 'none' : `${s.hires} × ${full(s.hireCost)}/mo from ${monthLabel(f.months[Math.min(s.hireFrom, f.months.length - 1)].month)}`}
                note="Fully loaded monthly cost — salary, tax and everything on top."
                onChange={(v) => set('hires', v)}>
                {s.hires > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <NumBox label="Cost each" value={s.hireCost} onChange={(v) => set('hireCost', v)} />
                    <MonthPick label="Starting" value={s.hireFrom} months={f.months.map((m) => m.month)}
                      onChange={(v) => set('hireFrom', v)} />
                  </div>
                )}
              </Slider>

              <Toggle label="Lose your biggest client"
                on={s.loseTopClient} onChange={(v) => set('loseTopClient', v)}
                display={top ? `${top.label} — ${full(top.monthly)}/month` : 'no recurring client detected yet'}
                disabled={!top}>
                {s.loseTopClient && top && (
                  <div className="mt-2">
                    <MonthPick label="From" value={s.churnFrom} months={f.months.map((m) => m.month)}
                      onChange={(v) => set('churnFrom', v)} />
                  </div>
                )}
              </Toggle>

              <div>
                <p className="text-2xs text-secondary">One-off</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <NumBox label="Amount" value={s.oneOff} onChange={(v) => set('oneOff', v)} wide />
                  <MonthPick label="In" value={s.oneOffMonth} months={f.months.map((m) => m.month)}
                    onChange={(v) => set('oneOffMonth', v)} />
                </div>
                <p className="mt-1 text-3xs text-tertiary">
                  A funding round, a tax bill, a piece of equipment. Negative for money going out.
                </p>
              </div>

              <div>
                <p className="text-2xs text-secondary">Horizon</p>
                <div className="mt-1.5 flex gap-1">
                  {[6, 12, 18, 24].map((n) => (
                    <button key={n} onClick={() => set('horizon', n)}
                      className={`h-7 px-2.5 rounded-md text-2xs ${s.horizon === n
                        ? 'bg-accent text-accent-fg' : 'text-secondary hover:bg-surface-hover ring-1 ring-subtle'}`}>
                      {n}m
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <Table months={f.months} />

          <div className="rounded-2xl bg-surface-sunken ring-1 ring-subtle p-4">
            <h3 className="text-2xs font-semibold text-secondary uppercase tracking-wide">What this is built on</h3>
            <ul className="mt-2 flex flex-col gap-1 text-2xs text-tertiary">
              <li>Cash today: <span className="text-secondary tabular-nums">{full(basis.cash)}</span> across your bank accounts.</li>
              <li>Run rates averaged over <span className="text-secondary">{basis.history?.length ?? 0}</span> complete month{(basis.history?.length ?? 0) === 1 ? '' : 's'} — the current, partial month is excluded.</li>
              <li>
                Recurring revenue is <em>inferred</em>: {basis.recurring_clients?.length
                  ? `${basis.recurring_clients.length} client${basis.recurring_clients.length === 1 ? '' : 's'} who invoiced in three or more separate months.`
                  : 'no client has invoiced in three or more separate months yet, so none is assumed.'}
              </li>
              {f.notes.map((n) => <li key={n} className="text-warning">{n}</li>)}
              <li>
                No probability is attached to any of this. It is arithmetic over the assumptions above,
                and every one of them is yours to change.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

function Headline({ f, changed, horizon }: { f: ReturnType<typeof forecast>; changed: boolean; horizon: number }) {
  const end = f.months[f.months.length - 1];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className={`rounded-xl p-4 ring-1 shadow-card ${f.goesNegative
        ? 'bg-danger/5 ring-danger/30' : 'bg-surface ring-subtle'}`}>
        <p className="text-2xs text-tertiary">Cash runs out</p>
        <p className="mt-0.5 text-md font-medium text-primary">
          {f.goesNegative ? monthLabel(f.goesNegative) : `Not within ${horizon} months`}
        </p>
        {f.monthsOfCash !== null && (
          <p className="text-2xs text-tertiary">
            {f.monthsOfCash === 0 ? 'this month' : `${f.monthsOfCash} month${f.monthsOfCash === 1 ? '' : 's'} from now`}
          </p>
        )}
      </div>
      <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card p-4">
        <p className="text-2xs text-tertiary">Cash in {monthLabel(end.month)}</p>
        <p className="mt-0.5 text-md font-medium text-primary tabular-nums">{full(end.close)}</p>
        <p className="text-2xs text-tertiary">{changed ? 'under your scenario' : 'if nothing changes'}</p>
      </div>
      <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card p-4">
        <p className="text-2xs text-tertiary">Net per month, by then</p>
        <p className={`mt-0.5 text-md font-medium tabular-nums ${f.endingNet < 0 ? 'text-danger' : 'text-success'}`}>
          {f.endingNet >= 0 ? '+' : ''}{full(f.endingNet)}
        </p>
        <p className="text-2xs text-tertiary">{f.endingNet < 0 ? 'burning' : 'generating'}</p>
      </div>
    </div>
  );
}

/**
 * Cash line with a zero rule.
 *
 * Inline SVG on semantic tokens, the reason InsightChart and FinanceChart both
 * give: no 110 kB dependency, and it is correct in dark mode without a second
 * palette. The zero line is drawn whenever the range crosses it — the single
 * most important thing on this chart is where the line passes below it.
 */
function Chart({ months }: { months: ReturnType<typeof forecast>['months'] }) {
  const W = 760, H = 240, padX = 44, padTop = 16, padBottom = 30;
  const plotW = W - padX * 2, plotH = H - padTop - padBottom;
  const vals = months.map((m) => m.close);
  const max = Math.max(0, ...vals), min = Math.min(0, ...vals);
  const span = max - min || 1;
  const x = (i: number) => padX + (months.length === 1 ? plotW / 2 : (i / (months.length - 1)) * plotW);
  const y = (v: number) => padTop + plotH - ((v - min) / span) * plotH;
  const line = months.map((m, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(m.close).toFixed(1)}`).join(' ');
  const area = `${line} L${x(months.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const step = Math.ceil(months.length / 8);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" preserveAspectRatio="xMidYMid meet"
      role="img" aria-label="Projected cash by month" className="mt-3">
      <path d={area} fill="hsl(var(--accent))" opacity="0.10" />
      <line x1={padX} x2={W - padX} y1={y(0)} y2={y(0)} stroke="hsl(var(--border-strong))" strokeWidth="1" />
      <text x={padX - 6} y={y(0) + 3} textAnchor="end" fontSize="10" fill="hsl(var(--text-tertiary))">0</text>
      <text x={padX - 6} y={y(max) + 3} textAnchor="end" fontSize="10" fill="hsl(var(--text-tertiary))">{money(max)}</text>
      {min < 0 && (
        <text x={padX - 6} y={y(min) + 3} textAnchor="end" fontSize="10" fill="hsl(var(--text-tertiary))">{money(min)}</text>
      )}
      <path d={line} fill="none" stroke="hsl(var(--accent))" strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" />
      {months.map((m, i) => (
        <circle key={m.month} cx={x(i)} cy={y(m.close)} r="2.5"
          fill={m.close < 0 ? 'hsl(var(--danger))' : 'hsl(var(--accent))'} />
      ))}
      {months.map((m, i) => (i % step === 0 || i === months.length - 1) && (
        <text key={`l${m.month}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10"
          fill="hsl(var(--text-tertiary))">{monthLabel(m.month).replace(' 20', " '")}</text>
      ))}
    </svg>
  );
}

/** Every month, with its parts shown — so an argument can be about one line. */
function Table({ months }: { months: ReturnType<typeof forecast>['months'] }) {
  return (
    <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card overflow-hidden">
      <div className="px-5 pt-5">
        <h2 className="text-sm font-medium text-primary">Where each month comes from</h2>
        <p className="mt-0.5 text-2xs text-tertiary">
          Invoiced is money already raised. Recurring is assumed. The two are kept apart on purpose.
        </p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-2xs">
          <thead>
            <tr className="h-10 border-b border-subtle text-tertiary">
              <th className="text-left font-medium px-5">Month</th>
              <th className="text-right font-medium px-2">Invoiced</th>
              <th className="text-right font-medium px-2">Recurring</th>
              <th className="text-right font-medium px-2">Bills</th>
              <th className="text-right font-medium px-2">Fixed</th>
              <th className="text-right font-medium px-2">Variable</th>
              <th className="text-right font-medium px-2">Payroll</th>
              <th className="text-right font-medium px-2">One-off</th>
              <th className="text-right font-medium px-2">Net</th>
              <th className="text-right font-medium px-5">Cash</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="h-11 border-b border-subtle last:border-0 tabular-nums">
                <td className="px-5 text-primary">{monthLabel(m.month)}</td>
                <td className="px-2 text-right text-secondary">{m.invoiced ? full(m.invoiced) : '—'}</td>
                <td className="px-2 text-right text-secondary">{m.recurring ? full(m.recurring) : '—'}</td>
                <td className="px-2 text-right text-secondary">{m.bills ? `−${full(m.bills)}` : '—'}</td>
                <td className="px-2 text-right text-secondary">{m.fixedCosts ? `−${full(m.fixedCosts)}` : '—'}</td>
                <td className="px-2 text-right text-secondary">{m.variableCosts ? `−${full(m.variableCosts)}` : '—'}</td>
                <td className="px-2 text-right text-secondary">{m.payroll ? `−${full(m.payroll)}` : '—'}</td>
                <td className="px-2 text-right text-secondary">
                  {m.oneOff ? `${m.oneOff < 0 ? '−' : '+'}${full(Math.abs(m.oneOff))}` : '—'}
                </td>
                <td className={`px-2 text-right font-semibold ${m.net < 0 ? 'text-danger' : 'text-success'}`}>
                  {m.net >= 0 ? '+' : '−'}{full(Math.abs(m.net))}
                </td>
                <td className={`px-5 text-right font-semibold ${m.close < 0 ? 'text-danger' : 'text-primary'}`}>
                  {full(m.close)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, display, note, onChange, children }: {
  label: string; value: number; min: number; max: number; step: number;
  display: string; note?: string; onChange: (v: number) => void; children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-2xs text-secondary">{label}</p>
        <p className="text-2xs font-semibold text-primary tabular-nums">{display}</p>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full h-1.5 accent-[hsl(var(--accent))] cursor-pointer" />
      {note && <p className="mt-1 text-3xs text-tertiary">{note}</p>}
      {children}
    </div>
  );
}

function Toggle({ label, on, onChange, display, disabled, children }: {
  label: string; on: boolean; onChange: (v: boolean) => void;
  display: string; disabled?: boolean; children?: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={on} disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="h-3.5 w-3.5 accent-[hsl(var(--accent))]" />
        <span className="text-2xs text-secondary">{label}</span>
      </label>
      <p className="mt-1 text-3xs text-tertiary">{display}</p>
      {children}
    </div>
  );
}

function NumBox({ label, value, onChange, wide }: {
  label: string; value: number; onChange: (v: number) => void; wide?: boolean;
}) {
  // Labelled, because Lighthouse's agentic-browsing check failed on exactly
  // this: an unlabelled number box in a calculator is a box no agent (and no
  // screen reader) can tell apart from the one beside it.
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-3xs text-tertiary">{label}</span>
      <input type="number" value={value} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className={`h-7 ${wide ? 'w-28' : 'w-20'} px-2 rounded-md bg-surface-sunken ring-1 ring-subtle
          text-2xs text-primary tabular-nums`} />
    </label>
  );
}

function MonthPick({ label, value, months, onChange }: {
  label: string; value: number; months: string[]; onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-3xs text-tertiary">{label}</span>
      <select value={Math.min(value, months.length - 1)} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-7 px-2 rounded-md bg-surface-sunken ring-1 ring-subtle text-2xs text-primary">
        {months.map((m, i) => <option key={m} value={i}>{monthLabel(m)}</option>)}
      </select>
    </label>
  );
}
