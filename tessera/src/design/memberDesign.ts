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
  /** Effective prestress (ksi); 0 for mild steel. */
  fse: z.number().nonnegative().default(0),
  kind: z.enum(['mild', 'strand']).default('mild'),
});

export type ReinfRow = z.infer<typeof ReinfRowSchema>;

export const MemberDesignSchema = z.object({
  name: z.string().default('Beam 1'),
  sectionType: z.enum(['rectangular', 'tbeam']).default('rectangular'),
  // Geometry (in)
  b: z.number().positive().default(12), // width (rect) / web width (tee)
  h: z.number().positive().default(28),
  bf: z.number().positive().default(36), // flange width (tee)
  hf: z.number().positive().default(4), // flange thickness (tee)
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

/** Map the flat design model into the engine's member-analysis input. */
export function designToInput(d: MemberDesignInput): AnalyzeMemberInput {
  const isT = d.sectionType === 'tbeam';
  const section: Section = {
    sectionType: d.sectionType,
    fc: d.fc,
    h: d.h,
    lambda: d.lambda,
    bw: d.b,
    bf: isT ? d.bf : d.b,
    hf: isT ? d.hf : d.h,
  };
  const layers: SteelLayer[] = d.layers.map((r) => ({
    area: r.area,
    depth: r.depth,
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
