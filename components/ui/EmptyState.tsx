import * as React from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// Shared empty state: icon tile + title + optional line of help + optional
// action. Replaces the bare "No X yet." text that several lists used, so an
// empty screen explains itself and offers the next step.
export default function EmptyState({
  icon: Icon, title, description, action, className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center px-6 py-12', className)}>
      {Icon && (
        <div className="w-11 h-11 rounded-xl bg-surface-sunken ring-1 ring-subtle flex items-center justify-center mb-3">
          <Icon className="w-5 h-5 text-tertiary" />
        </div>
      )}
      <p className="text-sm font-medium text-primary">{title}</p>
      {description && <p className="mt-1 text-xs text-tertiary max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
