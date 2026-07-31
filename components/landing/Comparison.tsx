import { Check, Minus } from 'lucide-react';

/**
 * What RunButter replaces, and where it honestly doesn't.
 *
 * Deliberately makes NO claim about a competitor's price, plan limits or
 * roadmap: those go stale, differ per region, and one wrong figure discredits
 * the whole table. Every row states something checkable — which category a tool
 * covers, and whether it can be self-hosted under a permissive licence — and the
 * named tools are examples of a category, not a scored head-to-head.
 *
 * The last two rows are the ones that cost us: saying "not yet" about a real gap
 * is what makes the rest of the table worth believing.
 */

type Cell = true | false | string;

const ROWS: { capability: string; typical: string; runbutter: Cell }[] = [
  { capability: 'Sales CRM — companies, people, deal pipeline', typical: 'HubSpot, Attio, Twenty', runbutter: true },
  { capability: 'Invoicing, expenses, bank reconciliation', typical: 'QuickBooks, Xero', runbutter: true },
  { capability: 'Marketing — campaigns, forms, short links', typical: 'Mailchimp, HubSpot', runbutter: true },
  { capability: 'Cookieless web analytics', typical: 'Plausible, Fathom', runbutter: true },
  { capability: 'Projects — boards, issues, roadmap', typical: 'Linear, Jira, Kaneo', runbutter: true },
  { capability: 'Hiring — ATS, assessments, careers page', typical: 'Ashby, Greenhouse', runbutter: true },
  { capability: 'E-signatures', typical: 'DocuSign, Dropbox Sign', runbutter: true },
  { capability: 'Document search across uploaded files', typical: 'Dropbox, Google Drive', runbutter: true },
  { capability: 'Sanctions screening (OFAC)', typical: 'ComplyAdvantage', runbutter: true },
  { capability: 'AI agents over your own data', typical: 'per-seat AI add-ons', runbutter: 'Your API key' },
  { capability: 'Runs on one Postgres you own', typical: 'one vendor database each', runbutter: true },
  { capability: 'MIT licensed, no open-core tier', typical: 'proprietary, or open-core', runbutter: true },
  // The honest rows.
  { capability: 'Mobile apps', typical: 'most have them', runbutter: false },
  { capability: 'Accountant-grade double-entry books', typical: 'QuickBooks, Xero', runbutter: false },
];

function Mark({ value }: { value: Cell }) {
  if (value === true) return <Check className="w-4 h-4 text-accent" aria-label="Included" />;
  if (value === false) return <Minus className="w-4 h-4 text-tertiary" aria-label="Not included" />;
  return <span className="text-xs text-secondary">{value}</span>;
}

export default function Comparison() {
  return (
    <section id="compare" className="border-t border-subtle">
      <div className="max-w-5xl mx-auto px-6 py-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl md:text-4xl font-medium tracking-tight">How it compares</h2>
          <p className="text-secondary mt-3 leading-relaxed">
            Most teams run five or six tools that each hold a copy of the same customer. RunButter is
            one relational core across all of it. Below is what that replaces — and the two places it
            honestly does not.
          </p>
        </div>

        {/* Scrolls rather than shrinking: three columns of prose at 360px would
            wrap every cell to four lines. */}
        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
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
