import type { DesignCheck } from '@/engine/designChecks/checkTypes';
import { formatQuantity } from '@/units/units';
import { UtilizationGauge } from '@/components/ui/utilizationGauge';

export function ChecksTable({ checks }: { checks: DesignCheck[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Check</th>
            <th className="py-2 pr-3 font-medium">Demand</th>
            <th className="py-2 pr-3 font-medium">Capacity</th>
            <th className="py-2 pr-3 font-medium">Utilization</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.id} className="border-b align-top last:border-0">
              <td className="py-2 pr-3">
                <div className="font-medium">{c.label}</div>
                <div className="text-xs text-muted-foreground">{c.clause}</div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{c.formula}</div>
                {c.note && <div className="mt-0.5 text-[11px] italic text-muted-foreground">{c.note}</div>}
              </td>
              <td className="py-2 pr-3 font-mono text-xs tabular-nums">{formatQuantity(c.demand, c.unit)}</td>
              <td className="py-2 pr-3 font-mono text-xs tabular-nums">{formatQuantity(c.capacity, c.unit)}</td>
              <td className="py-2 pr-3">
                <UtilizationGauge utilization={c.utilization} status={c.status} className="w-32" />
              </td>
              <td className="py-2">
                <span
                  className={
                    'rounded-full px-2 py-0.5 text-xs font-semibold ' +
                    (c.status === 'pass'
                      ? 'bg-[var(--success)]/15 text-[var(--success)]'
                      : 'bg-destructive/15 text-destructive')
                  }
                >
                  {c.status === 'pass' ? 'PASS' : 'FAIL'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
