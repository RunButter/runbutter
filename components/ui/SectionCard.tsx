import * as React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The one card-with-a-header.
 *
 * A single screen used to contain four different versions of this: a title with
 * a subtitle and a link, a bare uppercase label with nothing else, a title in a
 * bordered bar with a link but no subtitle, and a plain padded box — at three
 * different paddings (p-3, p-5, px-5 h-12). Nothing was wrong individually, but
 * together they read as unrelated widgets rather than one product.
 *
 * One pattern now, everywhere: title (and optional subtitle) on the left, quiet
 * meta and at most one action on the right. Titles are sentence case at a single
 * size — the old mix of Title Case headings and UPPERCASE labels at the SAME
 * level of the hierarchy is a large part of what looked chaotic. Reserve
 * uppercase for sub-labels *inside* a card, never for the card's own title.
 */
export default function SectionCard({
  title, subtitle, meta, action, actionHref, children,
  flush = false, className, bodyClassName,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Quiet right-hand context: "2 items", "Last 7 days". Not a control. */
  meta?: React.ReactNode;
  /** Link label. Rendered with a trailing arrow; pair with actionHref. */
  action?: React.ReactNode;
  actionHref?: string;
  /** Custom right-hand content instead of the meta/action pair. */
  children?: React.ReactNode;
  /**
   * Body runs edge to edge (lists with full-bleed dividers). The header keeps
   * its own padding and gains a rule beneath it.
   */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
}) {
  const hasHeader = !!(title || subtitle || meta || action);

  return (
    <section className={cn('card-surface', flush && 'overflow-hidden', className)}>
      {hasHeader && (
        <div className={cn(
          'flex items-start justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-7',
          flush && 'pb-4 sm:pb-5 border-b border-subtle',
          !flush && 'pb-4 sm:pb-5',
        )}>
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold text-primary truncate">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-tertiary">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {meta && <span className="text-xs text-tertiary hidden sm:inline">{meta}</span>}
            {action && actionHref && (
              <Link href={actionHref} className="text-xs font-medium text-secondary hover:text-primary inline-flex items-center gap-1 transition-colors">
                {action} <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        </div>
      )}
      <div className={cn(!flush && 'px-5 pb-5 sm:px-6 sm:pb-6 lg:px-8 lg:pb-7', bodyClassName)}>{children}</div>
    </section>
  );
}
