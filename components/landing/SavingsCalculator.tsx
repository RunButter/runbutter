'use client';

import { useMemo, useState } from 'react';
import { PLANS } from '@/lib/plans';

/**
 * "What are you paying now?" — the savings number, without quoting anybody.
 *
 * WHY IT ASKS INSTEAD OF TELLING. The obvious version of this section is a
 * table of competitor list prices with a total at the bottom. Comparison.tsx
 * already refuses to do that, and its reasoning holds here: prices go stale,
 * differ by region, plan and negotiated discount, and ONE wrong figure
 * discredits every other number on the page. It is also the kind of claim a
 * competitor can complain about.
 *
 * Asking the visitor is not the timid version — it is the better one. The
 * number that persuades somebody is their own bill, not an average. It cannot
 * go out of date, it cannot be wrong, and nobody argues with a figure they
 * typed themselves.
 *
 * The defaults below are a STARTING POSITION for a slider, deliberately round,
 * and attached to a CATEGORY rather than a vendor. "Email marketing: $40" is a
 * dial someone drags to their own number. "Mailchimp: $40" is a claim about
 * Mailchimp. Only one of those is ours to make.
 *
 * RunButter's own side is read from lib/plans.ts — the file that actually gates
 * features — so this cannot drift from what a customer would be charged.
 */

/**
 * `perSeat` follows how each CATEGORY is genuinely sold, not what flatters us.
 *
 * The first version marked only CRM and Projects as per-seat, so a 20-person
 * team came out CHEAPER staying put — which is not a brave truth, it is a
 * modelling error. CRM, project tracking, e-signature and chat products are
 * per-user almost universally; email, analytics and automation are billed by
 * volume (contacts, pageviews, tasks) and do not scale with headcount at all.
 * Getting that split right is what makes the total move the way a real bill
 * moves. Every number stays editable regardless.
 */
const CATEGORIES: { label: string; note: string; monthly: number; perSeat?: boolean }[] = [
  { label: 'CRM', note: 'contacts, deals, pipeline', monthly: 20, perSeat: true },
  { label: 'Projects', note: 'boards, issues, roadmap', monthly: 8, perSeat: true },
  { label: 'E-signatures', note: 'send and sign documents', monthly: 15, perSeat: true },
  { label: 'Team chat', note: 'channels and DMs', monthly: 7, perSeat: true },
  { label: 'Invoicing & books', note: 'invoices, expenses, reconciliation', monthly: 30 },
  { label: 'Email marketing', note: 'billed by contacts', monthly: 40 },
  { label: 'Web analytics', note: 'billed by pageviews', monthly: 14 },
  { label: 'Automation', note: 'billed per task', monthly: 30 },
];

