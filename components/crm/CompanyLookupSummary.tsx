'use client';

import { Check, AlertTriangle, Users } from 'lucide-react';
import type { CompanyFacts } from '@/lib/company/client';

/**
 * What "fill in from the tax number" found, grouped by WHERE it came from.
 *
 * A form that fills itself is only trustworthy if it says where each value came
 * from: "email from KRS" is a fact the company filed with a court; "phone from
 * the company website" is what they publish; neither is a guess. Warnings (not
 * an active VAT payer, a register that could not be reached) are shown here
 * rather than buried, because they change what somebody does next.
 */

const LABEL: Record<string, string> = {
  name: 'name', address: 'address', regon: 'REGON', krs: 'register no.', bank_account: 'bank account',
  vat_status: 'VAT status', email: 'email', phone: 'phone', website: 'website', industry: 'industry',
  legal_form: 'legal form', people: 'board', tax_id: 'VAT ID',
};

export default function CompanyLookupSummary({ facts, addBoard, onAddBoard, canAddBoard }: {
  facts: CompanyFacts;
  addBoard: boolean;
  onAddBoard: (v: boolean) => void;
  /** Only when creating: on an existing company the people may already be there. */
  canAddBoard: boolean;
}) {
  const bySource = new Map<string, string[]>();
  for (const [field, source] of Object.entries(facts.sources)) {
    if (!LABEL[field]) continue;
    bySource.set(source, [...(bySource.get(source) || []), LABEL[field]]);
  }
  const vat = facts.vat_status;

  return (
    <div className="sm:col-span-2 rounded-lg ring-1 ring-subtle bg-surface-sunken/60 p-3 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-success font-medium"><Check className="w-3.5 h-3.5" /> Filled in</span>
        {vat && (
          <span className={`rounded px-1.5 py-0.5 text-3xs font-semibold ${facts.vat_active === false ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>
            VAT: {vat}
          </span>
        )}
        {facts.legal_form && <span className="text-tertiary">{facts.legal_form}</span>}
      </div>

      <ul className="space-y-0.5 text-secondary">
        {[...bySource].map(([source, fields]) => (
          <li key={source}><span className="text-primary">{source}</span> — {fields.join(', ')}</li>
        ))}
      </ul>

      {facts.notes.length > 0 && (
        <ul className="space-y-0.5">
          {facts.notes.map((n, i) => (
            <li key={i} className="flex items-start gap-1.5 text-warning"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{n}</li>
          ))}
        </ul>
      )}

      {facts.people.length > 0 && (
        <div className="pt-1 border-t border-subtle">
          <p className="flex items-center gap-1.5 text-secondary mb-1"><Users className="w-3.5 h-3.5 text-tertiary" /> Who can sign for the company</p>
          <ul className="space-y-0.5 text-secondary">
            {facts.people.map((p, i) => (
              <li key={i}><span className="text-primary">{p.first_name} {p.last_name}</span>{p.role && <span className="text-tertiary"> · {p.role}</span>}</li>
            ))}
          </ul>
          {canAddBoard && (
            <label className="mt-1.5 inline-flex items-center gap-2 text-secondary cursor-pointer">
              <input type="checkbox" checked={addBoard} onChange={(e) => onAddBoard(e.target.checked)} className="accent-accent w-3.5 h-3.5" />
              Add {facts.people.length === 1 ? 'them' : `all ${facts.people.length}`} to People at this company
            </label>
          )}
        </div>
      )}
    </div>
  );
}
