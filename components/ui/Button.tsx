import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

// The one button for the whole platform. Compact, flat, token-based.
// Anything that needs a different look is a variant here, not a bespoke
// className on a page.
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-inverse text-inverse-fg hover:bg-inverse/90',
  secondary: 'bg-surface text-primary border border-subtle hover:bg-surface-hover',
  ghost: 'text-secondary hover:bg-surface-hover hover:text-primary',
  danger: 'bg-danger text-danger-fg hover:bg-danger/90',
};

// The control ramp (Astryx control rhythm, shared with .btn and the fields):
// sm 28 · md 32 · lg 36. A button and a field in one row use the SAME size.
// Inline padding grows with height so the label keeps the same proportion of
// air at every size; the icon gap is 8px except on the compact size.
const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-8 px-3 text-sm gap-2',
  lg: 'h-9 px-3.5 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', className = '', ...props }, ref) => (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap
        transition-[background-color,color,opacity,transform] active:scale-[0.98]
        disabled:opacity-50 disabled:pointer-events-none
        ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...props}
    />
  )
);
Button.displayName = 'Button';
export default Button;
