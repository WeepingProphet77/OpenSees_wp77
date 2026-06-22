/**
 * Tessera FEA model & result contract (build spec §2.1 — "model JSON in →
 * results JSON out"). These zod schemas are the typed, versioned boundary
 * between the TypeScript app and the OpenSees-lineage WASM solver. The solver
 * itself is pure FEA; all ACI/PCI code-design math stays in TS.
 *
 * Phase 3 scope: linear-elastic 2D and 3D frames. 2D nodes carry 3 DOF
 * (dx, dy, rz); 3D nodes carry 6 DOF (dx, dy, dz, rx, ry, rz). Elements are
 * 2-node elastic beam-columns (OpenSees `elasticBeamColumn` + `LinearCrdTransf`).
 *
 * Units (US customary, consistent): length in, force kip, moment kip-in,
 * modulus ksi, area in², inertia in⁴, distributed load kip/in.
 */
import { z } from 'zod';

export const FeaNodeSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  /** Out-of-plane coordinate (3D only; 0 for 2D models). */
  z: z.number().default(0),
});

export const FeaMaterialSchema = z.object({
  id: z.string(),
  /** Young's modulus E (ksi). */
  E: z.number().positive(),
  /** Shear modulus G (ksi); required for 3D (torsion), ignored in 2D. */
  G: z.number().positive().optional(),
});

export const FeaSectionSchema = z.object({
  id: z.string(),
  /** Cross-sectional area A (in²). */
  A: z.number().positive(),
  /** Moment of inertia about the local z (strong / in-plane) axis, Iz (in⁴). */
  I: z.number().positive(),
  /** Moment of inertia about the local y axis, Iy (in⁴); required for 3D. */
  Iy: z.number().positive().optional(),
  /** Torsional constant J (in⁴); required for 3D. */
  J: z.number().positive().optional(),
});

export const FeaElementSchema = z.object({
  id: z.string(),
  /** Element formulation; the elastic 2D/3D beam-column. */
  type: z.literal('elasticBeamColumn').default('elasticBeamColumn'),
  nodeI: z.string(),
  nodeJ: z.string(),
  materialId: z.string(),
  sectionId: z.string(),
  /**
   * 3D orientation: a vector lying in the element's local x-z plane (OpenSees
   * `LinearCrdTransf3d` convention). Omit to use a sensible default. Ignored in 2D.
   */
  vecxz: z.tuple([z.number(), z.number(), z.number()]).optional(),
});

/** Homogeneous support fixity to ground (true = restrained). */
export const FeaSupportSchema = z.object({
  nodeId: z.string(),
  dx: z.boolean().default(false),
  dy: z.boolean().default(false),
  dz: z.boolean().default(false),
  rx: z.boolean().default(false),
  ry: z.boolean().default(false),
  rz: z.boolean().default(false),
});

export const FeaNodalLoadSchema = z.object({
  nodeId: z.string(),
  /** Force in global X (kip). */
  fx: z.number().default(0),
  /** Force in global Y (kip). */
  fy: z.number().default(0),
  /** Force in global Z (kip; 3D only). */
  fz: z.number().default(0),
  /** Moment about global X (kip-in; 3D only). */
  mx: z.number().default(0),
  /** Moment about global Y (kip-in; 3D only). */
  my: z.number().default(0),
  /** Moment about global Z (kip-in). */
  mz: z.number().default(0),
});

export const FeaElementLoadSchema = z.object({
  elementId: z.string(),
  /** Uniform load along the element in the LOCAL y direction (kip/in). */
  wy: z.number(),
  /** Uniform load along the element in the LOCAL z direction (kip/in; 3D only). */
  wz: z.number().default(0),
  /** Uniform load along the element axis, LOCAL x (kip/in). */
  wx: z.number().default(0),
});

export const FeaModelSchema = z.object({
  analysis: z.literal('linearStatic').default('linearStatic'),
  dimension: z.union([z.literal(2), z.literal(3)]).default(2),
  nodes: z.array(FeaNodeSchema).min(1),
  materials: z.array(FeaMaterialSchema).min(1),
  sections: z.array(FeaSectionSchema).min(1),
  elements: z.array(FeaElementSchema).min(1),
  supports: z.array(FeaSupportSchema).default([]),
  nodalLoads: z.array(FeaNodalLoadSchema).default([]),
  elementLoads: z.array(FeaElementLoadSchema).default([]),
});

export const FeaNodalDisplacementSchema = z.object({
  nodeId: z.string(),
  dx: z.number(),
  dy: z.number(),
  rz: z.number(),
  /** 3D-only components. */
  dz: z.number().optional(),
  rx: z.number().optional(),
  ry: z.number().optional(),
});

