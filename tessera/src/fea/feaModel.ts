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
  /**
   * Per-end moment releases (internal hinges). `Mz*` release bending about the
   * local z axis (the only bending axis in 2D); `My*` release bending about
   * local y and apply in 3D only.
   */
  releases: z
    .object({
      Mzi: z.boolean().default(false),
      Mzj: z.boolean().default(false),
      Myi: z.boolean().default(false),
      Myj: z.boolean().default(false),
    })
    .default({ Mzi: false, Mzj: false, Myi: false, Myj: false }),
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

/** Concentrated load applied at a point along an element (local components). */
export const FeaElementPointLoadSchema = z.object({
  elementId: z.string(),
  /** Position from node I as a fraction of element length, in [0, 1]. */
  at: z.number().min(0).max(1),
  /** Transverse load in LOCAL y (kip). */
  py: z.number().default(0),
  /** Transverse load in LOCAL z (kip; 3D only). */
  pz: z.number().default(0),
  /** Axial load in LOCAL x (kip). */
  px: z.number().default(0),
});

/**
 * Partial / trapezoidal distributed load over a span [a, b] (fractions of
 * length from node I). Magnitudes vary linearly from the `w*` value at `a` to
 * the `w*End` value at `b`; omit `w*End` for a constant (rectangular) load.
 */
