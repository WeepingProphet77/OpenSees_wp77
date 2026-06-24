/**
 * Build a fiber moment–curvature spec (the WASM `momentCurvature` ABI) from a
 * designed member's section + reinforcement + concrete strength. Bridges the
 * domain model (`schema/domain`) and the design-engine catalogs (`steelPresets`,
 * section polygonization) to the FEA layer.
 *
 * The section — any supported type (rectangular, T, double-tee, hollowcore,
 * custom/dxf) — is discretized into concrete fibers via `discretizeConcreteFibers`,
 * so the curve reflects the real flanged/voided geometry, not a rectangular
 * approximation. Mild layers map to elastic-perfectly-plastic steel; strand
 * layers map to the Devalapura–Tadros power formula with their effective
 * prestress as an initial strain.
 */
import { discretizeConcreteFibers, sectionToPolygon } from '@/engine/beamCalculations';
import steelPresets from '@/engine/steelPresets';
import type { SteelPreset } from '@/engine/types';
import type { Section, ReinforcementLayer } from '@/schema/domain';
import type { MomentCurvatureSpecInput } from './feaModel';

export interface BuildMomentCurvatureOptions {
  /** Grade catalog for `gradeId` lookup (project grades incl. user-defined); defaults to the built-in presets. */
  grades?: SteelPreset[];
  /** Concrete strip count for the fiber discretization. */
  concreteFibers?: number;
  /** Curvature increments in the sweep. */
  steps?: number;
  /** Maximum curvature of the sweep (1/in). */
  maxKappa?: number;
  /** External axial force (kip), tension positive. */
  axial?: number;
}

const DEFAULT_MILD = 'grade60';
const DEFAULT_STRAND = 'grade270';

/** Total section depth (in): the parametric `h`, else the polygon's extent. */
function sectionDepth(section: Section): number {
  if (section.h && section.h > 0) return section.h;
  const poly = sectionToPolygon(section);
  let maxY = 0;
  for (const ring of [poly.outer, ...(poly.extra ?? []), ...(poly.holes ?? [])])
    for (const p of ring) if (p.y > maxY) maxY = p.y;
  return maxY;
}

/**
 * Map a member's section + reinforcement to a `momentCurvature` spec. Zero-area
 * (placeholder) reinforcement layers are skipped; depths are taken from the top
 * compression fiber, matching the ABI convention.
 */
export function buildMomentCurvatureSpec(
  section: Section,
  reinforcement: ReinforcementLayer[],
  fc: number,
  opts: BuildMomentCurvatureOptions = {},
): MomentCurvatureSpecInput {
  const grades = opts.grades ?? steelPresets;
  const byId = new Map(grades.map((g) => [g.id, g]));
  const nStrips = opts.concreteFibers ?? 60;

  const grade = (layer: ReinforcementLayer): SteelPreset => {
    const fallback = layer.kind === 'strand' ? DEFAULT_STRAND : DEFAULT_MILD;
    return byId.get(layer.gradeId ?? fallback) ?? byId.get(fallback) ?? steelPresets.find((g) => g.id === fallback)!;
  };

  const layers = reinforcement.filter((r) => r.area > 0);

  const steel = layers
    .filter((r) => r.kind === 'mild')
    .map((r) => {
      const g = grade(r);
      return { As: r.area, d: r.depth, fy: g.fpy, Es: g.Es };
    });

  const strands = layers
    .filter((r) => r.kind === 'strand')
    .map((r) => {
      const g = grade(r);
      return {
        Aps: r.area,
        d: r.depth,
        fse: r.fse,
        Eps: g.Es,
        fpy: g.fpy,
        fpu: g.fpu,
        Q: g.Q,
        K: g.K,
        R: g.R,
      };
    });

  const spec: MomentCurvatureSpecInput = {
    section: { h: sectionDepth(section), concreteLayers: nStrips },
    concrete: { fc },
    concreteFibers: discretizeConcreteFibers(section, nStrips),
    steel,
    strands,
  };
  if (opts.steps != null) spec.steps = opts.steps;
  if (opts.maxKappa != null) spec.maxKappa = opts.maxKappa;
  if (opts.axial != null) spec.axial = opts.axial;
  return spec;
}
