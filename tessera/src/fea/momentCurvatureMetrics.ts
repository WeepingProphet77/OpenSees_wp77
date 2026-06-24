/**
 * Derive the engineering landmarks of a fiber moment–curvature curve: nominal
 * moment, ultimate curvature, an equivalent yield curvature, and the resulting
 * curvature ductility μ = φu/φy.
 *
 * Yield is taken from the reduced-stiffness (equivalent elasto-plastic) idealization
 * common in seismic detailing: the secant from the curve's start through the point
 * at a fraction `f` of the moment rise, extended to the nominal moment, gives
 * φy = φ(f) / f. This needs only the curve (no per-fiber strain) and handles a
 * non-zero starting moment (prestress) because the offset cancels. It is an
 * *equivalent* yield, not the exact first-strand-yield (which would need strain
 * output from the engine).
 */
import type { MomentCurvaturePoint } from './feaModel';

export interface MomentCurvatureMetrics {
  /** Moment at zero curvature (≈ prestress holding moment; ~0 for RC). kip-in. */
  m0: number;
  /** Peak (nominal) moment over the curve, Mn. kip-in. */
  mn: number;
  /** Curvature at the peak moment. 1/in. */
  phiAtPeak: number;
  /** Ultimate curvature reached (last recorded point — typically concrete crushing). 1/in. */
  phiU: number;
  /** Equivalent yield curvature (secant-to-peak method). 1/in. */
  phiY: number;
  /** Curvature ductility μ = φu / φy (NaN if φy ≤ 0). */
  mu: number;
}

/** Moment-rise fraction defining the equivalent-yield secant (0.7 ≈ reduced-stiffness idealization). */
const YIELD_FRACTION = 0.7;

export function momentCurvatureMetrics(
  points: readonly MomentCurvaturePoint[],
): MomentCurvatureMetrics | null {
  if (points.length < 2) return null;

  const m0 = points[0].M;
  let peakIdx = 0;
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i].M) > Math.abs(points[peakIdx].M)) peakIdx = i;
  }
  const mn = points[peakIdx].M;
  const phiAtPeak = points[peakIdx].kappa;
  const phiU = points[points.length - 1].kappa;

  // First crossing (on the rising branch) of m0 + f·(mn − m0).
  const target = m0 + YIELD_FRACTION * (mn - m0);
  let phiAtTarget = phiAtPeak;
  for (let i = 1; i <= peakIdx; i++) {
    const a = points[i - 1];
    const b = points[i];
    const lo = Math.min(a.M, b.M);
    const hi = Math.max(a.M, b.M);
    if (target >= lo && target <= hi && b.M !== a.M) {
      const t = (target - a.M) / (b.M - a.M);
      phiAtTarget = a.kappa + t * (b.kappa - a.kappa);
      break;
    }
  }
  // Secant from (0, m0) through (φ@target, target), extended to mn → the m0 offset cancels.
  const phiY = phiAtTarget / YIELD_FRACTION;
  const mu = phiY > 0 ? phiU / phiY : NaN;

  return { m0, mn, phiAtPeak, phiU, phiY, mu };
}
