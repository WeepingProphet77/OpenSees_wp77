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
import { MemberDesignSchema, MemberSectionSchema, defaultMemberDesign } from '../design/memberDesign';
import { VierendeelPanelSchema, defaultVierendeelPanel } from '../design/vierendeelPanel';

/** Current schema version. Bumped whenever the persisted shape changes. */
export const CURRENT_SCHEMA_VERSION = 4;

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

/** One member in the project: a stable id + its flat design model. */
export const MemberDesignEntrySchema = z.object({
  id: z.string(),
  design: MemberDesignSchema,
});
export type MemberDesignEntry = z.infer<typeof MemberDesignEntrySchema>;

/** Build a fresh member entry (new id + a default or supplied design). */
export function createMemberEntry(design = defaultMemberDesign()): MemberDesignEntry {
  return { id: crypto.randomUUID(), design };
}

/** One Vierendeel panel in the project: a stable id + its design model. */
export const VierendeelPanelEntrySchema = z.object({
  id: z.string(),
  panel: VierendeelPanelSchema,
});
export type VierendeelPanelEntry = z.infer<typeof VierendeelPanelEntrySchema>;

/** Build a fresh Vierendeel panel entry (new id + a default or supplied panel). */
export function createVierendeelEntry(panel = defaultVierendeelPanel()): VierendeelPanelEntry {
  return { id: crypto.randomUUID(), panel };
}

/** A named, reusable section in the project's section library (catalog). */
export const SectionLibraryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  section: MemberSectionSchema,
});
export type SectionLibraryEntry = z.infer<typeof SectionLibraryEntrySchema>;

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
  // Flat per-member design model — one entry per member in the project (UI /
  // persistence vehicle; see design/memberDesign.ts). This is the multi-member
  // store; the richer domain members[] above stays a placeholder until the two
  // are reconciled (a later increment).
  memberDesigns: z.array(MemberDesignEntrySchema).default([]),
  /** Id of the member currently shown in the workspace. */
  activeMemberId: z.string().optional(),
  // Vierendeel wall panels (the Vierendeel workspace tool).
  vierendeelPanels: z.array(VierendeelPanelEntrySchema).default([]),
  /** Id of the Vierendeel panel currently shown in the workspace. */
  activeVierendeelId: z.string().optional(),
  // Reusable named sections (a project-level catalog); additive — members still
  // carry their own geometry inline, and a library section is applied by copy.
  sectionLibrary: z.array(SectionLibraryEntrySchema).default([]),
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
  const member = createMemberEntry();
  const panel = createVierendeelEntry();
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
    memberDesigns: [member],
    activeMemberId: member.id,
    vierendeelPanels: [panel],
    activeVierendeelId: panel.id,
    sectionLibrary: [],
  };
}
