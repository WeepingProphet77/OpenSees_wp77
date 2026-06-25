import { cn } from '@/lib/utils';

/**
 * Demand/capacity utilization shown as a semantic bar + percent readout, used
 * for every design check (code checks, P-M, handling, …) so the visual language
 * is consistent. Color encodes severity: success (≤ 0.9), warning (0.9–1.0),
 * destructive (failed / > 1.0). The bar is `role="meter"` and the percent text
 * is always present, so it never relies on color alone.
 */
export function UtilizationGauge({
  utilization,
  status,
  className,
}: {
  utilization: number;
  /** Explicit status; without it, fails when utilization > 1. `'na'` renders neutral. */
  status?: 'pass' | 'fail' | 'na';
  className?: string;
}) {
  const u = utilization;
  const finite = Number.isFinite(u);
  const na = status === 'na';
  const failed = status === 'fail' || (status == null && finite && u > 1);
  const color = na
    ? 'var(--muted-foreground)'
    : failed
      ? 'var(--destructive)'
      : u > 0.9
        ? 'var(--warning)'
        : 'var(--success)';
  const pct = finite ? Math.min(Math.max(u, 0), 1.25) * 80 : 0; // 1.0 ≈ 80% of the track; headroom shows overstress
  const label = finite ? `${(u * 100).toFixed(0)}%` : '—';
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="h-1.5 min-w-[3rem] flex-1 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuenow={finite ? Math.round(u * 100) : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Utilization ${label}`}
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-10 text-right font-mono text-xs tabular-nums">{label}</span>
    </div>
  );
}
