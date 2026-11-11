import * as React from 'react';
import { cn } from '@/lib/utils';

// Field label at the app's form density. Medium, not semibold: a label is
// set apart by size and colour (Astryx's label role), and 6px above its field
// keeps it closer to that field than to the one above (spatial hierarchy). `required` renders the danger asterisk
// so every form marks required fields the same way.
const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }
>(({ className, required, children, ...props }, ref) => (
  <label ref={ref} className={cn('block text-xs font-medium text-secondary mb-1.5', className)} {...props}>
    {children}
    {required && <span className="text-danger"> *</span>}
  </label>
));
Label.displayName = 'Label';

export { Label };
export default Label;
