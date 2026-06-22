/**
 * Phase 1 member-design model.
 *
 * A flat, UI- and persistence-friendly description of a single beam member,
 * validated by zod and stored in the project (so it round-trips through `.tsr`).
 * `designToInput` maps it into the engine's `AnalyzeMemberInput`.
 *
 * Display units here are engineer-friendly (span in ft, loads in kip/ft); the
 * mapper converts to the engine's internal kip/in. Geometry is in inches.
 *
 * NOTE: the richer `members[]` domain model (schema/domain.ts) is the target for
 * multi-member project management in Phase 2; this flat model is the Phase-1
 * single-member vehicle and will be reconciled with it then.
 */
import { z } from 'zod';
import steelPresets from '../engine/steelPresets';
import type { PowerFormulaSteel, Section, SteelLayer } from '../engine/types';
import type { AnalyzeMemberInput } from '../engine/analyzeMember';
import type { StrandType } from '../engine/designChecks/prestressLosses';

export const ReinfRowSchema = z.object({
  id: z.string(),
  gradeId: z.string().default('grade270'),
  /** Steel area (in²). */
  area: z.number().nonnegative().default(0),
  /** Depth from the top (compression) fiber (in). */
  depth: z.number().nonnegative().default(0),
  /** Horizontal position (in) — used for biaxial analysis. */
  x: z.number().optional(),
  /** Effective prestress (ksi); 0 for mild steel. */
  fse: z.number().nonnegative().default(0),
  kind: z.enum(['mild', 'strand']).default('mild'),
});

export type ReinfRow = z.infer<typeof ReinfRowSchema>;

const PointSchema = z.object({ x: z.number(), y: z.number() });

export const MemberDesignSchema = z.object({
  name: z.string().default('Beam 1'),
  /** Member type. 'column'/'wall' enable the P-M interaction check. */
  memberType: z.enum(['beam', 'column', 'wall']).default('beam'),
  /** Factored axial demand for a column/wall (kip, compression +). */
  axialPu: z.number().default(0),
  /** Column transverse confinement (affects the φPn,max cap). */
  tie: z.enum(['tied', 'spiral']).default('tied'),
  /** Wall handling: impact/suction multiplier on self-weight at stripping. */
  handlingImpact: z.number().positive().default(1.5),
  sectionType: z.enum(['rectangular', 'tbeam', 'doubletee', 'hollowcore', 'sandwich', 'custom', 'dxf']).default('rectangular'),
  // Geometry (in)
  b: z.number().positive().default(12), // width (rect) / web width (tee)
  h: z.number().positive().default(28),
  bf: z.number().positive().default(36), // flange width (tee / double-tee / hollowcore)
  hf: z.number().positive().default(4), // flange thickness (tee / double-tee)
  // Double-tee
  numStems: z.number().int().positive().default(2),
  stemWidth: z.number().positive().default(4.75),
  // Hollowcore
  numVoids: z.number().int().nonnegative().default(6),
  voidDiameter: z.number().positive().default(6),
  voidCenterDepth: z.number().positive().default(4),
  // Sandwich wall panel (two concrete wythes + insulation gap)
  bt: z.number().positive().default(48), // top wythe width
  ht: z.number().positive().default(3), // top wythe thickness
  hg: z.number().positive().default(2), // gap (insulation) thickness
  bb: z.number().positive().default(48), // bottom wythe width
  // Composite cast-in-place topping (floor members)
  hasTopping: z.boolean().default(false),
  toppingWidth: z.number().positive().default(48),
  toppingThickness: z.number().positive().default(2),
  toppingFc: z.number().positive().default(4),
  // Custom polygon (sectionType === 'custom')
  points: z.array(PointSchema).optional(),
  holes: z.array(z.array(PointSchema)).optional(),
  /** Run the biaxial φMx–φMy interaction analysis (uses per-layer x). */
  biaxial: z.boolean().default(false),
  // Materials
  fc: z.number().positive().default(6),
  fci: z.number().positive().default(4.2),
  wc: z.number().positive().default(150),
  lambda: z.number().positive().default(1),
  // Span (ft) & uniform loads (kip/ft)
  L: z.number().positive().default(30),
  superDead: z.number().nonnegative().default(0.3),
  live: z.number().nonnegative().default(0.5),
  // Reinforcement
  layers: z
    .array(ReinfRowSchema)
    .default([{ id: 'r1', gradeId: 'grade270', area: 1.53, depth: 25, fse: 175, kind: 'strand' }]),
  // Design parameters
  serviceClass: z.enum(['U', 'T']).default('U'),
  Av: z.number().nonnegative().default(0.22),
  fyt: z.number().positive().default(60),
  stirrupSpacing: z.number().positive().default(12),
  RH: z.number().min(0).max(100).default(70),
  VS: z.number().positive().default(3),
  fpi: z.number().nonnegative().default(189),
  strandType: z.enum(['270LR', '250LR', '270SR', '250SR']).default('270LR'),
  endRegion: z.boolean().default(false),
});

