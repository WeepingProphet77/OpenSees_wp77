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
 * This is the canonical elastic-frame validation case for the Phase 3 spike
 * and a minimal stand-in for the eventual Vierendeel equivalent frame.
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
