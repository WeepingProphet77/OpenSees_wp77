/**
 * Column axial-flexural (P-M) interaction (Phase 2).
 *
 * Builds the φP–φMₙ interaction curve for uniaxial bending by sweeping the
 * applied axial load N through the axial-extended biaxial solver
 * (`biaxialAtOrientation` with ΣF = N). φ varies with the net tensile strain
 * (ACI 318-19 §21.2.2), and the factored axial capacity is capped at
 * 0.80·φ·Po (tied) / 0.85·φ·Po (spiral) per ACI 318-19 §22.4.2.1.
 *
 * Sign convention: P is compression-positive (P = −N, where N is the tension-
 * positive axial used internally). Moments returned in kip-ft.
 */
import {
  biaxialAtOrientation,
  biaxialDecompStrains,
  polygonFullProperties,
  sectionToPolygon,
} from './beamCalculations';
import type { Section, SteelLayer } from './types';

export interface PMPoint {
  /** Axial load, compression positive (kip). */
  P: number;
  /** Nominal moment (kip-ft). */
  Mn: number;
  /** φ·Pn capped per §22.4.2.1 (kip). */
  phiP: number;
  /** φ·Mn (kip-ft). */
  phiM: number;
  phi: number;
  epsT: number;
  c: number;
}

export interface PMInteractionResult {
  points: PMPoint[];
  /** Nominal axial squash load Po (kip, compression +), §22.4.2.2. */
  Po: number;
  /** Capped factored axial strength φPn,max (kip). */
  phiPnMax: number;
  tie: 'tied' | 'spiral';
}

export interface PMOptions {
  /** Bending orientation (default strong-axis sag: compression at top). */
  phi?: number;
  /** Confinement type for the axial cap (default tied). */
  tie?: 'tied' | 'spiral';
  /** Number of axial sweep points (default 40). */
  samples?: number;
}

export function pmInteraction(
  section: Section,
  layers: SteelLayer[],
  opts: PMOptions = {},
): PMInteractionResult {
  const { phi = (3 * Math.PI) / 2, tie = 'tied', samples = 40 } = opts;
  const fc = section.fc ?? 0;
  const polySpec = sectionToPolygon(section);
  const props = polygonFullProperties(polySpec);
  const decomp = biaxialDecompStrains(props, layers, fc);

  const Ast = layers.reduce((s, l) => s + l.area, 0);
  const Ag = props.A;
  // Nominal squash load (compression +).
  const steelYield = layers.reduce((s, l) => s + l.steel.fpy * l.area, 0);
  const Po = 0.85 * fc * (Ag - Ast) + steelYield;
  // Pure-tension cap (all steel yields in tension), N tension-positive.
  const Nt = steelYield;

  const capFactor = tie === 'spiral' ? 0.85 : 0.8;
  const phiAxial = tie === 'spiral' ? 0.75 : 0.65;
  const phiPnMax = phiAxial * capFactor * Po;

  const points: PMPoint[] = [];
  // Sweep N (tension +) from pure tension (+Nt) down to full compression (−Po).
  for (let i = 0; i <= samples; i++) {
    const N = Nt - ((Nt + Po) * i) / samples; // +Nt → −Po
    const r = biaxialAtOrientation(polySpec, layers, props, fc, phi, decomp, N);
    const P = -N; // compression +
    const phiM = r.phiMx / 12; // kip-ft
    const Mn = r.Mx / 12;
    let phiP = r.phiF * P;
    if (phiP > phiPnMax) phiP = phiPnMax; // §22.4.2.1 cap
    points.push({ P, Mn, phiP, phiM, phi: r.phiF, epsT: r.epsT, c: r.c });
  }

  return { points, Po, phiPnMax, tie };
}

/**
 * Factored moment capacity φMn (kip-ft) at a given factored axial demand P
 * (compression +), by linear interpolation of the P-M curve. Clamps to the
 * curve's axial range.
 */
export function momentCapacityAtP(result: PMInteractionResult, P: number): number {
  const pts = [...result.points].sort((a, b) => a.P - b.P);
  if (P <= pts[0].P) return pts[0].phiM;
  if (P >= pts[pts.length - 1].P) return pts[pts.length - 1].phiM;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (P >= a.P && P <= b.P) {
      const t = (P - a.P) / (b.P - a.P);
      return a.phiM + t * (b.phiM - a.phiM);
    }
  }
  return pts[pts.length - 1].phiM;
}
