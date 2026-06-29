/**
 * Vierendeel wall panel — geometry generation and per-member sectional checks.
 *
 * A panel pierced by a regular grid of openings is idealized as a rigid-jointed
 * frame (see fea/feaBuilders `buildVierendeelFrame`). This module:
 *   1. turns a regular opening grid into the frame's pier/chord centerlines, and
 *   2. takes the solved frame's member end forces and screens each member
 *      (a solid concrete strip) for flexural cracking and shear.
 *
 * The members are checked as plain concrete strips with no per-member
 * reinforcement modeled yet, so these are concrete-capacity SCREENING checks:
 * flexural cracking (M vs Mcr) and one-way shear (V vs φVc). A member that
 * exceeds Mcr would need flexural reinforcement designed — surfaced as > 100 %.
 *
 * Units: f′c in ksi; forces in kip; moments in kip-in; lengths in in.
 */
import type { FeaModelInput, FeaResult } from '../fea/feaModel';
import { check, type DesignCheck } from './designChecks/checkTypes';
import { PHI_SHEAR } from './designChecks/shear';

export interface VierendeelGrid {
  /** Overall panel width and height (in). */
  width: number;
  height: number;
  /** Out-of-plane wall thickness (in). */
  thickness: number;
  /** Number of openings across (cols) and up (rows). */
  cols: number;
  rows: number;
  /** Solid strip sizes between/around openings: pier (vertical) and chord (horizontal) (in). */
  pierWidth: number;
  chordDepth: number;
}

export interface VierendeelLines {
  verticals: { x: number; width: number }[];
  horizontals: { y: number; depth: number }[];
  /** Derived opening dimensions (in). */
  openingWidth: number;
  openingHeight: number;
}

/**
 * Pier (vertical) and chord (horizontal) centerlines for a regular grid of
 * openings. Solid strips have the supplied pier width / chord depth; the
 * openings fill the remaining space, evenly distributed.
 */
export function vierendeelLinesFromGrid(g: VierendeelGrid): VierendeelLines {
  if (g.cols < 1 || g.rows < 1) {
    throw new Error('A Vierendeel grid needs at least one opening in each direction.');
  }
  const openingWidth = (g.width - (g.cols + 1) * g.pierWidth) / g.cols;
  const openingHeight = (g.height - (g.rows + 1) * g.chordDepth) / g.rows;
  if (openingWidth <= 0) {
    throw new Error('Piers are too wide for the panel width — no opening space remains.');
  }
  if (openingHeight <= 0) {
    throw new Error('Chords are too deep for the panel height — no opening space remains.');
  }
  const verticals = Array.from({ length: g.cols + 1 }, (_, i) => ({
    x: g.pierWidth / 2 + i * (g.pierWidth + openingWidth),
    width: g.pierWidth,
  }));
  const horizontals = Array.from({ length: g.rows + 1 }, (_, j) => ({
    y: g.chordDepth / 2 + j * (g.chordDepth + openingHeight),
    depth: g.chordDepth,
  }));
  return { verticals, horizontals, openingWidth, openingHeight };
}

export interface VierendeelMemberResult {
  elementId: string;
  label: string;
  kind: 'pier' | 'chord';
  /** Governing axial (kip, signed end value of greatest magnitude; − = tension per solver convention). */
  N: number;
  /** Governing shear magnitude (kip). */
  V: number;
  /** Governing moment magnitude (kip-in). */
  M: number;
  checks: DesignCheck[];
  /** Max utilization across this member's checks. */
  utilization: number;
}

const signedMax = (a: number, b: number) => (Math.abs(a) >= Math.abs(b) ? a : b);

