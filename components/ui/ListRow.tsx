import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The one list row.
 *
 * Every list in the app grew its own: some put the avatar at 32px and some at
 * 36px, some right-aligned a date then a chip and some a chip then a date, some
 * used py-2.5 and some py-3. Individually invisible; together it is the
 * "placements are chaotic" complaint, because scrolling one screen means the eye
 * re-finds the same information at a slightly different place each time.
 *
 * The geometry is fixed here: leading slot, then a title over a quiet sub-line,
 * then trailing content pinned right. Callers choose the CONTENT of each slot,
 * never the spacing.
 */
export default function ListRow({
  leading, title, sub, trailing, href, onClick, className,
}: {
  /** Icon tile, avatar or initials. Sized by the caller; the row reserves the gap. */
  leading?: React.ReactNode;
  title: React.ReactNode;
  /** One quiet line under the title — the row's context, never a second title. */
  sub?: React.ReactNode;
  /** Right-hand content: a chip, an amount, a date, a button. */
  trailing?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const inner = (
    <>
      {leading && <span className="shrink-0">{leading}</span>}
      <span className="min-w-0 flex-1">
        {/* font-medium, not semibold: the title is already separated from the
            sub-line by size and colour, so weight would be a third signal doing
            the same job. */}
        <span className="block text-sm font-medium text-primary truncate">{title}</span>
        {sub && <span className="block text-2xs text-tertiary truncate">{sub}</span>}
      </span>
      {trailing && <span className="shrink-0 flex items-center gap-3">{trailing}</span>}
    </>
  );

  const base = cn(
    'flex items-center gap-3 px-5 py-3.5',
    (href || onClick) && 'hover:bg-surface-hover transition-colors',
    className,
  );

  if (href) return <Link href={href} className={base}>{inner}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cn(base, 'w-full text-left')}>{inner}</button>;
  return <div className={base}>{inner}</div>;
}

/**
 * Solid dark tile for a row's leading slot.
 *
 * Pale grey tiles with a hairline ring read as empty boxes. A solid one reads as
 * an object and anchors the row — the treatment the reference uses throughout.
 * bg-inverse is the existing monochrome token, so it flips in dark mode instead
 * of being a literal near-black that would vanish there.
 */
export function RowTile({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('w-9 h-9 rounded-xl bg-inverse text-inverse-fg flex items-center justify-center', className)}>
      {children}
    </span>
  );
}