// Explicit locale. A bare toLocaleString() formats with the runtime's own
// locale, so Node's ICU renders "3,600" while a browser set to pl-PL renders
// "3 600" — the server HTML and the client's first render disagree and React
// throws a hydration error (#425). It is invisible on small numbers, which is
// exactly why it survives review.
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Stable id per tool name, so the label's htmlFor matches its input. */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export default function SavingsCalculator() {
  const [seats, setSeats] = useState(5);
  const [on, setOn] = useState<string[]>(['CRM', 'Projects', 'Invoicing & books', 'Email marketing', 'E-signatures']);
  const [spend, setSpend] = useState<Record<string, number>>(
    Object.fromEntries(CATEGORIES.map((c) => [c.label, c.monthly])),
  );

  const current = useMemo(
    () => CATEGORIES.filter((c) => on.includes(c.label))
      .reduce((sum, c) => sum + spend[c.label] * (c.perSeat ? seats : 1), 0),
    [on, spend, seats],
  );

  // Business, because that is the tier with the agents, the API and MCP — the
  // things the categories above do not include at any price.
  const ours = Number(String(PLANS.business.price).replace(/[^\d.]/g, '')) * seats;
  const saved = current - ours;

  const toggle = (label: string) =>
    setOn((xs) => (xs.includes(label) ? xs.filter((x) => x !== label) : [...xs, label]));

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6 lg:gap-10 items-start">
      <div className="min-w-0">
        <div className="flex items-center gap-3 mb-5">
          <label htmlFor="seats" className="text-xs text-secondary">Team size</label>
          <input id="seats" type="range" min={1} max={50} value={seats}
            onChange={(e) => setSeats(Number(e.target.value))}
            className="flex-1 max-w-[220px] accent-accent" />
          <span className="text-sm font-medium text-primary tabular-nums w-16">{seats} {seats === 1 ? 'seat' : 'seats'}</span>
        </div>

        <div className="grid sm:grid-cols-2 gap-2">
          {CATEGORIES.map((c) => {
            const active = on.includes(c.label);
            return (
              <div key={c.label}
                className={`rounded-xl p-3 transition-colors ${active ? 'bg-surface ring-1 ring-subtle' : 'bg-surface-sunken/60'}`}>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={active} onChange={() => toggle(c.label)}
                    className="mt-0.5 rounded border-strong accent-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="text-xs font-medium text-primary block">{c.label}</span>
                    <span className="text-2xs text-tertiary block">{c.note}</span>
                  </span>
                </label>
                {active && (
                  <div className="mt-2.5 flex items-center gap-2 pl-6">
                    <span className="text-2xs text-tertiary" aria-hidden="true">$</span>
                    {/* A real label, not a placeholder or a bare box. Lighthouse
                        failed this under Accessibility AND under Agentic
                        Browsing — an agent reading the page cannot tell which
                        number belongs to which tool from a class name, and the
                        whole point of this widget is that somebody types their
                        actual spend into it. */}
                    <label className="sr-only" htmlFor={`spend-${slug(c.label)}`}>
                      {`Monthly spend on ${c.label} in dollars${c.perSeat ? ', per seat' : ''}`}
                    </label>
                    <input type="number" min={0} value={spend[c.label]}
                      id={`spend-${slug(c.label)}`} name={`spend-${slug(c.label)}`}
                      inputMode="numeric"
                      aria-describedby={`spend-unit-${slug(c.label)}`}
                      onChange={(e) => setSpend((s) => ({ ...s, [c.label]: Math.max(0, Number(e.target.value) || 0) }))}
                      className="w-20 h-7 rounded-md bg-surface-sunken ring-1 ring-subtle px-2 text-2xs font-mono text-primary tabular-nums" />
                    <span className="text-2xs text-tertiary" id={`spend-unit-${slug(c.label)}`}>
                      /mo{c.perSeat ? ' per seat' : ''}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-2xs text-tertiary leading-relaxed">
          Every figure here is yours to change — they start at round numbers, not at any vendor&apos;s price list.
        </p>
      </div>

      {/* The result. Sticky on desktop so the number follows while you toggle. */}
      <div className="lg:sticky lg:top-24 rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-secondary">You pay now</span>
          <span className="text-lg font-medium text-primary tabular-nums">{money(current)}<span className="text-xs text-tertiary">/mo</span></span>
        </div>
        <div className="flex items-baseline justify-between mt-2.5 pb-4 border-b border-subtle">
          <span className="text-xs text-secondary">RunButter Business</span>
          <span className="text-lg font-medium text-primary tabular-nums">{money(ours)}<span className="text-xs text-tertiary">/mo</span></span>
        </div>

        {saved > 0 ? (
          <div className="mt-4">
            <span className="text-3xs font-medium uppercase tracking-wide text-tertiary">You keep</span>
            <div className="text-4xl font-medium tracking-tight text-primary tabular-nums mt-1">{money(saved * 12)}</div>
            <div className="text-xs text-secondary mt-1">a year, at {seats} {seats === 1 ? 'seat' : 'seats'}</div>
          </div>
        ) : (
          // Never render a negative as if it were a win. At one seat with two
          // cheap tools, we genuinely cost more — and a calculator that hides
          // that is one nobody trusts on the numbers that matter.
          <div className="mt-4">
            <div className="text-sm font-medium text-primary">Cheaper to stay where you are.</div>
            <p className="text-xs text-secondary mt-1.5 leading-relaxed">
              At this size the tools you have cost less. The free tier is still there, and self-hosting is $0.
            </p>
          </div>
        )}

        <ul className="mt-5 pt-4 border-t border-subtle space-y-1.5">
          {['One database, not eight', 'No per-task automation billing', 'AI on your own key', 'Or self-host for $0'].map((t) => (
            <li key={t} className="text-2xs text-secondary">{t}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
