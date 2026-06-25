import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A labeled result tile — uppercase caption, prominent mono value, optional
 * sub-note. The canonical "stat card" used across the results panels.
 */
export function Stat({
  label,
  value,
  sub,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border bg-card px-3 py-2', className)}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-lg font-semibold tabular-nums">{value}</div>
      {sub != null && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
