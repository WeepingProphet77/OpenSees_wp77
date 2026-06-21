/**
 * Tessera domain model (build spec §4 / §4.1): sections, reinforcement, members
 * with local axes, supports, and loads. These zod schemas are embedded in the
 * `.tsr` project schema and are the typed contract the design engine consumes.
 *
 * Geometry/material units are US customary (in, ksi, kip). Member geometry is
 * intentionally permissive on shape-specific dimensions (each `sectionType`
 * uses a different subset, mirroring the flexural engine's `Section` type).
 */
import { z } from 'zod';

export const SectionTypeSchema = z.enum([
  'rectangular',
  'tbeam',
  'sandwich',
  'doubletee',
  'hollowcore',
  'custom',
  'dxf',
]);

export const PointSchema = z.object({ x: z.number(), y: z.number() });

export const SectionSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  sectionType: SectionTypeSchema,
  /** Reference into materials.concrete. */
  concreteId: z.string().optional(),
  // Parametric geometry (subset per type; in).
  bf: z.number().positive().optional(),
  bw: z.number().positive().optional(),
  hf: z.number().positive().optional(),
  h: z.number().positive().optional(),
  bt: z.number().positive().optional(),
  ht: z.number().positive().optional(),
  hg: z.number().positive().optional(),
  bb: z.number().positive().optional(),
  numStems: z.number().int().positive().optional(),
  stemWidth: z.number().positive().optional(),
  numVoids: z.number().int().nonnegative().optional(),
  voidDiameter: z.number().positive().optional(),
  voidCenterDepth: z.number().positive().optional(),
  // Polygon geometry (custom / dxf).
  points: z.array(PointSchema).optional(),
  holes: z.array(z.array(PointSchema)).optional(),
});

export const ReinforcementLayerSchema = z.object({
  id: z.string(),
  kind: z.enum(['mild', 'strand']).default('mild'),
  /** Steel area (in²). */
  area: z.number().nonnegative(),
  /** Depth from the extreme compression fiber (in). */
  depth: z.number().nonnegative(),
  /** Horizontal position for biaxial analysis (in). */
  x: z.number().optional(),
  /** Effective prestress after losses (ksi); 0 for mild steel. */
  fse: z.number().nonnegative().default(0),
  /** Reference into materials.steel (grade). */
  gradeId: z.string().optional(),
});

export const SupportSchema = z.object({
  id: z.string(),
  /** Distance along the member from end I (in). */
  position: z.number().nonnegative(),
  dx: z.boolean().default(true),
  dy: z.boolean().default(true),
  rz: z.boolean().default(false),
});

export const LoadSchema = z.object({
  id: z.string(),
  kind: z.enum(['uniform', 'point', 'moment', 'selfWeight']),
  /** Load category for combinations / sustained-load logic. */
  category: z.enum(['dead', 'superDead', 'live', 'prestress', 'other']).default('dead'),
  /** Reference into loadCases. */
  caseId: z.string().optional(),
  /** Uniform load (kip/in). */
  w: z.number().optional(),
  /** Point load (kip). */
  P: z.number().optional(),
  /** Applied moment (kip-in). */
  M: z.number().optional(),
  /** Location of point/moment load along the member (in). */
  position: z.number().optional(),
});

export const MemberTypeSchema = z.enum(['beam', 'floor', 'wall', 'column', 'vierendeel']);

/**
 * Member local coordinate system (build spec §4.1, RISA-3D convention). Local x
 * runs I→J; β is the section roll about local x (degrees).
 */
export const LocalAxisSchema = z.object({
  roll: z.number().default(0),
});

export const DesignParamsSchema = z.object({
  serviceClass: z.enum(['U', 'T', 'C']).default('U'),
  /** Ambient relative humidity (%) for shrinkage loss. */
  RH: z.number().min(0).max(100).optional(),
  /** Volume-to-surface ratio (in) for shrinkage loss. */
  VS: z.number().positive().optional(),
  /** Provided shear reinforcement area within the spacing (in²). */
  Av: z.number().nonnegative().optional(),
  /** Transverse reinforcement yield strength (ksi). */
  fyt: z.number().positive().optional(),
  /** Stirrup spacing (in). */
  stirrupSpacing: z.number().positive().optional(),
});

export const MemberSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  type: MemberTypeSchema.default('beam'),
  /** Member length / span (in). */
  length: z.number().positive(),
  localAxis: LocalAxisSchema.default({ roll: 0 }),
  /** Reference into the project's sections. */
  sectionId: z.string().optional(),
  reinforcement: z.array(ReinforcementLayerSchema).default([]),
  supports: z.array(SupportSchema).default([]),
  loads: z.array(LoadSchema).default([]),
  design: DesignParamsSchema.optional(),
});

export type Section = z.infer<typeof SectionSchema>;
export type ReinforcementLayer = z.infer<typeof ReinforcementLayerSchema>;
export type Support = z.infer<typeof SupportSchema>;
export type Load = z.infer<typeof LoadSchema>;
export type Member = z.infer<typeof MemberSchema>;
export type DesignParams = z.infer<typeof DesignParamsSchema>;
