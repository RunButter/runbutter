'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Menu, Loader2 } from 'lucide-react';
import { getWorkspace } from '@/lib/crm/data';
import NavRail from '@/components/crm/NavRail';
import LoadErrorBanner from '@/components/crm/LoadErrorBanner';
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
  // The PLAN only. It used to be a whole company row read straight from
  // `company_users` joined to `companies` — both revoked from the browser by
  // 0077, so the read returned nothing and `plan` came through undefined.
  const [plan, setPlan] = useState<string | undefined>(undefined);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (ready && authenticated && user) loadPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, user]);

  /**
   * Read the plan the way the rest of the product does: `get_my_workspace`
   * through the /api/rpc proxy, which returns `workspaces.plan`. Stripe writes
   * `companies.plan` and 0090's trigger mirrors it across, so this is the same
   * value — reached by a path that still works after 0077.
   *
   * Left undefined on any failure. PlanGate renders rather than walls when the
   * plan is unknown, so a bad read costs nothing instead of locking somebody out.
   */
  async function loadPlan() {
    try {
      const ws = await getWorkspace(user!.id);
      if (ws?.plan) setPlan(ws.plan);
    } catch {
      /* leave it unknown — see PlanGate */
    }
  }

  // Keep the shell visible while Privy initialises — a blank white flash
  // between navigation and auth-ready reads as a broken page.
  if (!ready || !authenticated) {
    return (
      <div className="flex h-screen overflow-hidden bg-canvas">
        <div className="hidden lg:flex"><NavRail /></div>
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-tertiary animate-spin" />
        </main>
      </div>
    );
  }

  const requiredFeature = ROUTE_FEATURE.find(([p]) => pathname.startsWith(p))?.[1];

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-primary">
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <div className={`${mobileOpen ? 'flex' : 'hidden'} lg:flex fixed lg:static inset-y-0 left-0 z-50`}>
        <NavRail onNavigate={() => setMobileOpen(false)} />
      </div>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="lg:hidden h-16 shrink-0 flex items-center gap-2 px-6">
          <button aria-label="Open menu" onClick={() => setMobileOpen(true)} className="p-2 -ml-1 text-secondary hover:bg-surface-hover rounded-lg">
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-primary">RunButter</span>
        </header>
        {/* The HR half needs this as much as the CRM half — the panel that made
            the case for it (Settings → Integrations, rendering "no integrations"
            for a read that was failing) lives on this side. */}
        <LoadErrorBanner />
        <div className="flex-1 overflow-y-auto bg-canvas">
          {requiredFeature
            ? <PlanGate plan={plan} feature={requiredFeature}>{children}</PlanGate>
            : children}
        </div>
      </main>
    </div>
  );
}
