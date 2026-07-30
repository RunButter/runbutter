import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// A NATIVE <select> styled to match the shadcn field set — deliberately not the
// Radix Select. Our forms are plain value pickers built from `f.options`, so the
// native control keeps the existing onChange contract (no controlled-API
// rewrite), pulls in no extra dependency, and gets the OS picker on mobile for
// free. Reach for Radix only if a picker needs search, icons or multi-select.
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'w-full h-9 pl-2.5 pr-8 text-sm rounded-md bg-surface text-primary ring-1 ring-subtle shadow-sm',
          'appearance-none outline-none transition-shadow cursor-pointer',
          'focus-visible:ring-2 focus-visible:ring-accent/40',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-tertiary" />
    </div>
  )
);
Select.displayName = 'Select';

export { Select };
export default Select;
