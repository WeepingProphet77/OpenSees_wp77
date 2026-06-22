/**
 * ACI 318-19 §5.3 load combinations (LRFD / strength design) and the
 * serviceability combination.
 *
 * A combination is a set of load factors per load category. `governingStrength`
 * returns the combination producing the largest factored effect (for a single
 * action — e.g. a moment or shear value supplied per category). The "or"
 * alternatives in Table 5.3.1 (Lr or S or R; 1.0L or 0.5W) are handled
 * conservatively by including each present load linearly, which is exact when
 * only one roof/lateral load type acts (the common precast case).
 *
 * Categories: D dead, L live, Lr roof live, S snow, R rain, W wind, E seismic.
 */
export type LoadCategory = 'D' | 'L' | 'Lr' | 'S' | 'R' | 'W' | 'E';

export type LoadSet = Partial<Record<LoadCategory, number>>;

export interface LoadCombination {
  name: string;
  clause: string;
  factors: LoadSet;
}

/** ACI 318-19 Table 5.3.1 strength combinations. */
export const ACI_318_19_STRENGTH: LoadCombination[] = [
  { name: 'U1', clause: 'ACI 318-19 §5.3.1(a)', factors: { D: 1.4 } },
  { name: 'U2', clause: 'ACI 318-19 §5.3.1(b)', factors: { D: 1.2, L: 1.6, Lr: 0.5, S: 0.5, R: 0.5 } },
  { name: 'U3', clause: 'ACI 318-19 §5.3.1(c)', factors: { D: 1.2, Lr: 1.6, S: 1.6, R: 1.6, L: 1.0, W: 0.5 } },
  { name: 'U4', clause: 'ACI 318-19 §5.3.1(d)', factors: { D: 1.2, W: 1.0, L: 1.0, Lr: 0.5, S: 0.5, R: 0.5 } },
  { name: 'U5', clause: 'ACI 318-19 §5.3.1(e)', factors: { D: 1.2, E: 1.0, L: 1.0, S: 0.2 } },
  { name: 'U6', clause: 'ACI 318-19 §5.3.1(f)', factors: { D: 0.9, W: 1.0 } },
  { name: 'U7', clause: 'ACI 318-19 §5.3.1(g)', factors: { D: 0.9, E: 1.0 } },
];

const CATEGORIES: LoadCategory[] = ['D', 'L', 'Lr', 'S', 'R', 'W', 'E'];

/** Factored value of one combination applied to a per-category load set. */
export function combinationValue(combo: LoadCombination, loads: LoadSet): number {
  let total = 0;
  for (const c of CATEGORIES) {
    const f = combo.factors[c];
    const v = loads[c];
    if (f != null && v != null) total += f * v;
  }
  return total;
}

export interface GoverningResult {
  value: number;
  combination: LoadCombination;
  /** All combinations evaluated, for reporting. */
  all: Array<{ combination: LoadCombination; value: number }>;
}

/**
 * Governing (maximum) factored effect over the strength combinations.
 * `combos` defaults to the ACI 318-19 set.
 */
export function governingStrength(
  loads: LoadSet,
  combos: LoadCombination[] = ACI_318_19_STRENGTH,
): GoverningResult {
  const all = combos.map((combination) => ({ combination, value: combinationValue(combination, loads) }));
  let best = all[0];
  for (const r of all) if (r.value > best.value) best = r;
  return { value: best.value, combination: best.combination, all };
}

/** Service-level combination D + L + ... (all unfactored), ACI 318-19 §5.3 / Ch. 24. */
export function serviceValue(loads: LoadSet): number {
  return CATEGORIES.reduce((s, c) => s + (loads[c] ?? 0), 0);
}

/** Convenience: the basic gravity strength demand max(1.4D, 1.2D + 1.6L + 0.5Lr). */
export function gravityStrength(D: number, L: number, Lr = 0): GoverningResult {
  return governingStrength({ D, L, Lr });
}
