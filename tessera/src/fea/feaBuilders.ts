/**
 * Convenience builders that assemble {@link FeaModel}s from high-level
 * parameters. Kept separate from the schema so the model contract stays
 * dependency-free. These also document how the design-domain (Phase 4
 * Vierendeel/frame mapping) will eventually feed the solver.
 */
import type { FeaModelInput } from './feaModel';

export interface PortalFrameParams {
  /** Center-to-center column spacing / beam span (in). */
  span: number;
  /** Story height, base to beam centerline (in). */
  height: number;
  /** Young's modulus (ksi). */
  E: number;
  /** Member area (in²) and inertia (in⁴) — same section for all members in the spike. */
  A: number;
  I: number;
  /** Lateral load applied at the top-left node (kip). */
  lateralLoad?: number;
  /** Uniform gravity load on the beam in local −y (kip/in); pass a positive magnitude. */
  beamGravity?: number;
  /** Base fixity: 'fixed' (default) or 'pinned'. */
  base?: 'fixed' | 'pinned';
}

/**
 * A single-bay portal frame: two columns (bl→tl, br→tr) and a beam (tl→tr).
 * This is the canonical elastic-frame validation case for the Phase 3 spike;
 * the Vierendeel equivalent frame is built by {@link buildVierendeelFrame}.
 */
export function buildPortalFrame(p: PortalFrameParams): FeaModelInput {
  const fixed = (p.base ?? 'fixed') === 'fixed';
  const model: FeaModelInput = {
    nodes: [
      { id: 'bl', x: 0, y: 0 },
      { id: 'br', x: p.span, y: 0 },
      { id: 'tl', x: 0, y: p.height },
      { id: 'tr', x: p.span, y: p.height },
    ],
    materials: [{ id: 'm', E: p.E }],
    sections: [{ id: 's', A: p.A, I: p.I }],
    elements: [
      { id: 'colL', nodeI: 'bl', nodeJ: 'tl', materialId: 'm', sectionId: 's' },
      { id: 'colR', nodeI: 'br', nodeJ: 'tr', materialId: 'm', sectionId: 's' },
      { id: 'beam', nodeI: 'tl', nodeJ: 'tr', materialId: 'm', sectionId: 's' },
    ],
    supports: [
      { nodeId: 'bl', dx: true, dy: true, rz: fixed },
      { nodeId: 'br', dx: true, dy: true, rz: fixed },
    ],
    nodalLoads: p.lateralLoad ? [{ nodeId: 'tl', fx: p.lateralLoad }] : [],
    elementLoads: p.beamGravity ? [{ elementId: 'beam', wy: -Math.abs(p.beamGravity) }] : [],
  };
  return model;
}

/** One grid line of a Vierendeel panel's equivalent frame. */
export interface VierendeelVertical {
  /** Centerline x of the pier (in). */
  x: number;
  /** In-plane pier width (in). */
  width: number;
}
export interface VierendeelHorizontal {
  /** Centerline y of the chord (in); the lowest is the supported base. */
  y: number;
  /** In-plane chord depth (in). */
  depth: number;
}

export interface VierendeelFrameParams {
  /** Vertical grid lines (piers), in any order; sorted by x internally. */
  verticals: VierendeelVertical[];
  /** Horizontal grid lines (chords), in any order; sorted by y internally (lowest = base). */
  horizontals: VierendeelHorizontal[];
  /** Wall thickness, out-of-plane (in). */
  thickness: number;
  /** Young's modulus (ksi). */
  E: number;
  /** Total in-plane lateral force at the top level (kip), split equally across top nodes. */
  lateralLoad?: number;
  /** Uniform gravity on every chord member, local −y (kip/in, positive magnitude). */
  gravity?: number;
  /** Base fixity at the lowest chord line: 'fixed' (default) or 'pinned'. */
  base?: 'fixed' | 'pinned';
}

/**
 * A Vierendeel wall panel (a panel pierced by a grid of openings) mapped to its
 * equivalent rigid-jointed frame: the solid strips between/around the openings
 * become piers (verticals) and chords (horizontals), joined rigidly with no
 * diagonals. Nodes sit at every pier×chord centerline intersection; each member
 * spans between adjacent nodes with the section of its strip
 * (A = strip·t, I = t·strip³/12 for in-plane bending).
 *
 * This is the centerline ("equivalent frame") model; finite joint size (rigid
 * end zones) is a planned refinement. The result feeds the same 2D
 * `FeaEngine.solve` as any other frame, so member end forces flow straight into
 * the per-member sectional checks.
 */
