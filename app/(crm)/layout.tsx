'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import NavRail from '@/components/crm/NavRail';

// App shell for the Business-OS workspace. The marketing site and the legacy
// /dashboard keep their own layouts; this is the new Twenty-style surface.
// On < lg the rail collapses into a drawer behind a hamburger (same pattern
// as the dashboard layout) so every tab works on mobile.
export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
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
          <span className="text-sm font-medium text-primary">HireBTR</span>
        </header>
        {children}
      </main>
    </div>
  );
}
