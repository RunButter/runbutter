'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navTabsFor } from '@/lib/crm/registry';

/**
 * The tab strip for a nav entry that folds several screens together
 * (Finance → Overview / KPIs / Forecast). Drawn by the SHELL, not by each page,
 * so a screen that becomes a tab needs no edit and cannot forget the strip —
 * and every tab keeps its own URL, so links and bookmarks still land.
 */
export default function SectionTabs() {
  const pathname = usePathname() || '';
  const hit = navTabsFor(pathname);
  if (!hit) return null;
  const on = (href: string) => pathname === href || pathname.startsWith(href + '/');
  return (
    <nav aria-label={hit.label} className="shrink-0 page-x pt-3 -mb-1">
      <div className="inline-flex max-w-full overflow-x-auto items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5">
        {hit.tabs.map((t) => (
          <Link key={t.href} href={t.href} aria-current={on(t.href) ? 'page' : undefined}
            className={`h-8 px-3 inline-flex items-center rounded-md text-sm whitespace-nowrap transition-colors ${
              on(t.href) ? 'bg-surface text-primary shadow-sm font-medium' : 'text-tertiary hover:text-secondary'}`}>
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
