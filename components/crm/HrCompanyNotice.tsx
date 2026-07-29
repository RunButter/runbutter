'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Building2, ArrowRight } from 'lucide-react';
import { listHrCompanies, type HrCompanyOption } from '@/lib/hr/company';
import { setActiveWorkspace } from '@/lib/crm/data';

/**
 * Explains an empty HR screen when the roles are simply in another company.
 *
 * HR follows the active workspace, which is right — but someone who belongs to
 * two companies and has the empty one active sees a blank Positions list with no
 * explanation, which reads exactly like their data was deleted. This says which
 * company is being shown and offers a one-click switch to the one that has
 * roles.
 *
 * Renders nothing at all in the common single-company case, and nothing when the
 * active company already has roles — it should only appear when it has something
 * to explain.
 */
export default function HrCompanyNotice({ privyUserId }: { privyUserId: string | null }) {
  const [companies, setCompanies] = useState<HrCompanyOption[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!privyUserId) return;
    setCompanies(await listHrCompanies(privyUserId));
  }, [privyUserId]);

  useEffect(() => { load(); }, [load]);

  if (!companies || companies.length < 2) return null;

  const active = companies.find((c) => c.active);
  const elsewhere = companies.filter((c) => !c.active && c.positions > 0);
  if (!active || active.positions > 0 || elsewhere.length === 0) return null;

  const switchTo = async (id: string) => {
    if (!privyUserId) return;
    setSwitching(id);
    const res = await setActiveWorkspace(privyUserId, id);
    if (res.error) { setSwitching(null); return; }
    // Every screen resolves its own workspace-scoped data on mount, and much of
    // it is already in client state — a hard reload is the honest way to switch.
    window.location.reload();
  };

  return (
    <div className="rounded-xl bg-warning/10 ring-1 ring-warning/30 p-4">
      <div className="flex items-start gap-2.5">
        <Building2 className="w-4 h-4 text-warning shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-warning">
            You’re viewing <strong>{active.name}</strong>, which has no open positions.
          </p>
          <p className="mt-1 text-[12px] text-warning/90">
            Your roles are in {elsewhere.length === 1 ? 'another company' : 'other companies'} you belong to.
            Nothing has been deleted — switch to see them.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {elsewhere.map((c) => (
              <button key={c.companyId} onClick={() => switchTo(c.companyId)} disabled={!!switching}
                className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-semibold text-warning ring-1 ring-warning/40 bg-warning/10 hover:bg-warning/20 disabled:opacity-50">
                {switching === c.companyId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {c.name}
                <span className="tabular-nums opacity-70">{c.positions}</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
