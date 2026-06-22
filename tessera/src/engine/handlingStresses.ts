/**
 * Handling / stripping flexural stresses for precast wall panels (Phase 2).
 *
 * When a panel is stripped from the form and lifted, its self-weight bends it
 * about the pickup points. With two symmetric pickup points a distance `a` from
 * each end (panel length L), the governing moments are:
 *   over a pickup (cantilever):  M⁻ = w_eff · a² / 2
 *   at mid-span:                 M⁺ = w_eff · (L²/8 − L·a/2)
 * The optimal symmetric pickup a ≈ 0.207·L equalizes the two. An impact /
 * suction multiplier amplifies the static self-weight (PCI Design Handbook
 * handling guidance; default 1.5). The tensile fiber stress is compared to the
 * modulus of rupture fr = 7.5·λ·√f'ci at stripping (ACI 318-19 §19.2.3).
 *
 * Units: L (in), w (kip/in), S (in³), f'ci (ksi) → stresses in ksi.
 */
import { check, type DesignCheck } from './designChecks/checkTypes';

export interface HandlingInput {
  /** Panel length between/around pickups (in). */
  L: number;
  /** Self-weight line load (kip/in). */
  wSelf: number;
  /** Section modulus about the handling bending axis (in³). */
  S: number;
  /** Concrete strength at stripping (ksi). */
  fci: number;
  /** Pickup distance from each end (in); default 0.207·L (balanced). */
  pickupFromEnd?: number;
  /** Impact / form-suction multiplier on self-weight; default 1.5. */
  impactFactor?: number;
  lambda?: number;
}

export interface HandlingResult {
  a: number;
  /** Cantilever (negative) moment over a pickup (kip-in). */
  Mneg: number;
  /** Mid-span (positive) moment (kip-in). */
  Mpos: number;
  /** Governing |moment| (kip-in). */
  Mgov: number;
  /** Governing tensile fiber stress (ksi). */
  stress: number;
  /** Modulus of rupture fr at stripping (ksi). */
  allowable: number;
  check: DesignCheck;
}

export function handlingStresses(input: HandlingInput): HandlingResult {
  const { L, wSelf, S, fci, pickupFromEnd, impactFactor = 1.5, lambda = 1 } = input;
  const a = pickupFromEnd ?? 0.207 * L;
  const weff = wSelf * impactFactor;
  const Mneg = (weff * a * a) / 2;
  const Mpos = Math.max(0, weff * ((L * L) / 8 - (L * a) / 2));
  const Mgov = Math.max(Math.abs(Mneg), Math.abs(Mpos));
  const stress = S > 0 ? Mgov / S : 0;
  const allowable = (7.5 * lambda * Math.sqrt(fci * 1000)) / 1000; // fr (ksi)

  return {
    a,
    Mneg,
    Mpos,
    Mgov,
    stress,
    allowable,
    check: check({
      id: 'handling-stripping-stress',
      label: 'Handling / stripping tensile stress',
      clause: 'ACI 318-19 §19.2.3 (fr); PCI handling',
      formula: `f = M_strip/S ≤ fr = 7.5·λ·√f'ci  (pickup a = ${a.toFixed(1)} in, impact ×${impactFactor})`,
      demand: stress,
      capacity: allowable,
      unit: 'ksi',
    }),
  };
}
