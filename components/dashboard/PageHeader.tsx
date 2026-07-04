import type { ReactNode } from 'react';

// Dense sticky page header for the HR (ATS) pages, matching the platform shell
// (Finance/Transactions/Home). Renders a title, optional count + badge, and a
// right-aligned actions slot. Sticks to the top of the dashboard scroll area.
export default function PageHeader({ title, count, badge, children }: {
  title: string; count?: number; badge?: ReactNode; children?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200/70 bg-white/90 backdrop-blur">
      <h1 className="text-sm font-bold text-slate-800">{title}</h1>
      {count !== undefined && (
        <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 rounded-md px-1.5 py-0.5 tabular-nums">{count}</span>
      )}
      {badge}
      {children && <div className="ml-auto flex items-center gap-1.5">{children}</div>}
    </header>
  );
}
