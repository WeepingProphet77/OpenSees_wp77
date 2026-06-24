/**
 * Derive the engineering landmarks of a fiber moment–curvature curve: nominal
 * moment, ultimate curvature, the yield curvature, and the resulting curvature
 * ductility μ = φu/φy.
 *
 * When the engine supplies exact landmarks (first crossing of reinforcement
 * yield and concrete crushing strains), those define φy and φu directly. When
 * they are absent (older engine, or the event wasn't reached), φy falls back to
 * the reduced-stiffness equivalent-yield idealization: the secant from the
 * curve's start through the point at a fraction `f` of the moment rise, extended
 * to the nominal moment, gives φy = φ(f) / f. This needs only the curve and
 * handles a non-zero starting moment (prestress) because the offset cancels.
 */
import type { MomentCurvatureLandmarks, MomentCurvaturePoint } from './feaModel';

export interface MomentCurvatureMetrics {
  /** Moment at zero curvature (≈ prestress holding moment; ~0 for RC). kip-in. */
  m0: number;
  /** Peak (nominal) moment over the curve, Mn. kip-in. */
  mn: number;
  /** Curvature at the peak moment. 1/in. */
  phiAtPeak: number;
  /** Ultimate curvature: concrete crushing if reached, else the last point. 1/in. */
  phiU: number;
  /** Yield curvature: exact first reinforcement yield if available, else the secant equivalent. 1/in. */
  phiY: number;
  /** Curvature ductility μ = φu / φy (NaN if φy ≤ 0). */
  mu: number;
  /** True when φy came from the engine's exact first-yield landmark (vs the secant fallback). */
  exactYield: boolean;
  /** True when φu came from the engine's exact crushing landmark (vs the last sweep point). */
  exactUltimate: boolean;
  /** Exact cracking / first-yield / crushing points (kip-in, 1/in), when the engine reported them. */
  cracking: { kappa: number; M: number } | null;
  firstYield: { kappa: number; M: number } | null;
  crushing: { kappa: number; M: number } | null;
}

/** Moment-rise fraction defining the equivalent-yield secant (0.7 ≈ reduced-stiffness idealization). */
const YIELD_FRACTION = 0.7;

export function momentCurvatureMetrics(
  points: readonly MomentCurvaturePoint[],
  landmarks?: MomentCurvatureLandmarks | null,
): MomentCurvatureMetrics | null {
  if (points.length < 2) return null;

  const m0 = points[0].M;
  let peakIdx = 0;
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i].M) > Math.abs(points[peakIdx].M)) peakIdx = i;
  }
  const mn = points[peakIdx].M;
  const phiAtPeak = points[peakIdx].kappa;

  // Equivalent-yield fallback: first crossing (on the rising branch) of m0 + f·(mn − m0).
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
  const secantPhiY = phiAtTarget / YIELD_FRACTION; // the m0 offset cancels

  const cracking = landmarks?.cracking ? { kappa: landmarks.cracking.kappa, M: landmarks.cracking.M } : null;
  const firstYield = landmarks?.firstYield ? { kappa: landmarks.firstYield.kappa, M: landmarks.firstYield.M } : null;
  const crushing = landmarks?.crushing ? { kappa: landmarks.crushing.kappa, M: landmarks.crushing.M } : null;

  const exactYield = firstYield != null && firstYield.kappa > 0;
  const phiY = exactYield ? firstYield!.kappa : secantPhiY;

  const exactUltimate = crushing != null && crushing.kappa > 0;
  const phiU = exactUltimate ? crushing!.kappa : points[points.length - 1].kappa;

  const mu = phiY > 0 ? phiU / phiY : NaN;

  return { m0, mn, phiAtPeak, phiU, phiY, mu, exactYield, exactUltimate, cracking, firstYield, crushing };
}
