import type { DesignCheck } from '@/engine/designChecks/checkTypes';
import { formatQuantity } from '@/units/units';

function UtilizationBar({ u, status }: { u: number; status: DesignCheck['status'] }) {
  const pct = Math.min(u, 1.25) * 80; // 1.0 ≈ 80% of the track; headroom shows overstress
  const color = status === 'fail' ? '#ef4444' : u > 0.9 ? '#f59e0b' : '#22c55e';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-10 text-right font-mono text-xs tabular-nums">
        {Number.isFinite(u) ? `${(u * 100).toFixed(0)}%` : '—'}
      </span>
    </div>
  );
}

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
                <UtilizationBar u={c.utilization} status={c.status} />
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
