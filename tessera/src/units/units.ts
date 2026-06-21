/**
 * US customary units module for Tessera.
 *
 * Tessera works in a single internal unit system — **kip, in, ksi** — and this
 * module is the one place unit conversions live. Every conversion is explicit,
 * named, and tested. Per the build spec (§13), units are never implicit: UI and
 * reports label quantities, and these helpers are the only sanctioned way to
 * move a value between units within one physical dimension.
 *
 * Canonical (internal) unit per dimension:
 *   length            → in       (inch)
 *   force             → kip
 *   stress            → ksi
 *   moment            → kip-in
 *   distributedLoad   → klf       (kip per linear foot)
 *   unitWeight        → pcf       (pound per cubic foot)
 */

export type Dimension =
  | 'length'
  | 'force'
  | 'stress'
  | 'moment'
  | 'distributedLoad'
  | 'unitWeight';

export type LengthUnit = 'in' | 'ft';
export type ForceUnit = 'lb' | 'kip';
export type StressUnit = 'psi' | 'ksi' | 'psf' | 'ksf';
export type MomentUnit = 'lb-in' | 'lb-ft' | 'kip-in' | 'kip-ft';
export type DistributedLoadUnit = 'plf' | 'klf';
export type UnitWeightUnit = 'pcf';

export type Unit =
  | LengthUnit
  | ForceUnit
  | StressUnit
  | MomentUnit
  | DistributedLoadUnit
  | UnitWeightUnit;

/**
 * Multiplicative factor that converts a value expressed in the given unit into
 * the canonical unit for its dimension (value_canonical = value * factor).
 */
const FACTORS: Record<Dimension, Partial<Record<Unit, number>>> = {
  // canonical: in
  length: {
    in: 1,
    ft: 12,
  },
  // canonical: kip
  force: {
    kip: 1,
    lb: 1 / 1000,
  },
  // canonical: ksi
  stress: {
    ksi: 1,
    psi: 1 / 1000,
    ksf: 1 / 144, // 1 ksf = 1 kip/ft² = (1/144) kip/in² = (1/144) ksi
    psf: 1 / 144000, // 1 psf = (1/1000) ksf -> ksi
  },
  // canonical: kip-in
  moment: {
    'kip-in': 1,
    'kip-ft': 12,
    'lb-in': 1 / 1000,
    'lb-ft': 12 / 1000,
  },
  // canonical: klf (kip/ft)
  distributedLoad: {
    klf: 1,
    plf: 1 / 1000,
  },
  // canonical: pcf
  unitWeight: {
    pcf: 1,
  },
};

/** Human-readable label for each unit (used in the UI and reports). */
export const UNIT_LABELS: Record<Unit, string> = {
  in: 'in',
  ft: 'ft',
  lb: 'lb',
  kip: 'kip',
  psi: 'psi',
  ksi: 'ksi',
  psf: 'psf',
  ksf: 'ksf',
  'lb-in': 'lb·in',
  'lb-ft': 'lb·ft',
  'kip-in': 'kip·in',
  'kip-ft': 'kip·ft',
  plf: 'plf',
  klf: 'klf',
  pcf: 'pcf',
};

/** Canonical (internal) unit for each dimension. */
export const CANONICAL_UNIT: Record<Dimension, Unit> = {
  length: 'in',
  force: 'kip',
  stress: 'ksi',
  moment: 'kip-in',
  distributedLoad: 'klf',
  unitWeight: 'pcf',
};

/** Find the dimension a unit belongs to (throws on an unknown unit). */
export function dimensionOf(unit: Unit): Dimension {
  for (const dim of Object.keys(FACTORS) as Dimension[]) {
    if (unit in FACTORS[dim]) return dim;
  }
  throw new Error(`Unknown unit: ${String(unit)}`);
}

function factor(unit: Unit): number {
  const dim = dimensionOf(unit);
  const f = FACTORS[dim][unit];
  if (f === undefined) throw new Error(`No conversion factor for unit: ${String(unit)}`);
  return f;
}

/**
 * Convert `value` from one unit to another within the same physical dimension.
 * Throws if the two units belong to different dimensions (e.g. ksi → in).
 */
export function convert(value: number, from: Unit, to: Unit): number {
  const fromDim = dimensionOf(from);
  const toDim = dimensionOf(to);
  if (fromDim !== toDim) {
    throw new Error(
      `Cannot convert between dimensions: ${from} (${fromDim}) → ${to} (${toDim})`,
    );
  }
  if (from === to) return value;
  // value_canonical = value * factor(from); value_to = value_canonical / factor(to)
  return (value * factor(from)) / factor(to);
}

/** Convert a value (in the given unit) to its dimension's canonical unit. */
export function toCanonical(value: number, from: Unit): number {
  return convert(value, from, CANONICAL_UNIT[dimensionOf(from)]);
}

/** Convert a canonical-unit value to the requested unit. */
export function fromCanonical(value: number, to: Unit): number {
  return convert(value, CANONICAL_UNIT[dimensionOf(to)], to);
}

// ─── Named convenience conversions ───────────────────────────────────────────
// Explicit, readable helpers for the most common conversions in the codebase.

export const ftToIn = (v: number): number => convert(v, 'ft', 'in');
export const inToFt = (v: number): number => convert(v, 'in', 'ft');

export const kipToLb = (v: number): number => convert(v, 'kip', 'lb');
export const lbToKip = (v: number): number => convert(v, 'lb', 'kip');

export const ksiToPsi = (v: number): number => convert(v, 'ksi', 'psi');
export const psiToKsi = (v: number): number => convert(v, 'psi', 'ksi');
export const ksfToKsi = (v: number): number => convert(v, 'ksf', 'ksi');
export const psfToKsf = (v: number): number => convert(v, 'psf', 'ksf');

export const kipFtToKipIn = (v: number): number => convert(v, 'kip-ft', 'kip-in');
export const kipInToKipFt = (v: number): number => convert(v, 'kip-in', 'kip-ft');

export const plfToKlf = (v: number): number => convert(v, 'plf', 'klf');
export const klfToPlf = (v: number): number => convert(v, 'klf', 'plf');

/**
 * Format a quantity with an explicit unit label, e.g. `formatQuantity(4.03, 'ksi')`
 * → `"4.030 ksi"`. Defaults to 3 significant decimal places.
 */
export function formatQuantity(value: number, unit: Unit, digits = 3): string {
  if (!Number.isFinite(value)) return `${value} ${UNIT_LABELS[unit]}`;
  return `${value.toFixed(digits)} ${UNIT_LABELS[unit]}`;
}
