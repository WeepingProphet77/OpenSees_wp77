/**
 * Shared result type for ACI/PCI design checks.
 *
 * Every reported capacity in Tessera carries the code clause it comes from and
 * the formula used, so a result is self-documenting in the UI and the PDF
 * report (build spec §6, §13). Modules return arrays of `DesignCheck` plus,
 * where useful, richer intermediate values.
 */
import type { Unit } from '../../units/units';

export type CheckStatus = 'pass' | 'fail' | 'na';

export interface DesignCheck {
  /** Stable short key (for tables / report ordering). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Governing code clause, e.g. "ACI 318-19 §24.5.3.1". */
  clause: string;
  /** Governing formula, written out. */
  formula: string;
  /** Demand (the computed action). */
  demand: number;
  /** Capacity / allowable. */
  capacity: number;
  /** Unit of demand and capacity. */
  unit: Unit;
  /** |demand| / |capacity|. */
  utilization: number;
  status: CheckStatus;
  note?: string;
}

/** Build a DesignCheck, computing utilization and pass/fail from the inputs. */
export function check(args: {
  id: string;
  label: string;
  clause: string;
  formula: string;
  demand: number;
  capacity: number;
  unit: Unit;
  note?: string;
}): DesignCheck {
  const { demand, capacity } = args;
  const utilization =
    capacity !== 0 ? Math.abs(demand) / Math.abs(capacity) : demand === 0 ? 0 : Infinity;
  return { ...args, utilization, status: utilization <= 1 + 1e-9 ? 'pass' : 'fail' };
}