function memberLabel(elementId: string): { label: string; kind: 'pier' | 'chord' } {
  const m = /^([pc])(\d+)_(\d+)$/.exec(elementId);
  if (!m) return { label: elementId, kind: elementId.startsWith('c') ? 'chord' : 'pier' };
  const idx = Number(m[2]);
  const lvl = Number(m[3]);
  return m[1] === 'p'
    ? { label: `Pier ${idx + 1}, lift ${lvl + 1}`, kind: 'pier' }
    : { label: `Chord level ${lvl + 1}, bay ${idx + 1}`, kind: 'chord' };
}

/**
 * Screen every frame member against concrete cracking and shear from the solved
 * end forces. `lambda` is the lightweight factor (default 1).
 */
export function vierendeelMemberResults(
  model: FeaModelInput,
  result: FeaResult,
  opts: { fc: number; lambda?: number },
): VierendeelMemberResult[] {
  const lambda = opts.lambda ?? 1;
  const sqrtFcPsi = lambda * Math.sqrt(opts.fc * 1000); // λ√f′c (psi)
  const fr = (7.5 * sqrtFcPsi) / 1000; // modulus of rupture (ksi), ACI 19.2.3.1
  const sectionById = new Map(model.sections.map((s) => [s.id, s]));
  const forceById = new Map(result.elementForces.map((f) => [f.elementId, f]));

  const out: VierendeelMemberResult[] = [];
  for (const el of model.elements) {
    // Only the flexible pier/chord members are design members; skip rigid stubs (rl_…).
    if (!/^[pc]\d+_\d+$/.test(el.id)) continue;
    const sec = sectionById.get(el.sectionId);
    const f = forceById.get(el.id);
    if (!sec || !f) continue;
    // Recover the strip from its section: A = w·t, I = t·w³/12 ⇒ w = √(12I/A), t = A/w.
    const w = Math.sqrt((12 * sec.I) / sec.A); // in-plane dimension (in)
    const t = sec.A / w; // wall thickness (in)
    const S = sec.I / (w / 2); // section modulus (in³)

    const N = signedMax(f.iN, f.jN);
    const V = Math.max(Math.abs(f.iV), Math.abs(f.jV));
    const M = Math.max(Math.abs(f.iM), Math.abs(f.jM)); // kip-in

    const Mcr = fr * S; // kip-in
    const d = 0.8 * w; // effective depth for in-plane shear (ACI 11.5.4.8: 0.8ℓw)
    const Vc = (2 * sqrtFcPsi * t * d) / 1000; // kip, Vc = 2λ√f′c·bw·d (Table 22.5.5.1)
    const phiVc = PHI_SHEAR * Vc;

    const { label, kind } = memberLabel(el.id);
    const checks: DesignCheck[] = [
      check({
        id: `${el.id}-flexure`,
        label: 'Flexural cracking',
        clause: 'ACI 318-19 §19.2.3.1',
        formula: 'M ≤ Mcr = fr·S, fr = 7.5λ√f′c',
        demand: M,
        capacity: Mcr,
        unit: 'kip-in',
        note: 'plain strip (no reinforcement modeled) — exceeding Mcr means flexural steel must be designed',
      }),
      check({
        id: `${el.id}-shear`,
        label: 'One-way shear',
        clause: 'ACI 318-19 §22.5.5.1 (d = 0.8ℓw, φ = 0.75)',
        formula: 'V ≤ φVc = φ·2λ√f′c·t·d',
        demand: V,
        capacity: phiVc,
        unit: 'kip',
      }),
    ];
    const utilization = Math.max(...checks.map((c) => c.utilization));
    out.push({ elementId: el.id, label, kind, N, V, M, checks, utilization });
  }
  return out;
}

/** Worst member + max utilization across the panel. */
export function vierendeelSummary(results: VierendeelMemberResult[]): {
  maxUtilization: number;
  governing: VierendeelMemberResult | null;
} {
  let governing: VierendeelMemberResult | null = null;
  for (const r of results) {
    if (!governing || r.utilization > governing.utilization) governing = r;
  }
  return { maxUtilization: governing?.utilization ?? 0, governing };
}
