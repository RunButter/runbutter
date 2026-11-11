import * as React from 'react';
import { cn } from '@/lib/utils';

// shadcn/ui Textarea on RunButter tokens — same treatment as Input.
const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full px-2.5 py-2 text-sm rounded-md bg-surface text-primary ring-1 ring-subtle shadow-sm',
        'placeholder:text-tertiary outline-none transition-shadow resize-y',
        'focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

export { Textarea };
export default Textarea;
