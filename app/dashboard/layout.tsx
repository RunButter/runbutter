'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Menu } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import NavRail from '@/components/crm/NavRail';
import PlanGate from '@/components/PlanGate';
import { type PlanFeature } from '@/lib/plans';

// The legacy ATS now renders inside the SAME Twenty-style shell (NavRail) as the
// rest of the platform, so navigating between HR and Sales/Finance no longer
// swaps the whole UI. Auth gating + per-route PlanGate are preserved.
const ROUTE_FEATURE: [string, PlanFeature][] = [
  ['/dashboard/treasury', 'talentTreasury'],
  ['/dashboard/sources', 'sourceTracking'],
  ['/dashboard/templates', 'emailTemplates'],
  ['/dashboard/interviews', 'interviews'],
  ['/dashboard/my-team', 'myTeam'],
  ['/dashboard/analytics', 'advancedAnalytics'],
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, ready, authenticated } = usePrivy();
  const [company, setCompany] = useState<any>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (ready && authenticated && user) loadCompanyData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, user]);

  async function loadCompanyData() {
    try {
      await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: user!.id, is_local: false });
      const { data } = await supabase.from('company_users').select('*, company:companies(*)').eq('privy_user_id', user!.id).single();
      if (data?.company) setCompany(data.company);
    } catch {
      /* non-fatal */
    }
  }

  if (!ready || !authenticated) {
    return <div className="min-h-screen bg-white" />;
  }

  const requiredFeature = ROUTE_FEATURE.find(([p]) => pathname.startsWith(p))?.[1];

  return (
    <div className="flex h-screen overflow-hidden bg-white text-slate-900">
      {mobileOpen && <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <div className={`${mobileOpen ? 'flex' : 'hidden'} lg:flex fixed lg:static inset-y-0 left-0 z-50`}>
        <NavRail onNavigate={() => setMobileOpen(false)} />
      </div>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="lg:hidden h-12 shrink-0 flex items-center gap-2 px-3 border-b border-slate-200/70">
          <button aria-label="Open menu" onClick={() => setMobileOpen(true)} className="p-2 -ml-1 text-slate-600 hover:bg-slate-100 rounded-lg">
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-bold text-slate-800">HireBTR</span>
        </header>
        <div className="flex-1 overflow-y-auto bg-slate-50/30">
          {company && requiredFeature ? (
            <PlanGate plan={company.plan} feature={requiredFeature}>{children}</PlanGate>
          ) : (
            children
          )}
        </div>
      </main>
    </div>
  );
}
