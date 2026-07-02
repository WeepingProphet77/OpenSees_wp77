/**
 * Torsion design — ACI 318-19 §22.7 (thin-walled tube / space-truss analogy),
 * with the detailing minimums of §9.6.4. Threshold torsion below which torsion
 * may be neglected (§22.7.1.1), cracking torsion (§22.7.5.1), the closed-stirrup
 * + longitudinal steel required for equilibrium/compatibility torsion, and the
 * combined shear+torsion cross-section adequacy limit (§22.7.7.1).
 *
 * A single design angle θ = 45° (cotθ = 1) is used, per the common ACI simplifying
 * choice. The section is idealized with:
 *   - Acp, pcp — area / perimeter enclosed by the OUTSIDE concrete perimeter
 *     (computed from the real section polygon; correct for any shape).
 *   - Aoh, ph — area / perimeter of the closed-stirrup centerline, from a
 *     rectangular cage inscribed in the web (bw, h) at the stirrup cover. Ao ≈
 *     0.85·Aoh (§22.7.6.1.1).
 *
 * Units: f'c, fyt, fy in ksi; Tu in kip-in; Vu, Vc in kip; lengths in in; the
 * §22.7.7.1 stress check is evaluated in psi.
 */
import { check, type DesignCheck } from './checkTypes';

/** φ for shear and torsion, ACI 318-19 Table 21.2.1. */
export const PHI_TORSION = 0.75;

export interface TorsionInput {
  /** Factored torsional moment at the section (kip-in). */
  Tu: number;
  /** Concurrent factored shear at the section (kip). */
  Vu: number;
  fc: number; // f'c (ksi)
  lambda?: number;
  bw: number; // web width (in)
  d: number; // effective depth (in)
  /** Gross outside area / perimeter of the section (in², in). */
  Acp: number;
  pcp: number;
  /** Closed-stirrup centerline area / perimeter (in², in). */
  Aoh: number;
  ph: number;
  /** Concrete one-way shear strength at the section (kip), for §22.7.7.1. */
  Vc: number;
  fyt?: number; // transverse yield (ksi), default 60
  fy?: number; // longitudinal yield (ksi), default 60
  /** Provided shear stirrup area within s (both legs, in²). */
  Av?: number;
  /** Provided torsion closed-stirrup area, ONE leg, within s (in²). */
  At?: number;
  /** Stirrup spacing (in). */
  s?: number;
  /** Provided longitudinal torsion steel, total around ph (in²). */
  Al?: number;
  prestressed?: boolean;
  /** Average precompression at the centroid (ksi, compression +). */
  fpc?: number;
}

export interface TorsionResult {
  /** Threshold torsion — below φ·Tth torsion may be neglected (kip-in). */
  Tth: number;
  /** Cracking torsion (kip-in). */
  Tcr: number;
  /** True when Tu ≤ φ·Tth (torsion design not required). */
  negligible: boolean;
  Ao: number;
  /** Required closed-stirrup At/s for equilibrium torsion (in²/in). */
  AtSReq: number;
  /** Required longitudinal torsion steel (in²). */
  AlReq: number;
  /** Minimum longitudinal torsion steel, §9.6.4.3 (in²). */
  AlMin: number;
  /** Provided φTn from the supplied At/s (kip-in). */
  phiTn: number;
  /** §22.7.7.1 combined stress: {lhs demand, rhs capacity} in psi. */
  combined: { lhs: number; rhs: number };
  checks: DesignCheck[];
}

