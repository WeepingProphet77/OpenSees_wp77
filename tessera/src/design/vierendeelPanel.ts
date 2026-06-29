/**
 * Persisted design model for a Vierendeel wall panel — the inputs the
 * `VierendeelWorkspace` collects and the engine turns into an equivalent frame.
 * Mirrors `memberDesign` in style: a zod schema with defaults, parsed on load
 * and stored verbatim in the `.tsr` project.
 *
 * Units: in, kip, ksi, pcf (matching the rest of the engine).
 */
import { z } from 'zod';

export const VierendeelPanelSchema = z.object({
  name: z.string().default('Panel 1'),
  /** Overall panel width and height (in). */
  width: z.number().positive().default(240),
  height: z.number().positive().default(144),
  /** Out-of-plane wall thickness (in). */
  thickness: z.number().positive().default(8),
  /** Number of openings across (cols) and up (rows). */
  cols: z.number().int().positive().default(2),
  rows: z.number().int().positive().default(1),
  /** Solid strip sizes between/around openings (in). */
  pierWidth: z.number().positive().default(36),
  chordDepth: z.number().positive().default(24),
  /** Concrete strength (ksi) and lightweight factor for the member checks. */
  fc: z.number().positive().default(5),
  lambda: z.number().positive().default(1),
  /** Concrete unit weight (pcf) for self-weight (incl. the rigid joint areas). */
  unitWeight: z.number().nonnegative().default(150),
  /** Total in-plane lateral force at the top (kip). */
  lateralLoad: z.number().default(15),
  /** Superimposed uniform gravity on chord clear spans (kip/in). */
  gravity: z.number().default(0.02),
  base: z.enum(['fixed', 'pinned']).default('fixed'),
});

export type VierendeelPanelInput = z.infer<typeof VierendeelPanelSchema>;

/** A fresh default panel. */
export function defaultVierendeelPanel(): VierendeelPanelInput {
  return VierendeelPanelSchema.parse({});
}
