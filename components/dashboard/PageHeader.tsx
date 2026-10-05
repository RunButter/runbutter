import type { ReactNode } from 'react';

// The single page header for every module.
//
// Sits on the CANVAS, not on a white bar with a rule under it. The shell used
// to be a grey rail beside a white page, which read as two panels bolted
// together; now the rail, the header and the page are one surface and the only
// white things are the cards floating on it. A border under the title would put
// the seam straight back.
export default function PageHeader({ title, subtitle, count, badge, children }: {
  title: string;
  /** One short line. Says what the page is for — not a sentence of marketing. */
  subtitle?: string;
  count?: number;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  // ONE GEOMETRY: h-16, everything on the centre line. This used to be
  // `pt-6 pb-4 items-start` while twenty-six pages hand-rolled `h-16
  // items-center`, so the title jumped six pixels and the actions changed
  // height depending on which tab you opened. The subtitle sits on the same
  // line, quieter, rather than adding a second row that only some pages have.
  return (
    <header className="h-16 shrink-0 flex items-center gap-3 px-5 lg:px-7">
      <div className="min-w-0 flex items-center gap-2">
        <h1 className="text-md font-medium text-primary truncate">{title}</h1>
        {count !== undefined && (
          <span className="text-2xs font-medium text-tertiary tabular-nums">{count}</span>
        )}
        {badge}
        {subtitle && <p className="hidden md:block text-xs text-tertiary truncate ml-1">{subtitle}</p>}
      </div>
      {children && <div className="ml-auto flex items-center gap-1.5 shrink-0">{children}</div>}
    </header>
  );
}