export const FeaElementPartialLoadSchema = z.object({
  elementId: z.string(),
  /** Start of the loaded span, fraction of length from node I, in [0, 1]. */
  a: z.number().min(0).max(1),
  /** End of the loaded span, fraction of length from node I, in [0, 1] (b > a). */
  b: z.number().min(0).max(1),
  /** Distributed LOCAL-y load at `a` (kip/in). */
  wy: z.number().default(0),
  /** Distributed LOCAL-z load at `a` (kip/in; 3D only). */
  wz: z.number().default(0),
  /** Distributed axial (LOCAL-x) load at `a` (kip/in). */
  wx: z.number().default(0),
  /** Distributed LOCAL-y load at `b`; defaults to `wy` (rectangular). */
  wyEnd: z.number().optional(),
  /** Distributed LOCAL-z load at `b`; defaults to `wz`. */
  wzEnd: z.number().optional(),
  /** Distributed axial load at `b`; defaults to `wx`. */
  wxEnd: z.number().optional(),
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
  elementPointLoads: z.array(FeaElementPointLoadSchema).default([]),
  elementPartialLoads: z.array(FeaElementPartialLoadSchema).default([]),
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
  for (const l of model.elementPointLoads) {
    if (!elemIds.has(l.elementId)) fail(`point load references missing element ${l.elementId}`);
  }
  for (const l of model.elementPartialLoads) {
    if (!elemIds.has(l.elementId)) fail(`partial load references missing element ${l.elementId}`);
    if (l.b <= l.a) fail(`partial load on element ${l.elementId} needs b > a (got a=${l.a}, b=${l.b})`);
    // A trapezoid's end magnitude defaults to its start magnitude (rectangular).
    l.wyEnd ??= l.wy;
    l.wzEnd ??= l.wz;
    l.wxEnd ??= l.wx;
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

// ===========================================================================
// Fiber-section moment–curvature (build spec §2.2 — nonlinear capacity)
// ===========================================================================
//
// A separate, section-level analysis (NOT a frame model): the WASM engine builds
// a real OpenSees `FiberSection2d` from a rectangular concrete section with mild
// steel and/or prestressing strand, and sweeps curvature to trace M–φ. The TS
// design engine's closed-form power-formula φMn is the cross-check/overlay.
//
// Field names mirror the C++ `momentCurvature(spec)` ABI exactly. Material params
// follow the Devalapura–Tadros power formula (see engine/steelPresets). Sign
// convention: positive curvature = sagging, M > 0 = sagging. Units: in, kip, ksi.

/**
 * Section geometry. `h` (total depth) is always required and is the reference for
 * fiber/reinforcement positions. Provide EITHER a rectangular width `b` (the
 * engine discretizes it into `concreteLayers` layers) OR a top-level
 * `concreteFibers` list for an arbitrary section.
 */
export const MomentCurvatureSectionSchema = z.object({
  /** Total section depth h (in). */
  h: z.number().positive(),
  /** Rectangular width b (in); omit when supplying `concreteFibers`. */
  b: z.number().positive().optional(),
  /** Layers for the rectangular discretization (ignored when `concreteFibers` is set). */
  concreteLayers: z.number().int().positive().max(400).default(40),
});

/** One concrete fiber: a strip at depth `y` from the top fiber with area `area` (in²). */
export const MomentCurvatureFiberSchema = z.object({
  /** Depth from the top fiber to the fiber centroid (in). */
  y: z.number().nonnegative(),
  /** Fiber area (in²). */
  area: z.number().positive(),
});

/**
 * Concrete constitutive params (OpenSees `Concrete02`). Only `fc` is required;
 * the rest default in the C++ from `fc`/`Ec` when omitted (so leave them unset
 * unless overriding). Compression strains/stresses are negative.
 */
export const MomentCurvatureConcreteSchema = z.object({
  /** Compressive strength f′c (+ksi). */
  fc: z.number().positive(),
  /** Elastic modulus Ec (ksi); default 57000√(f′c·1000)/1000. */
  Ec: z.number().positive().optional(),
  /** Strain at f′c (negative); default −2f′c/Ec. */
  epsc0: z.number().negative().optional(),
  /** Crushing residual stress (negative); default −0.2f′c. */
  fcu: z.number().negative().optional(),
  /** Ultimate compressive strain (negative); default −0.003. */
  epscu: z.number().negative().optional(),
  /** Unload/reload stiffness ratio; default 0.1. */
  ratio: z.number().positive().optional(),
  /** Tensile strength ft (+ksi); default 7.5√(f′c·1000)/1000. */
  ft: z.number().nonnegative().optional(),
  /** Tension softening stiffness Ets (ksi); default ft/0.002. */
  Ets: z.number().positive().optional(),
});

/** Mild-steel reinforcement layer (modeled elastic-perfectly-plastic). */
export const MomentCurvatureSteelSchema = z.object({
  /** Steel area As (in²). */
  As: z.number().positive(),
  /** Depth from the top fiber to the layer (in). */
  d: z.number().positive(),
  /** Yield strength fy (ksi). */
  fy: z.number().positive(),
  /** Elastic modulus Es (ksi). */
  Es: z.number().positive().default(29000),
});

/**
 * Prestressing strand layer (Devalapura–Tadros power formula, pretensioned via an
 * initial strain εse = fse/Eps). Defaults are ASTM A416 Gr. 270 LR strand —
 * caller should pass the values from the member's selected strand preset.
 */
export const MomentCurvatureStrandSchema = z.object({
  /** Strand area Aps (in²). */
  Aps: z.number().positive(),
  /** Depth from the top fiber to the layer (in). */
  d: z.number().positive(),
  /** Effective prestress fse after losses (ksi). */
  fse: z.number().nonnegative().default(0),
  /** Elastic modulus Eps (ksi). */
  Eps: z.number().positive().default(28800),
  /** Yield strength fpy (ksi). */
  fpy: z.number().positive().default(243),
  /** Ultimate strength fpu (ksi); also the stress cap. */
  fpu: z.number().positive().default(270),
  /** Power-formula Q. */
  Q: z.number().default(0.031),
  /** Power-formula K. */
  K: z.number().positive().default(1.043),
  /** Power-formula R. */
  R: z.number().positive().default(7.36),
});

export const MomentCurvatureSpecSchema = z.object({
  section: MomentCurvatureSectionSchema,
  concrete: MomentCurvatureConcreteSchema,
  /**
   * Explicit concrete fibers for an arbitrary section (general geometry). When
   * present and non-empty, the engine uses these instead of the rectangular
   * `section.b` × `section.h` discretization.
   */
  concreteFibers: z.array(MomentCurvatureFiberSchema).default([]),
  steel: z.array(MomentCurvatureSteelSchema).default([]),
  strands: z.array(MomentCurvatureStrandSchema).default([]),
  /** External axial force (kip), tension positive; default 0 (pure flexure). */
  axial: z.number().default(0),
  /** Number of curvature increments in the sweep. */
  steps: z.number().int().positive().max(2000).default(80),
  /** Maximum curvature of the sweep (1/in); the sweep stops earlier at ultimate. */
  maxKappa: z.number().positive().default(3e-3),
});

/** One point on the moment–curvature curve. */
export const MomentCurvaturePointSchema = z.object({
  /** Curvature φ (1/in), sagging positive. */
  kappa: z.number(),
  /** Section moment M (kip-in), sagging positive. */
  M: z.number(),
  /** Section centroidal axial strain at axial equilibrium. */
  eps: z.number(),
});

/**
 * An exact response landmark detected by the engine during the sweep (first
 * threshold crossing, linearly interpolated). `strain` is the triggering fiber
 * strain (signed): tensile cracking strain, reinforcement total tensile strain
 * at yield, or the negative concrete crushing strain.
 */
export const MomentCurvatureLandmarkSchema = z.object({
  kappa: z.number(),
  M: z.number(),
  strain: z.number(),
});

/** Exact landmarks; each is null if the event was not reached within the sweep. */
export const MomentCurvatureLandmarksSchema = z.object({
  /** Concrete extreme-tension fiber reaches ft/Ec. */
  cracking: MomentCurvatureLandmarkSchema.nullable().default(null),
  /** First reinforcement fiber reaches its yield strain (mild fy/Es; strand 1%). */
  firstYield: MomentCurvatureLandmarkSchema.nullable().default(null),
  /** Concrete extreme-compression fiber reaches εcu. */
  crushing: MomentCurvatureLandmarkSchema.nullable().default(null),
});

export const MomentCurvatureResultSchema = z.object({
  /** True if the full sweep ran (or stopped cleanly at section ultimate). */
  converged: z.boolean(),
  message: z.string(),
  solver: z.string(),
  /** Peak (signed) moment over the recorded points (≈ nominal capacity Mn). */
  peakMoment: z.number(),
  points: z.array(MomentCurvaturePointSchema),
  /** Exact cracking / first-yield / crushing landmarks (absent on older engines). */
  landmarks: MomentCurvatureLandmarksSchema.default({
    cracking: null,
    firstYield: null,
    crushing: null,
  }),
});

export type MomentCurvatureSpecInput = z.input<typeof MomentCurvatureSpecSchema>;
export type MomentCurvatureSpec = z.infer<typeof MomentCurvatureSpecSchema>;
export type MomentCurvatureResult = z.infer<typeof MomentCurvatureResultSchema>;
export type MomentCurvaturePoint = z.infer<typeof MomentCurvaturePointSchema>;
export type MomentCurvatureLandmark = z.infer<typeof MomentCurvatureLandmarkSchema>;
export type MomentCurvatureLandmarks = z.infer<typeof MomentCurvatureLandmarksSchema>;
export type MomentCurvatureFiber = z.infer<typeof MomentCurvatureFiberSchema>;

/**
 * Normalize and validate a moment–curvature spec: applies defaults (so the WASM
 * ABI sees every field) and checks reinforcement depths lie within the section
 * and that the section actually has reinforcement.
 */
export function normalizeMomentCurvatureSpec(input: MomentCurvatureSpecInput): MomentCurvatureSpec {
  const spec = MomentCurvatureSpecSchema.parse(input);
  const { h, b } = spec.section;
  const fail = (msg: string): never => {
    throw new Error(`Invalid moment–curvature spec: ${msg}`);
  };
  // Geometry: explicit fibers OR a rectangular width, exactly one usable form.
  if (spec.concreteFibers.length === 0 && b == null) {
    fail('section needs either a rectangular width b or a non-empty concreteFibers list');
  }
  for (const f of spec.concreteFibers) {
    if (f.y > h) fail(`concrete fiber depth y=${f.y} exceeds section depth h=${h}`);
  }
  for (const s of spec.steel) {
    if (s.d >= h) fail(`steel layer depth d=${s.d} must be within section depth h=${h}`);
  }
  for (const s of spec.strands) {
    if (s.d >= h) fail(`strand layer depth d=${s.d} must be within section depth h=${h}`);
  }
  if (spec.steel.length === 0 && spec.strands.length === 0) {
    fail('section has no reinforcement (add at least one steel or strand layer)');
  }
  return spec;
}
