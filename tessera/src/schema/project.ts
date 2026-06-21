/**
 * The Tessera project (`.tsr`) schema.
 *
 * The `.tsr` file is UTF-8 JSON validated by these zod schemas (build spec §9).
 * The in-browser store holds a `Project` as the single source of truth; saving
 * serializes it and loading validates + migrates it back.
 *
 * Phase 0 fully specifies the envelope (format/version/meta/settings) and the
 * material catalog; the section / member / load collections are intentionally
 * lenient placeholders (validated for an `id`, otherwise passthrough) so later
 * phases can flesh out the domain model without breaking older files.
 */
import { z } from 'zod';
import { MemberSchema, SectionSchema } from './domain';
import { MemberDesignSchema, defaultMemberDesign } from '../design/memberDesign';

/** Current schema version. Bumped whenever the persisted shape changes. */
export const CURRENT_SCHEMA_VERSION = 1;

/** Discriminating literal at the top of every Tessera project file. */
export const PROJECT_FORMAT = 'tessera-project';

export const UnitsSystemSchema = z.literal('US');
export const DesignCodeSchema = z.literal('ACI318-19');

export const MetaSchema = z.object({
  name: z.string().default('Untitled Project'),
  project: z.string().default(''),
  engineer: z.string().default(''),
  createdISO: z.string(),
  modifiedISO: z.string(),
});

export const SettingsSchema = z.object({
  units: UnitsSystemSchema.default('US'),
  code: DesignCodeSchema.default('ACI318-19'),
});

/** A concrete material (US customary: f'c in ksi, wc in pcf). */
export const ConcreteSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  fc: z.number().positive(), // f'c (ksi)
  fci: z.number().positive().optional(), // f'ci at transfer (ksi)
  wc: z.number().positive().optional(), // unit weight (pcf)
  lambda: z.number().positive().optional(), // lightweight factor λ
  Ec: z.number().positive().optional(), // modulus (ksi)
});

/** A steel grade — the power-formula parameter set (see steelPresets). */
export const SteelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  category: z.enum(['mild', 'prestressing']).optional(),
  Es: z.number().positive(),
  fpu: z.number().positive(),
  fpy: z.number().positive(),
  stressCap: z.number().positive(),
  Q: z.number(),
  R: z.number(),
  K: z.number(),
  defaultFse: z.number().default(0),
});

// Section and Member are fully modeled in ./domain (build spec §4 / §4.1).
// Load cases & ACI 318-19 load combinations are fleshed out in Phase 2, so they
// remain lenient placeholders for now (keep an `id`, preserve other fields).
const WithId = z.object({ id: z.string() }).passthrough();
export const LoadCaseSchema = WithId;
export const LoadComboSchema = WithId;

export const ProjectSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  appVersion: z.string(),
  meta: MetaSchema,
  settings: SettingsSchema,
  materials: z.object({
    concrete: z.array(ConcreteSchema),
    steel: z.array(SteelSchema),
  }),
  sections: z.array(SectionSchema),
  members: z.array(MemberSchema),
  loadCases: z.array(LoadCaseSchema),
  loadCombos: z.array(LoadComboSchema),
  // Phase 1 single-member design model (UI/persistence vehicle; see
  // design/memberDesign.ts). Reconciled with members[] in Phase 2.
  design: MemberDesignSchema.optional(),
  // Optional, regenerable analysis/design cache.
  results: z.unknown().optional(),
});

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectMeta = z.infer<typeof MetaSchema>;
export type Concrete = z.infer<typeof ConcreteSchema>;
export type Steel = z.infer<typeof SteelSchema>;

/**
 * Build a fresh, valid, empty project. `now` is injectable for deterministic
 * tests.
 */
export function createEmptyProject(appVersion: string, now: Date = new Date()): Project {
  const iso = now.toISOString();
  return {
    format: PROJECT_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion,
    meta: {
      name: 'Untitled Project',
      project: '',
      engineer: '',
      createdISO: iso,
      modifiedISO: iso,
    },
    settings: { units: 'US', code: 'ACI318-19' },
    materials: { concrete: [], steel: [] },
    sections: [],
    members: [],
    loadCases: [],
    loadCombos: [],
    design: defaultMemberDesign(),
  };
}
