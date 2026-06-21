/**
 * One-way (beam) shear design — ACI 318-19 Chapter 22 (§22.5) plus the
 * detailing limits of §9.6.3 (minimum shear reinforcement) and §9.7.6.2.2
 * (maximum stirrup spacing).
 *
 * Concrete shear strength Vc:
 *   - Nonprestressed: Vc = 2·λ·√f'c·bw·d        (ACI 318-19 Table 22.5.5.1(a),
 *     members with at least minimum shear reinforcement, no axial load).
 *   - Prestressed (simplified): Vc = (0.6·λ·√f'c + 700·Vu·dp/Mu)·bw·d
 *     (ACI 318-19 Table 22.5.6.2), with Vu·dp/Mu ≤ 1.0 and
 *     2·λ·√f'c·bw·d ≤ Vc ≤ 5·λ·√f'c·bw·d, and dp ≥ 0.80·h.
 *
 * Shear reinforcement: Vs = Av·fyt·d/s (§22.5.8.5.3). φ = 0.75 (§21.2.1).
 * Strength: φVn = φ(Vc + Vs) ≥ Vu (§22.5.1.1).
 *
 * Units: f'c, fyt in ksi; forces in kip; lengths in in; Mu in kip-in.
 */
import { check, type DesignCheck } from './checkTypes';

/** φ for shear and torsion, ACI 318-19 Table 21.2.1. */
export const PHI_SHEAR = 0.75;

export interface ShearInput {
  fc: number; // f'c (ksi)
  lambda?: number; // λ (default 1)
  bw: number; // web width (in)
  d: number; // effective depth to tension reinforcement (in)
  h: number; // overall depth (in)
  /** Depth to centroid of prestress (in); used for the simplified Vc, ≥ 0.80h. */
  dp?: number;
  Vu: number; // factored shear demand (kip)
  Mu: number; // factored moment at the section (kip-in)
  prestressed?: boolean; // default false
  /** Provided transverse reinforcement. */
  Av?: number; // area of shear reinforcement within spacing s (in²)
  fyt?: number; // transverse yield strength (ksi), default 60
  s?: number; // stirrup spacing (in)
}

export interface ShearResult {
  Vc: number; // kip
  Vs: number; // kip
  Vn: number; // kip
  phiVn: number; // kip
  /** Vc bounds actually applied (kip), for reporting. */
  VcBounds: { lower: number; upper: number };
  VsMax: number; // 8√f'c bw d (kip), §22.5.1.2
  /** Minimum shear reinforcement Av,min for the supplied spacing (in²), §9.6.3.4. */
  AvMin: number;
  /** Maximum stirrup spacing (in), §9.7.6.2.2. */
  sMax: number;
  /** Whether minimum stirrups are required (Vu > 0.5·φVc), §9.6.3.1. */
  stirrupsRequired: boolean;
  checks: DesignCheck[];
}

/** λ·√f'c in psi from f'c in ksi. */
function lamSqrtPsi(fc: number, lambda: number): number {
  return lambda * Math.sqrt(fc * 1000);
}

export function shearChecks(input: ShearInput): ShearResult {
  const {
    fc,
    lambda = 1,
    bw,
    d,
    h,
    Vu,
    Mu,
    prestressed = false,
    Av = 0,
    fyt = 60,
    s = 0,
  } = input;

  const ls = lamSqrtPsi(fc, lambda); // psi
  const lower = (2 * ls * bw * d) / 1000; // kip
  const upper = (5 * ls * bw * d) / 1000; // kip

  let Vc: number;
  if (prestressed) {
    const dp = Math.max(input.dp ?? d, 0.8 * h);
    const ratio = Mu > 0 ? Math.min((Vu * dp) / Mu, 1.0) : 1.0;
    const vcCalc = ((0.6 * ls + 700 * ratio) * bw * d) / 1000; // kip
    Vc = Math.min(Math.max(vcCalc, lower), upper);
  } else {
    Vc = lower; // 2λ√f'c bw d
  }

  const Vs = s > 0 ? (Av * fyt * d) / s : 0; // kip, §22.5.8.5.3
  const Vn = Vc + Vs;
  const phiVn = PHI_SHEAR * Vn;

  const VsMax = (8 * ls * bw * d) / 1000; // kip, §22.5.1.2
  const VsThreshold = (4 * ls * bw * d) / 1000; // kip, §9.7.6.2.2 spacing break

  // Av,min for the supplied spacing (§9.6.3.4): max(0.75√f'c, 50)·bw·s/fyt (psi).
  const AvMin =
    s > 0 ? (Math.max(0.75 * Math.sqrt(fc * 1000), 50) * bw * s) / (fyt * 1000) : 0;

  // Max spacing (§9.7.6.2.2). Prestressed members use 0.75h; nonprestressed d/2.
  const sCap = prestressed ? 0.75 * h : d / 2;
  const sCapTight = prestressed ? 0.375 * h : d / 4;
  const sMax = Vs <= VsThreshold ? Math.min(sCap, 24) : Math.min(sCapTight, 12);

  const stirrupsRequired = Vu > 0.5 * PHI_SHEAR * Vc; // §9.6.3.1

  const checks: DesignCheck[] = [
    check({
      id: 'shear-strength',
      label: 'Shear strength φVn ≥ Vu',
      clause: 'ACI 318-19 §22.5.1.1 / §21.2.1',
      formula: 'φVn = 0.75·(Vc + Vs) ≥ Vu',
      demand: Vu,
      capacity: phiVn,
      unit: 'kip',
    }),
    check({
      id: 'shear-section-size',
      label: 'Section adequacy (Vs ≤ 8√f′c·bw·d)',
      clause: 'ACI 318-19 §22.5.1.2',
      formula: 'Vs ≤ 8·λ·√f′c·bw·d (else enlarge the section)',
      demand: Vs,
      capacity: VsMax,
      unit: 'kip',
    }),
  ];

  if (stirrupsRequired) {
    checks.push(
      check({
        id: 'shear-min-reinforcement',
        label: 'Minimum shear reinforcement Av ≥ Av,min',
        clause: 'ACI 318-19 §9.6.3.4',
        formula: "Av,min = max(0.75·√f'c, 50)·bw·s/fyt",
        demand: AvMin,
        capacity: Av,
        unit: 'in', // area; label clarifies (in²)
        note: 'Av and Av,min are areas (in²) over spacing s.',
      }),
    );
    if (s > 0) {
      checks.push(
        check({
          id: 'shear-max-spacing',
          label: 'Maximum stirrup spacing s ≤ s_max',
          clause: 'ACI 318-19 §9.7.6.2.2',
          formula:
            Vs <= VsThreshold
              ? `s ≤ min(${prestressed ? '0.75h' : 'd/2'}, 24 in)`
              : `s ≤ min(${prestressed ? '0.375h' : 'd/4'}, 12 in)`,
          demand: s,
          capacity: sMax,
          unit: 'in',
        }),
      );
    }
  }

  return {
    Vc,
    Vs,
    Vn,
    phiVn,
    VcBounds: { lower, upper },
    VsMax,
    AvMin,
    sMax,
    stirrupsRequired,
    checks,
  };
}
