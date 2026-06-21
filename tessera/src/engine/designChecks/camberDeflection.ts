/**
 * Camber & deflection for prestressed members — the PCI multiplier method
 * (PCI Design Handbook, 8th ed.; Martin, 1977), with deflection limits from
 * ACI 318-19 Table 24.2.2.
 *
 * Instantaneous components (simple span, constant eccentricity assumed for v1):
 *   prestress camber (up):    Δp = Pi·e·L² / (8·Eci·Ig)
 *   self-weight deflection:   Δo = 5·w·L⁴ / (384·Eci·Ig)
 *   superimposed dead/live:   Δ  = 5·w·L⁴ / (384·Ec·Ig)
 *
 * Long-term values are obtained by applying the PCI multipliers (no composite
 * topping):
 *   at erection — prestress ×1.80, self-weight ×1.85
 *   final       — prestress ×2.45, self-weight ×2.70, superimposed dead ×3.00
 *
 * Sign convention: upward (camber) positive. Distributed loads w are in kip/in,
 * lengths in in, moduli in ksi → deflections in in.
 */
import { check, type DesignCheck } from './checkTypes';

/** PCI Design Handbook (8th ed.) camber/deflection multipliers (no topping). */
export const PCI_MULTIPLIERS = {
  erectionPrestress: 1.8,
  erectionSelfWeight: 1.85,
  finalPrestress: 2.45,
  finalSelfWeight: 2.7,
  finalSuperimposedDead: 3.0,
} as const;

export interface CamberInput {
  Pi: number; // prestress force at transfer (kip)
  e: number; // eccentricity (in)
  L: number; // span (in)
  Eci: number; // concrete modulus at transfer (ksi)
  Ec: number; // concrete modulus at service (ksi)
  Ig: number; // gross moment of inertia (in⁴)
  wSelf: number; // self weight (kip/in)
  wSuperDead?: number; // superimposed sustained dead (kip/in)
  wLive?: number; // live load (kip/in)
  /** Deflection-limit denominators (ACI Table 24.2.2). Defaults: live L/360, long-term L/240. */
  limits?: { live?: number; longTerm?: number };
}

export interface CamberResult {
  /** Instantaneous prestress camber at release (in, +up). */
  prestressCamber: number;
  /** Instantaneous self-weight deflection at release (in, downward magnitude). */
  selfWeightDeflection: number;
  /** Net camber at release (in, +up). */
  camberAtRelease: number;
  /** Net camber at erection (in, +up). */
  camberAtErection: number;
  /** Net long-term (final) camber (in, +up). */
  finalCamber: number;
  /** Instantaneous superimposed-dead deflection (in, downward magnitude). */
  superDeadDeflection: number;
  /** Instantaneous live-load deflection (in, downward magnitude). */
  liveDeflection: number;
  checks: DesignCheck[];
}

const simpleSpanUniform = (w: number, L: number, E: number, I: number): number =>
  (5 * w * Math.pow(L, 4)) / (384 * E * I);

export function camberDeflection(input: CamberInput): CamberResult {
  const {
    Pi,
    e,
    L,
    Eci,
    Ec,
    Ig,
    wSelf,
    wSuperDead = 0,
    wLive = 0,
    limits = {},
  } = input;
  const liveLimit = limits.live ?? 360;
  const longTermLimit = limits.longTerm ?? 240;

  const prestressCamber = (Pi * e * L * L) / (8 * Eci * Ig); // +up
  const selfWeightDeflection = simpleSpanUniform(wSelf, L, Eci, Ig); // down magnitude
  const superDeadDeflection = simpleSpanUniform(wSuperDead, L, Ec, Ig); // down magnitude
  const liveDeflection = simpleSpanUniform(wLive, L, Ec, Ig); // down magnitude

  const camberAtRelease = prestressCamber - selfWeightDeflection;
  const camberAtErection =
    PCI_MULTIPLIERS.erectionPrestress * prestressCamber -
    PCI_MULTIPLIERS.erectionSelfWeight * selfWeightDeflection;
  const finalCamber =
    PCI_MULTIPLIERS.finalPrestress * prestressCamber -
    PCI_MULTIPLIERS.finalSelfWeight * selfWeightDeflection -
    PCI_MULTIPLIERS.finalSuperimposedDead * superDeadDeflection;

  // Net long-term downward deflection (0 if the member is still in net camber).
  const longTermDownward = Math.max(0, -finalCamber);

  const checks: DesignCheck[] = [
    check({
      id: 'deflection-live',
      label: 'Immediate live-load deflection',
      clause: 'ACI 318-19 Table 24.2.2',
      formula: `Δ_live = 5·wL·L⁴/(384·Ec·Ig) ≤ L/${liveLimit}`,
      demand: liveDeflection,
      capacity: L / liveLimit,
      unit: 'in',
    }),
    check({
      id: 'deflection-longterm',
      label: 'Net long-term downward deflection',
      clause: 'ACI 318-19 Table 24.2.2 (PCI multipliers)',
      formula: `max(0, −Δ_final) ≤ L/${longTermLimit}`,
      demand: longTermDownward,
      capacity: L / longTermLimit,
      unit: 'in',
      note:
        finalCamber >= 0
          ? `Member retains net upward camber of ${finalCamber.toFixed(3)} in at final.`
          : undefined,
    }),
  ];

  return {
    prestressCamber,
    selfWeightDeflection,
    camberAtRelease,
    camberAtErection,
    finalCamber,
    superDeadDeflection,
    liveDeflection,
    checks,
  };
}
