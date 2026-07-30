import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The one page-title block.
 *
 * Pages used to hand-roll this, and the result was a single flex row holding the
 * title, a status chip, a plan chip and the primary button. On a phone that
 * wraps into a ragged three-line pile with no clear starting point — the
 * "chaotic, no harmony" complaint, exactly.
 *
 * So the structure is fixed here rather than per page: an identity block on the
 * left (title, then badges, then a quiet one-line subtitle), actions on the
 * right, and on narrow screens actions drop to their own row instead of
 * squeezing in beside the title.
 */
export default function PageHeader({
  title, subtitle, badges, actions, className,
}: {
  title: React.ReactNode;
  /** One line saying what this screen is for. Worth writing — it's what makes a title look deliberate. */
  subtitle?: React.ReactNode;
  /** Status chips (Live/Sample, plan). Sit WITH the title, never in the action row. */
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-medium text-primary tracking-tight">{title}</h1>
          {badges}
        </div>
        {subtitle && <p className="mt-1 text-sm text-tertiary">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