export function torsionChecks(input: TorsionInput): TorsionResult {
  const {
    Tu,
    Vu,
    fc,
    lambda = 1,
    bw,
    d,
    Acp,
    pcp,
    Aoh,
    ph,
    Vc,
    fyt = 60,
    fy = 60,
    Av = 0,
    At = 0,
    s = 0,
    Al = 0,
    prestressed = false,
    fpc = 0,
  } = input;

  const cot = 1; // θ = 45°
  const ls = lambda * Math.sqrt(fc * 1000); // λ√f'c (psi)
  const Fp = prestressed && fpc > 0 ? Math.sqrt(1 + (fpc * 1000) / (4 * ls)) : 1;

  // Threshold (§22.7.4.1(a)) and cracking (§22.7.5.1) torsion. psi·in³ → kip-in.
  const Tth = pcp > 0 ? (ls * ((Acp * Acp) / pcp) * Fp) / 1000 : 0;
  const Tcr = 4 * Tth;
  const negligible = Tu <= PHI_TORSION * Tth + 1e-9;

  const Ao = 0.85 * Aoh;

  // Required transverse & longitudinal steel (§22.7.6.1). At/s from φ·2·Ao·(At/s)·fyt·cotθ ≥ Tu.
  const AtSReq = Ao > 0 && fyt > 0 ? Tu / PHI_TORSION / (2 * Ao * fyt * cot) : 0;
  const AlReq = AtSReq * ph * (fyt / fy) * cot * cot;
  // §9.6.4.3 minimum longitudinal, with At/s not less than 25·bw/fyt (psi).
  const AtSforMin = Math.max(AtSReq, (25 * bw) / (fyt * 1000));
  const AlMin = Math.max((5 * Math.sqrt(fc * 1000) * Acp) / (fy * 1000) - AtSforMin * ph * (fyt / fy), 0);

  // Provided capacity.
  const AtS = s > 0 ? At / s : 0;
  const phiTn = PHI_TORSION * 2 * Ao * AtS * fyt * cot;

  // Cross-section adequacy (§22.7.7.1, solid section). Terms in psi.
  const vShear = bw > 0 && d > 0 ? (Vu / (bw * d)) * 1000 : 0;
  const vTors = Aoh > 0 ? ((Tu * ph) / (1.7 * Aoh * Aoh)) * 1000 : 0;
  const lhs = Math.sqrt(vShear * vShear + vTors * vTors);
  const rhs = PHI_TORSION * ((bw > 0 && d > 0 ? (Vc / (bw * d)) * 1000 : 0) + 8 * ls);

  const checks: DesignCheck[] = [];
  if (negligible) {
    checks.push(
      check({
        id: 'torsion-threshold',
        label: 'Torsion below threshold (may be neglected)',
        clause: 'ACI 318-19 §22.7.1.1 / §22.7.4.1',
        formula: 'Tu ≤ φ·Tth,  Tth = λ√f′c·(Acp²/pcp)·√(1 + fpc/4λ√f′c)',
        demand: Tu,
        capacity: PHI_TORSION * Tth,
        unit: 'kip-in',
      }),
    );
  } else {
    checks.push(
      check({
        id: 'torsion-strength',
        label: 'Torsional strength φTn ≥ Tu',
        clause: 'ACI 318-19 §22.7.6.1 / §21.2.1',
        formula: 'φTn = φ·2·Ao·(At/s)·fyt·cotθ ≥ Tu  (θ = 45°)',
        demand: Tu,
        capacity: phiTn,
        unit: 'kip-in',
      }),
      check({
        id: 'torsion-section-adequacy',
        label: 'Cross-section adequacy (shear + torsion)',
        clause: 'ACI 318-19 §22.7.7.1',
        formula: '√((Vu/bwd)² + (Tu·ph/1.7Aoh²)²) ≤ φ(Vc/bwd + 8√f′c)',
        demand: lhs,
        capacity: rhs,
        unit: 'psi',
      }),
      check({
        id: 'torsion-longitudinal',
        label: 'Longitudinal torsion steel Al',
        clause: 'ACI 318-19 §22.7.6.1 / §9.6.4.3',
        formula: 'Al ≥ max(Al,req, Al,min);  Al,req = (At/s)·ph·(fyt/fy)·cot²θ',
        demand: Math.max(AlReq, AlMin),
        capacity: Al,
        unit: 'in',
        note: 'Areas in in². Al is total longitudinal torsion steel distributed around ph.',
      }),
      check({
        id: 'torsion-min-transverse',
        label: 'Minimum combined transverse reinf (Av + 2At)/s',
        clause: 'ACI 318-19 §9.6.4.2',
        formula: '(Av + 2At)/s ≥ max(0.75√f′c, 50)·bw/fyt',
        demand: (Math.max(0.75 * Math.sqrt(fc * 1000), 50) * bw) / (fyt * 1000),
        capacity: s > 0 ? (Av + 2 * At) / s : 0,
        unit: 'in',
        note: 'Areas over spacing s (in²/in).',
      }),
    );
  }

  return { Tth, Tcr, negligible, Ao, AtSReq, AlReq, AlMin, phiTn, combined: { lhs, rhs }, checks };
}

/** Ring area (shoelace, absolute) and perimeter of a closed polygon (in², in). */
export function ringAreaPerimeter(ring: { x: number; y: number }[]): { area: number; perimeter: number } {
  const n = ring.length;
  if (n < 3) return { area: 0, perimeter: 0 };
  let a2 = 0;
  let p = 0;
  for (let i = 0; i < n; i++) {
    const cur = ring[i];
    const nxt = ring[(i + 1) % n];
    a2 += cur.x * nxt.y - nxt.x * cur.y;
    p += Math.hypot(nxt.x - cur.x, nxt.y - cur.y);
  }
  return { area: Math.abs(a2) / 2, perimeter: p };
}
