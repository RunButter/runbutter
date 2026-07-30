import type { ReactNode } from 'react';

// The single page header for every module (CRM objects, Finance, HR, Docs).
// Token-based so it matches the shell in both themes.
export default function PageHeader({ title, count, badge, children }: {
  title: string; count?: number; badge?: ReactNode; children?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 h-14 shrink-0 flex items-center gap-2.5 px-5 border-b border-subtle bg-surface">
      <h1 className="text-sm font-medium text-primary">{title}</h1>
      {count !== undefined && (
        <span className="text-2xs font-medium text-tertiary tabular-nums">{count}</span>
      )}
      {badge}
      {children && <div className="ml-auto flex items-center gap-1.5">{children}</div>}
    </header>
  );
}
