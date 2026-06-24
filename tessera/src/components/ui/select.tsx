import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Styled native `<select>` — same visual language as {@link Input}. Native keeps
 * it keyboard- and screen-reader-accessible for free; pair it with a `<Label
 * htmlFor>` (or pass an `aria-label` when there is no visible label).
 */
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = 'Select';

export { Select };
