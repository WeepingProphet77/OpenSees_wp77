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
  /** Superimposed uniform gravity on chord clear spans, local −y (kip/in, positive). */
  gravity?: number;
  /** Concrete unit weight (pcf) for self-weight; 0 / omitted = ignore self-weight. */
  unitWeight?: number;
  /**
   * Model the finite joint size with rigid end zones (default true): each member's
   * clear span is the centerline span less the half-widths of the perpendicular
   * strips it frames into, with rigid stubs bridging joint center → member face.
   */
  rigidEndZones?: boolean;
  /** Base fixity at the lowest chord line: 'fixed' (default) or 'pinned'. */
  base?: 'fixed' | 'pinned';
}

/**
 * A Vierendeel wall panel (a panel pierced by a grid of openings) mapped to its
 * equivalent rigid-jointed frame: the solid strips between/around the openings
 * become piers (verticals) and chords (horizontals), joined rigidly with no
 * diagonals. Joint nodes sit at every pier×chord centerline intersection.
 *
 * With `rigidEndZones` (default), each flexible member spans only the clear
 * distance between the faces of the strips it frames into; rigid stubs connect
 * the joint centers to those faces, so the joint overlap behaves as a rigid
 * block and the clear-span flexibility is accurate. Member sections are the
 * strip (A = strip·t, I = t·strip³/12 for in-plane bending).
 *
 * Self-weight (when `unitWeight` is given) is applied exactly: each flexible
 * member carries its strip self-weight over its clear span, and every joint
 * overlap (pier∩chord = w·d·t) is applied as a nodal weight — so the rigid joint
 * areas are included and the total equals the solid panel weight.
 *
 * The result feeds the same 2D `FeaEngine.solve` as any other frame; the
 * flexible members keep the `p…`/`c…` ids so member end forces flow straight into
 * the per-member sectional checks (rigid stubs use `rl_…` ids).
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
  const rigid = p.rigidEndZones ?? true;
  const gamma = p.unitWeight ? p.unitWeight / 1728 / 1000 : 0; // pcf → kip/in³
  const jointId = (vi: number, hj: number) => `n${vi}_${hj}`;

  const nodes: { id: string; x: number; y: number }[] = [];
  const xy = new Map<string, { x: number; y: number }>();
  const addNode = (id: string, x: number, y: number) => {
    nodes.push({ id, x, y });
    xy.set(id, { x, y });
  };
  for (let hj = 0; hj < nH; hj++) {
    for (let vi = 0; vi < nV; vi++) addNode(jointId(vi, hj), verticals[vi].x, horizontals[hj].y);
  }

  // One section per pier line and per chord line (A = strip·t, I = t·strip³/12),
  // plus a single very-stiff section for the rigid end-zone stubs.
  const section = (id: string, strip: number) => ({ id, A: strip * t, I: (t * strip ** 3) / 12 });
  const realSecs = [
    ...verticals.map((v, vi) => section(`pier${vi}`, v.width)),
    ...horizontals.map((h, hj) => section(`chord${hj}`, h.depth)),
  ];
  const RIGID_FACTOR = 1e3;
  const sections = rigid
    ? [
        ...realSecs,
        {
          id: 'rigid',
          A: Math.max(...realSecs.map((s) => s.A)) * RIGID_FACTOR,
          I: Math.max(...realSecs.map((s) => s.I)) * RIGID_FACTOR,
        },
      ]
    : realSecs;

  const elements: { id: string; nodeI: string; nodeJ: string; materialId: string; sectionId: string }[] = [];
  // Flexible element id → local distributed load (wx axial, wy transverse). Gravity
  // is global −y: transverse on horizontal chords (wy), axial on vertical piers (wx).
  const elemLoad = new Map<string, { wx: number; wy: number }>();
  const addElemLoad = (id: string, wx: number, wy: number) => {
    const cur = elemLoad.get(id) ?? { wx: 0, wy: 0 };
    elemLoad.set(id, { wx: cur.wx + wx, wy: cur.wy + wy });
  };
  const nodeLoad = new Map<string, { fx: number; fy: number }>();
  const addNodeLoad = (id: string, fx: number, fy: number) => {
    const cur = nodeLoad.get(id) ?? { fx: 0, fy: 0 };
    nodeLoad.set(id, { fx: cur.fx + fx, fy: cur.fy + fy });
  };

  // Add a flexible member, inset from each joint by the perpendicular strip's
  // half-width with rigid stubs when rigidEndZones is on. The flexible span keeps
  // the member id; the stubs use rl_ ids and the rigid section.
  const addMember = (id: string, sectionId: string, aId: string, bId: string, offA: number, offB: number) => {
    const a = xy.get(aId)!;
    const b = xy.get(bId)!;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (!rigid || L - offA - offB <= 1e-6) {
      elements.push({ id, nodeI: aId, nodeJ: bId, materialId: 'm', sectionId });
      return;
    }
    const ux = (b.x - a.x) / L;
    const uy = (b.y - a.y) / L;
    const faceA = `${id}~a`;
    const faceB = `${id}~b`;
    addNode(faceA, a.x + ux * offA, a.y + uy * offA);
    addNode(faceB, b.x - ux * offB, b.y - uy * offB);
    elements.push({ id: `rl_${id}_a`, nodeI: aId, nodeJ: faceA, materialId: 'm', sectionId: 'rigid' });
    elements.push({ id, nodeI: faceA, nodeJ: faceB, materialId: 'm', sectionId });
    elements.push({ id: `rl_${id}_b`, nodeI: faceB, nodeJ: bId, materialId: 'm', sectionId: 'rigid' });
  };

  // Pier members (vertical), inset by the chord half-depths at each end.
  for (let vi = 0; vi < nV; vi++) {
    for (let hj = 0; hj < nH - 1; hj++) {
      const id = `p${vi}_${hj}`;
      addMember(id, `pier${vi}`, jointId(vi, hj), jointId(vi, hj + 1), horizontals[hj].depth / 2, horizontals[hj + 1].depth / 2);
      // Pier runs bottom→top (local +x up); self-weight is axial, local −x.
      if (gamma > 0) addElemLoad(id, -(verticals[vi].width * t * gamma), 0);
    }
  }
  // Chord members (horizontal), inset by the pier half-widths at each end.
  for (let hj = 0; hj < nH; hj++) {
    for (let vi = 0; vi < nV - 1; vi++) {
      const id = `c${vi}_${hj}`;
      addMember(id, `chord${hj}`, jointId(vi, hj), jointId(vi + 1, hj), verticals[vi].width / 2, verticals[vi + 1].width / 2);
      // Chord is horizontal (local +y up); self-weight + superimposed are transverse, local −y.
      let w = gamma > 0 ? horizontals[hj].depth * t * gamma : 0;
      if (p.gravity) w += Math.abs(p.gravity);
      if (w > 0) addElemLoad(id, 0, -w);
    }
  }

  // Joint-overlap self-weight (the rigid-area weight) as nodal loads — only in the
  // rigid model, where the flexible members exclude the joints (no double count).
  if (rigid && gamma > 0) {
    for (let vi = 0; vi < nV; vi++) {
      for (let hj = 0; hj < nH; hj++) {
        addNodeLoad(jointId(vi, hj), 0, -(verticals[vi].width * horizontals[hj].depth * t * gamma));
      }
    }
  }

  // Lateral load split equally across the top-level joints.
  const topHj = nH - 1;
  if (p.lateralLoad) {
    for (let vi = 0; vi < nV; vi++) addNodeLoad(jointId(vi, topHj), p.lateralLoad / nV, 0);
  }

  const supports = verticals.map((_, vi) => ({ nodeId: jointId(vi, 0), dx: true, dy: true, rz: fixed }));

  return {
    nodes,
    materials: [{ id: 'm', E: p.E }],
    sections,
    elements,
    supports,
    nodalLoads: [...nodeLoad].map(([nodeId, l]) => ({ nodeId, fx: l.fx, fy: l.fy })),
    elementLoads: [...elemLoad].map(([elementId, l]) => ({ elementId, wx: l.wx, wy: l.wy })),
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
