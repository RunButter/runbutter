import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

// The one button for the whole platform. Compact, flat, token-based.
// Anything that needs a different look is a variant here, not a bespoke
// className on a page.
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent/90',
  secondary: 'bg-surface text-primary border border-subtle hover:bg-surface-hover',
  ghost: 'text-secondary hover:bg-surface-hover hover:text-primary',
  danger: 'bg-danger text-white hover:bg-danger/90',
};

const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2 text-xs gap-1',
  md: 'h-8 px-3 text-sm gap-1.5',
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
        transition-colors duration-100 disabled:opacity-50 disabled:pointer-events-none
        ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...props}
    />
  )
);
Button.displayName = 'Button';
export default Button;
