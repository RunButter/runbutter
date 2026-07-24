'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Menu } from 'lucide-react';
import NavRail from '@/components/crm/NavRail';
import CommandPalette from '@/components/CommandPalette';
import PlanGate from '@/components/PlanGate';
import { getWorkspace } from '@/lib/crm/data';
import type { PlanFeature } from '@/lib/plans';

// App shell for the Business-OS workspace. The marketing site and the legacy
// /dashboard keep their own layouts; this is the new Twenty-style surface.
// On < lg the rail collapses into a drawer behind a hamburger (same pattern
// as the dashboard layout) so every tab works on mobile.

// Entitlements for the Business-OS routes. Until this existed, the whole CRM
// half — agents, automations, API/MCP, e-sign, reports — was ungated while only
// the legacy /dashboard ATS routes were charged for.
//
// Deliberately ABSENT (free on every plan, forever): the relational core —
// /objects/*, /pipelines/*, /projects/*, /finance/* and /docs. Gating those
// would gut the product's first impression; we charge for scale, automation,
// AI and governance instead. Longest prefixes first so they win the match.
const ROUTE_FEATURE: [string, PlanFeature][] = [
  ['/agents', 'aiAgents'],
  ['/settings/assistant', 'aiAgents'],
  ['/settings/automations', 'automations'],
  ['/settings/integrations', 'apiAccess'],
  ['/settings/reports', 'scheduledReports'],
  ['/settings/branding', 'branding'],
  ['/marketing/analytics', 'webAnalytics'],
  ['/marketing/posts', 'postStudio'],
  ['/marketing/links', 'shortLinks'],
  ['/marketing/forms', 'customForms'],
  ['/finance/sign', 'eSignatures'],
];

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const { ready, authenticated, user } = usePrivy();
  const [plan, setPlan] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    let cancelled = false;
    getWorkspace(user.id).then((ws) => { if (!cancelled) setPlan(ws?.plan ?? 'free'); }).catch(() => {});
    return () => { cancelled = true; };
  }, [ready, authenticated, user]);

  const requiredFeature = ROUTE_FEATURE.find(([p]) => pathname.startsWith(p))?.[1];

  // Render children untouched until the plan is known, so a paid customer never
  // sees a flash of the upgrade wall while the workspace loads.
  const body = requiredFeature && plan
    ? <PlanGate plan={plan} feature={requiredFeature}>{children}</PlanGate>
    : children;

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-primary">
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <div className={`${mobileOpen ? 'flex' : 'hidden'} lg:flex fixed lg:static inset-y-0 left-0 z-50`}>
        <NavRail onNavigate={() => setMobileOpen(false)} />
      </div>
      <main className="flex-1 flex flex-col overflow-hidden bg-surface lg:border-l lg:border-subtle">
        <header className="lg:hidden h-12 shrink-0 flex items-center gap-2 px-3 border-b border-subtle">
          <button aria-label="Open menu" onClick={() => setMobileOpen(true)} className="p-2 -ml-1 text-secondary hover:bg-surface-hover rounded-md">
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-primary">RunButter</span>
        </header>
        {body}
      </main>
      <CommandPalette />
    </div>
  );
}