export function buildVierendeelFrame(p: VierendeelFrameParams): FeaModelInput {
  const verticals = [...p.verticals].sort((a, b) => a.x - b.x);
  const horizontals = [...p.horizontals].sort((a, b) => a.y - b.y);
  const nV = verticals.length;
  const nH = horizontals.length;
  if (nV < 2 || nH < 2) {
    throw new Error('A Vierendeel frame needs at least 2 piers and 2 chords.');
  }
  const t = p.thickness;
  const fixed = (p.base ?? 'fixed') === 'fixed';
  const nodeId = (vi: number, hj: number) => `n${vi}_${hj}`;

  const nodes = [];
  for (let hj = 0; hj < nH; hj++) {
    for (let vi = 0; vi < nV; vi++) {
      nodes.push({ id: nodeId(vi, hj), x: verticals[vi].x, y: horizontals[hj].y });
    }
  }

  // One section per pier line and per chord line (A = strip·t, I = t·strip³/12).
  const section = (id: string, strip: number) => ({ id, A: strip * t, I: (t * strip ** 3) / 12 });
  const sections = [
    ...verticals.map((v, vi) => section(`pier${vi}`, v.width)),
    ...horizontals.map((h, hj) => section(`chord${hj}`, h.depth)),
  ];

  const elements = [];
  // Pier (vertical) segments between adjacent chord levels.
  for (let vi = 0; vi < nV; vi++) {
    for (let hj = 0; hj < nH - 1; hj++) {
      elements.push({
        id: `p${vi}_${hj}`,
        nodeI: nodeId(vi, hj),
        nodeJ: nodeId(vi, hj + 1),
        materialId: 'm',
        sectionId: `pier${vi}`,
      });
    }
  }
  // Chord (horizontal) segments between adjacent piers.
  for (let hj = 0; hj < nH; hj++) {
    for (let vi = 0; vi < nV - 1; vi++) {
      elements.push({
        id: `c${vi}_${hj}`,
        nodeI: nodeId(vi, hj),
        nodeJ: nodeId(vi + 1, hj),
        materialId: 'm',
        sectionId: `chord${hj}`,
      });
    }
  }

  // Base supports at the lowest chord line (hj = 0).
  const supports = verticals.map((_, vi) => ({ nodeId: nodeId(vi, 0), dx: true, dy: true, rz: fixed }));

  // Lateral load split equally across the top-level nodes.
  const topHj = nH - 1;
  const nodalLoads =
    p.lateralLoad && nV > 0
      ? verticals.map((_, vi) => ({ nodeId: nodeId(vi, topHj), fx: p.lateralLoad! / nV }))
      : [];

  // Gravity on every chord member (uniform, downward).
  const elementLoads = p.gravity
    ? elements
        .filter((e) => e.id.startsWith('c'))
        .map((e) => ({ elementId: e.id, wy: -Math.abs(p.gravity!) }))
    : [];

  return {
    nodes,
    materials: [{ id: 'm', E: p.E }],
    sections,
    elements,
    supports,
    nodalLoads,
    elementLoads,
  };
}

/** A horizontal prismatic beam discretized into `segments` equal elements. */
export function buildSimpleBeam(params: {
  length: number;
  segments: number;
  E: number;
  A: number;
  I: number;
  /** Uniform gravity load over the whole beam in local −y (kip/in, positive magnitude). */
  udl?: number;
  /** 'simple' = pin + roller; 'cantilever' = fixed at the left end. */
  support?: 'simple' | 'cantilever';
}): FeaModelInput {
  const { length, segments, E, A, I } = params;
  const support = params.support ?? 'simple';
  const nodes = Array.from({ length: segments + 1 }, (_, i) => ({
    id: `n${i}`,
    x: (length * i) / segments,
    y: 0,
  }));
  const elements = Array.from({ length: segments }, (_, i) => ({
    id: `e${i}`,
    nodeI: `n${i}`,
    nodeJ: `n${i + 1}`,
    materialId: 'm',
    sectionId: 's',
  }));
  const last = `n${segments}`;
  const supports =
    support === 'cantilever'
      ? [{ nodeId: 'n0', dx: true, dy: true, rz: true }]
      : [
          { nodeId: 'n0', dx: true, dy: true },
          { nodeId: last, dy: true },
        ];
  const elementLoads = params.udl
    ? elements.map((e) => ({ elementId: e.id, wy: -Math.abs(params.udl!) }))
    : [];
  return {
    nodes,
    materials: [{ id: 'm', E }],
    sections: [{ id: 's', A, I }],
    elements,
    supports,
    nodalLoads: [],
    elementLoads,
  };
}
