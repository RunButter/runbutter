import * as React from 'react';
import { cn } from '@/lib/utils';

// shadcn/ui Input on RunButter tokens. h-9 = the lg control, the height of
// .btn-* and <Button size="lg">, so a field and its button line up; text 12px
// in, the same inset as a button label. Raised like the rest of the redesign: hairline ring + shadow-sm, with
// the accent ring on focus-visible only (so a click doesn't flash the ring).
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full h-9 px-3 text-sm rounded-md bg-surface text-primary ring-1 ring-subtle shadow-sm',
        'placeholder:text-tertiary outline-none transition-shadow',
        'focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export { Input };
export default Input;
