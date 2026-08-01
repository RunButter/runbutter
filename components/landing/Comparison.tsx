import { Check, Minus } from 'lucide-react';

/**
 * What RunButter replaces, and where it honestly doesn't.
 *
 * Deliberately makes NO claim about a competitor's price, plan limits or
 * roadmap: those go stale, differ per region, and one wrong figure discredits
 * the whole table. Every row states something checkable — which category a tool
 * covers — and the named tools are examples of a category, not a scored
 * head-to-head.
 *
 * The last two rows are the ones that cost us: saying "no" about a real gap is
 * what makes the rest of the table worth believing. Resist the urge to soften
 * them.
 *
 * A string cell is the third option and exists for a reason: some rows are true
 * but not the whole truth. Chat is channels, not Slack parity, and claiming a
 * bare check there would be the kind of overstatement the honest rows are
 * meant to buy credibility for.
 */

type Cell = true | false | string;

const ROWS: { capability: string; typical: string; runbutter: Cell }[] = [
  { capability: 'Sales CRM — companies, people, deal pipeline', typical: 'HubSpot, Attio, Twenty', runbutter: true },
  { capability: 'Invoicing, expenses, bank reconciliation', typical: 'QuickBooks, Xero', runbutter: true },
  { capability: 'Newsletters, segments and drip sequences', typical: 'Mailchimp, Brevo, Mautic', runbutter: true },
  { capability: 'Lead scoring from real engagement', typical: 'HubSpot, Marketo', runbutter: true },
  { capability: 'Cookieless web analytics', typical: 'Plausible, Fathom', runbutter: true },
  { capability: 'Projects — boards, issues, roadmap', typical: 'Linear, Jira, Kaneo', runbutter: true },
  { capability: 'Hiring — ATS, assessments, careers page', typical: 'Ashby, Greenhouse', runbutter: true },
  { capability: 'E-signatures', typical: 'DocuSign, Dropbox Sign', runbutter: true },
  { capability: 'Document search across uploaded files', typical: 'Dropbox, Google Drive', runbutter: true },
  { capability: 'Two-way sync with a live Excel workbook', typical: 'Zapier, Make (priced per task)', runbutter: true },
  { capability: 'Team chat', typical: 'Slack, Teams', runbutter: 'Channels' },
  { capability: 'Sanctions screening (OFAC)', typical: 'ComplyAdvantage', runbutter: true },
  { capability: 'AI agents over your own data', typical: 'per-seat AI add-ons', runbutter: 'Your API key' },
  { capability: 'Runs on one Postgres you own', typical: 'one vendor database each', runbutter: true },
  { capability: 'MIT licensed, no open-core tier', typical: 'proprietary, or open-core', runbutter: true },
  // The honest rows.
  { capability: 'Native mobile apps', typical: 'most have them', runbutter: false },
  { capability: 'Accountant-grade double-entry books', typical: 'QuickBooks, Xero', runbutter: false },
];

function Mark({ value }: { value: Cell }) {
  if (value === true) return <Check className="w-4 h-4 text-accent" aria-label="Included" />;
  if (value === false) return <Minus className="w-4 h-4 text-tertiary" aria-label="Not included" />;
  return <span className="text-xs text-secondary">{value}</span>;
}

/** The same value as words, for the stacked mobile layout. */
function MobileMark({ value }: { value: Cell }) {
  if (value === true) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent">
        <Check className="w-3.5 h-3.5" /> Included
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-tertiary">
        <Minus className="w-3.5 h-3.5" /> Not yet
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent">
      <Check className="w-3.5 h-3.5" /> {value}
    </span>
  );
}

export default function Comparison() {
  return (
    <section id="compare" className="border-t border-subtle">
      <div className="max-w-5xl mx-auto px-6 py-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl md:text-4xl font-medium tracking-tight">How it compares</h2>
          <p className="text-secondary mt-3 leading-relaxed">
            Most teams run six or seven tools that each hold a copy of the same customer. RunButter is
            one relational core across all of it. Below is what that replaces — and the two places it
            honestly does not.
          </p>
        </div>

        {/* Two layouts rather than one that scrolls sideways. A comparison table
            is the section a buyer reads most carefully, and asking them to drag
            it horizontally on a phone is where they stop reading. */}
        <div className="mt-10 sm:hidden space-y-2.5">
          {ROWS.map((r) => (
            <div key={r.capability} className="rounded-xl border border-subtle bg-surface p-4">
              <div className="text-sm text-primary leading-snug">{r.capability}</div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-xs text-tertiary truncate">{r.typical}</span>
                <span className="shrink-0"><MobileMark value={r.runbutter} /></span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 hidden sm:block">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-strong">
                <th className="py-3 pr-4 text-xs font-medium uppercase tracking-wider text-tertiary">Capability</th>
                <th className="py-3 px-4 text-xs font-medium uppercase tracking-wider text-tertiary">Usually a separate tool</th>
                <th className="py-3 pl-4 text-xs font-medium uppercase tracking-wider text-tertiary whitespace-nowrap">RunButter</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.capability} className="border-b border-subtle">
                  <td className="py-3 pr-4 text-sm text-primary">{r.capability}</td>
                  <td className="py-3 px-4 text-sm text-tertiary">{r.typical}</td>
                  <td className="py-3 pl-4"><Mark value={r.runbutter} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-6 text-xs text-tertiary max-w-2xl leading-relaxed">
          Named tools are examples of a category, not a scored comparison. We make no claim about
          anyone&rsquo;s pricing or plan limits — those change, and a wrong number would say more about
          us than about them.
        </p>
      </div>
    </section>
  );
}