export type MemberDesignInput = z.infer<typeof MemberDesignSchema>;

/** A fully-populated default design (a prestressed beam that exercises all checks). */
export function defaultMemberDesign(): MemberDesignInput {
  return MemberDesignSchema.parse({});
}

/** Resolve a steel grade id to its power-formula parameters (falls back to Gr 60). */
export function gradeById(id: string): PowerFormulaSteel {
  return steelPresets.find((p) => p.id === id) ?? steelPresets[0];
}

/** Grades available for the reinforcement editor. */
export const gradeOptions = steelPresets.map((p) => ({ id: p.id, name: p.name, category: p.category }));

/** Build the engine section from the design model (parametric or custom polygon). */
export function buildEngineSection(d: MemberDesignInput): Section {
  const base = { fc: d.fc, h: d.h, lambda: d.lambda };
  switch (d.sectionType) {
    case 'custom':
    case 'dxf': {
      const points = d.points ?? [];
      const h = points.length ? Math.max(...points.map((p) => p.y)) : d.h;
      return { sectionType: d.sectionType, fc: d.fc, lambda: d.lambda, h, points, holes: d.holes ?? [] };
    }
    case 'tbeam':
      return { ...base, sectionType: 'tbeam', bw: d.b, bf: d.bf, hf: d.hf };
    case 'doubletee':
      return { ...base, sectionType: 'doubletee', bf: d.bf, hf: d.hf, numStems: d.numStems, stemWidth: d.stemWidth, bw: d.numStems * d.stemWidth };
    case 'hollowcore':
      return { ...base, sectionType: 'hollowcore', bf: d.bf, numVoids: d.numVoids, voidDiameter: d.voidDiameter, voidCenterDepth: d.voidCenterDepth, bw: d.bf };
    case 'sandwich':
      return { ...base, sectionType: 'sandwich', bt: d.bt, ht: d.ht, hg: d.hg, bb: d.bb, bw: Math.max(d.bt, d.bb) };
    default:
      return { ...base, sectionType: 'rectangular', bw: d.b, bf: d.b, hf: d.h };
  }
}

/** Topping spec for composite floor members, or null when none. */
export function toppingOf(d: MemberDesignInput): { width: number; thickness: number; fc: number } | null {
  return d.hasTopping ? { width: d.toppingWidth, thickness: d.toppingThickness, fc: d.toppingFc } : null;
}

/** Horizontal center of the section (default x for reinforcement). */
export function sectionCenterX(d: MemberDesignInput): number {
  if ((d.sectionType === 'custom' || d.sectionType === 'dxf') && d.points && d.points.length) {
    const xs = d.points.map((p) => p.x);
    return (Math.min(...xs) + Math.max(...xs)) / 2;
  }
  if (d.sectionType === 'tbeam' || d.sectionType === 'doubletee' || d.sectionType === 'hollowcore') return d.bf / 2;
  if (d.sectionType === 'sandwich') return Math.max(d.bt, d.bb) / 2;
  return d.b / 2;
}

/** Map the flat design model into the engine's member-analysis input. */
export function designToInput(d: MemberDesignInput): AnalyzeMemberInput {
  const section = buildEngineSection(d);
  const centerX = sectionCenterX(d);
  const layers: SteelLayer[] = d.layers.map((r) => ({
    area: r.area,
    depth: r.depth,
    x: r.x ?? centerX,
    fse: r.kind === 'strand' ? r.fse : 0,
    steel: gradeById(r.gradeId),
  }));
  return {
    section,
    fci: d.fci,
    wc: d.wc,
    lambda: d.lambda,
    layers,
    L: d.L * 12, // ft → in
    loads: { superDead: d.superDead / 12, live: d.live / 12 }, // kip/ft → kip/in
    topping: toppingOf(d) ?? undefined,
    design: {
      serviceClass: d.serviceClass,
      endRegion: d.endRegion,
      RH: d.RH,
      VS: d.VS,
      Av: d.Av,
      fyt: d.fyt,
      stirrupSpacing: d.stirrupSpacing,
    },
    prestress: { fpi: d.fpi, strandType: d.strandType as StrandType },
  };
}