export const FeaReactionSchema = z.object({
  nodeId: z.string(),
  fx: z.number(),
  fy: z.number(),
  mz: z.number(),
  /** 3D-only components. */
  fz: z.number().optional(),
  mx: z.number().optional(),
  my: z.number().optional(),
});

/**
 * Element end forces in LOCAL coordinates. `iN/iV/iM` are axial, local-y shear,
 * and local-z moment at end I (likewise jN/jV/jM at end J) — valid in 2D and 3D.
 * The remaining components (local-z shear, torsion, local-y moment) are 3D only.
 */
export const FeaElementForceSchema = z.object({
  elementId: z.string(),
  iN: z.number(),
  iV: z.number(),
  iM: z.number(),
  jN: z.number(),
  jV: z.number(),
  jM: z.number(),
  iVz: z.number().optional(),
  iT: z.number().optional(),
  iMy: z.number().optional(),
  jVz: z.number().optional(),
  jT: z.number().optional(),
  jMy: z.number().optional(),
});

export const FeaResultSchema = z.object({
  /** Solver reported success AND a finite, well-conditioned solution (spec §13). */
  converged: z.boolean(),
  /** Human-readable solver identity, e.g. the Eigen factorization used. */
  solver: z.string(),
  message: z.string(),
  /** Relative residual ‖K·d − f‖ / ‖f‖ of the linear solve. */
  residual: z.number(),
  nodalDisplacements: z.array(FeaNodalDisplacementSchema),
  reactions: z.array(FeaReactionSchema),
  elementForces: z.array(FeaElementForceSchema),
});

/** Input accepted from callers (defaults not yet applied). */
export type FeaModelInput = z.input<typeof FeaModelSchema>;
/** Fully-normalized model handed to the solver (all defaults applied). */
export type FeaModel = z.infer<typeof FeaModelSchema>;
export type FeaResult = z.infer<typeof FeaResultSchema>;
export type FeaNode = z.infer<typeof FeaNodeSchema>;
export type FeaElement = z.infer<typeof FeaElementSchema>;

/**
 * Normalize and validate a model: applies zod defaults (so the WASM ABI can
 * assume every field is present) and checks referential integrity (element
 * node/material/section ids, support/load targets) — failures the bare schema
 * cannot catch but the C++ would otherwise `.at()`-throw on.
 */
export function normalizeFeaModel(input: FeaModelInput): FeaModel {
  const model = FeaModelSchema.parse(input);

  const nodeIds = new Set(model.nodes.map((n) => n.id));
  const matIds = new Set(model.materials.map((m) => m.id));
  const secIds = new Set(model.sections.map((s) => s.id));
  const elemIds = new Set(model.elements.map((e) => e.id));

  const fail = (msg: string): never => {
    throw new Error(`Invalid FEA model: ${msg}`);
  };

  for (const e of model.elements) {
    if (!nodeIds.has(e.nodeI)) fail(`element ${e.id} references missing nodeI ${e.nodeI}`);
    if (!nodeIds.has(e.nodeJ)) fail(`element ${e.id} references missing nodeJ ${e.nodeJ}`);
    if (e.nodeI === e.nodeJ) fail(`element ${e.id} has zero length (nodeI === nodeJ)`);
    if (!matIds.has(e.materialId)) fail(`element ${e.id} references missing material ${e.materialId}`);
    if (!secIds.has(e.sectionId)) fail(`element ${e.id} references missing section ${e.sectionId}`);
  }
  for (const s of model.supports) {
    if (!nodeIds.has(s.nodeId)) fail(`support references missing node ${s.nodeId}`);
  }
  for (const l of model.nodalLoads) {
    if (!nodeIds.has(l.nodeId)) fail(`nodal load references missing node ${l.nodeId}`);
  }
  for (const l of model.elementLoads) {
    if (!elemIds.has(l.elementId)) fail(`element load references missing element ${l.elementId}`);
  }

  // 3D models need shear modulus G (torsion) and the out-of-plane section
  // properties Iy and J on every material/section actually used by an element.
  if (model.dimension === 3) {
    const matById = new Map(model.materials.map((m) => [m.id, m]));
    const secById = new Map(model.sections.map((s) => [s.id, s]));
    for (const e of model.elements) {
      const m = matById.get(e.materialId)!;
      const s = secById.get(e.sectionId)!;
      if (m.G == null) fail(`3D model: material ${m.id} (element ${e.id}) is missing shear modulus G`);
      if (s.Iy == null) fail(`3D model: section ${s.id} (element ${e.id}) is missing Iy`);
      if (s.J == null) fail(`3D model: section ${s.id} (element ${e.id}) is missing torsional constant J`);
    }
  }
  return model;
}
