/**
 * Internal-force diagram reconstruction for FEA frame results.
 *
 * Given a solved model (FeaModel + FeaResult), this computes the axial (N),
 * shear (V) and bending-moment (M) distributions ALONG each member — the data a
 * shear/moment/axial diagram renders. Everything is reconstructed analytically
 * in the element's LOCAL frame from its end forces plus its member loads (which
 * the schema already stores in local components), so no rotation is needed.
 *
 * Sign conventions (matched empirically to the OpenSees engine output):
 *   - N(x): tension positive.       N(x) = −iN − ∫₀ˣ wx
 *   - V(x): V(0⁺) = +iV.            V(x) =  iV + ∫₀ˣ wy           (+ point shears)
 *   - M(x): sagging positive.       M(x) = −iM + ∫₀ˣ V(ξ) dξ
 *
 * Scope: the in-plane set (N, local-y shear, local-z moment) — the full 2D
 * result and the major plane of a 3D member. Out-of-plane (Vz/My) and torsion
 * diagrams for 3D are a follow-up.
 */
import type { FeaModel, FeaResult } from './feaModel';

export interface DiagramPoint {
  /** Distance from node I along the member (model length unit, e.g. in). */
  x: number;
  value: number;
}

export interface MemberDiagram {
  elementId: string;
  /** Member length. */
  length: number;
  /** Axial force N(x), tension positive. */
  axial: DiagramPoint[];
  /** Shear V(x) in local y. */
  shear: DiagramPoint[];
  /** Bending moment M(x) about local z, sagging positive. */
  moment: DiagramPoint[];
}

export interface DiagramOptions {
  /** Evenly-spaced stations per member (load breakpoints are added on top). Default 21. */
  stations?: number;
}

function groupByElement<T extends { elementId: string }>(items: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const list = map.get(it.elementId);
    if (list) list.push(it);
    else map.set(it.elementId, [it]);
  }
  return map;
}

/**
 * Reconstruct N/V/M along every member. Pure function of the model + result;
 * does not touch the solver.
 */
export function computeMemberDiagrams(
  model: FeaModel,
  result: FeaResult,
  opts: DiagramOptions = {},
): MemberDiagram[] {
  const stations = Math.max(2, Math.floor(opts.stations ?? 21));
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  const forceById = new Map(result.elementForces.map((f) => [f.elementId, f]));
  const uniformByEl = groupByElement(model.elementLoads);
  const pointByEl = groupByElement(model.elementPointLoads);
  const partialByEl = groupByElement(model.elementPartialLoads);

  return model.elements.map((el) => {
    const ni = nodeById.get(el.nodeI);
    const nj = nodeById.get(el.nodeJ);
    const L = ni && nj ? Math.hypot(nj.x - ni.x, nj.y - ni.y, (nj.z ?? 0) - (ni.z ?? 0)) : 0;

    const f = forceById.get(el.id);
    const iN = f?.iN ?? 0;
    const iV = f?.iV ?? 0;
    const iM = f?.iM ?? 0;
    const uniforms = uniformByEl.get(el.id) ?? [];
    const points = pointByEl.get(el.id) ?? [];
    const partials = partialByEl.get(el.id) ?? [];

    // Cumulative transverse load Wy(x) and its first moment about x, My(x) =
    // ∫₀ˣ Wy dξ, plus cumulative axial Wx(x), from all member loads in [0, x].
    const accumulate = (x: number) => {
      let Wy = 0;
      let My = 0;
      let Wx = 0;
      for (const u of uniforms) {
        Wy += u.wy * x;
        My += (u.wy * x * x) / 2;
        Wx += (u.wx ?? 0) * x;
      }
      for (const p of points) {
        const pos = p.at * L;
        if (x + 1e-9 >= pos) {
          Wy += p.py ?? 0;
          My += (p.py ?? 0) * (x - pos);
          Wx += p.px ?? 0;
        }
      }
      for (const pl of partials) {
        const lo = pl.a * L;
        const hi = pl.b * L;
        const span = hi - lo;
        if (x > lo && span > 0) {
          const u = Math.min(x, hi);
          const c = u - lo; // loaded length to the left of x
          const d = x - lo;
          const ky = ((pl.wyEnd ?? pl.wy) - pl.wy) / span;
          Wy += pl.wy * c + (ky * c * c) / 2;
          My += pl.wy * d * c - (pl.wy * c * c) / 2 + (ky * d * c * c) / 2 - (ky * c * c * c) / 3;
          const kx = ((pl.wxEnd ?? pl.wx) - pl.wx) / span;
          Wx += pl.wx * c + (kx * c * c) / 2;
        }
      }
      return { Wy, My, Wx };
    };

    // Station list: an even grid plus every load discontinuity.
    const xset = new Set<number>();
    for (let i = 0; i < stations; i++) xset.add((L * i) / (stations - 1));
    for (const p of points) xset.add(p.at * L);
    for (const pl of partials) {
      xset.add(pl.a * L);
      xset.add(pl.b * L);
    }
    const xs = [...xset].filter((x) => x >= -1e-9 && x <= L + 1e-9).sort((a, b) => a - b);

    const axial: DiagramPoint[] = [];
    const shear: DiagramPoint[] = [];
    const moment: DiagramPoint[] = [];
    for (const x of xs) {
      const { Wy, My, Wx } = accumulate(x);
      axial.push({ x, value: -iN - Wx });
      shear.push({ x, value: iV + Wy });
      moment.push({ x, value: -iM + iV * x + My });
    }
    return { elementId: el.id, length: L, axial, shear, moment };
  });
}

/** Convenience: the signed extreme (largest |value|) of a diagram series. */
export function diagramExtreme(points: readonly DiagramPoint[]): { x: number; value: number } {
  let best = { x: 0, value: 0 };
  for (const p of points) if (Math.abs(p.value) > Math.abs(best.value)) best = p;
  return best;
}

/**
 * Linear-interpolate a diagram series at an arbitrary station x (clamped to the
 * member ends). Powers the interactive cursor readout. Assumes `points` is
 * sorted ascending by x (as produced by computeMemberDiagrams).
 */
export function interpolateDiagram(points: readonly DiagramPoint[], x: number): number {
  if (points.length === 0) return 0;
  if (x <= points[0].x) return points[0].value;
  const last = points[points.length - 1];
  if (x >= last.x) return last.value;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (x <= b.x) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return a.value + t * (b.value - a.value);
    }
  }
  return last.value;
}

/** A support reaction joined with its node's position, for left→right display. */
export interface SupportReaction {
  nodeId: string;
  /** Node x-coordinate (model length unit), for ordering/labeling. */
  x: number;
  fx: number;
  fy: number;
  mz: number;
}

/** Reactions joined with node positions and ordered left→right along x. */
export function summarizeReactions(model: FeaModel, result: FeaResult): SupportReaction[] {
  const nodeX = new Map(model.nodes.map((n) => [n.id, n.x]));
  return result.reactions
    .map((r) => ({ nodeId: r.nodeId, x: nodeX.get(r.nodeId) ?? 0, fx: r.fx, fy: r.fy, mz: r.mz }))
    .sort((a, b) => a.x - b.x);
}
