/**
 * Shared types for the Tessera flexural-strength engine.
 *
 * Ported from the JavaScript reference implementation in
 * `WeepingProphet77/prestressed_beam_power` (src/utils/beamCalculations.js and
 * src/data/steelPresets.js). The numeric algorithm is preserved verbatim; these
 * types document the existing, untyped contract.
 *
 * Units throughout: ksi (stress / modulus), in (length), in² (area),
 * kip (force), kip-in (moment) unless a field name says otherwise.
 */

export type SteelCategory = 'mild' | 'prestressing';

/**
 * The minimal steel parameter set the power formula needs. `stressCap` caps the
 * returned stress (fpy for mild steel, fpu for prestressing steel); when absent
 * the engine falls back to `fpu`.
 */
export interface PowerFormulaSteel {
  Es: number;
  fpu: number;
  fpy: number;
  Q: number;
  R: number;
  K: number;
  stressCap?: number;
}

/** A catalog steel grade (the 6 presets plus any user-defined grades). */
export interface SteelPreset extends PowerFormulaSteel {
  id: string;
  name: string;
  description: string;
  category: SteelCategory;
  stressCap: number;
  defaultFse: number;
}

export type SectionType =
  | 'rectangular'
  | 'tbeam'
  | 'sandwich'
  | 'doubletee'
  | 'hollowcore'
  | 'custom'
  | 'dxf';

export interface Point {
  x: number;
  y: number;
}

/**
 * Cross-section description. Geometry fields are optional because each
 * `sectionType` uses a different subset; `fc` and `h` are common to all
 * parametric types. Polygon types (`custom`, `dxf`) carry `points`/`holes`.
 */
export interface Section {
  sectionType?: SectionType;
  /** Concrete compressive strength f'c (ksi). */
  fc?: number;
  /** Total section depth (in). */
  h?: number;
  /** Lightweight-concrete factor λ (ACI 318-19 §19.2.4); 1.0 normalweight. */
  lambda?: number;
  /** Optional factored flexural demand Mu (kip-ft) enabling the 1.33·Mu check. */
  Mu?: number;
  bendingMode?: 'uniaxial' | 'biaxial';

  // rectangular / tbeam / doubletee
  bf?: number;
  bw?: number;
  hf?: number;

  // sandwich
  bt?: number;
  ht?: number;
  hg?: number;
  bb?: number;

  // doubletee
  numStems?: number;
  stemWidth?: number;

  // hollowcore
  numVoids?: number;
  voidDiameter?: number;
  voidCenterDepth?: number;

  // polygon (custom / dxf)
  points?: Point[];
  holes?: Point[][];
}

/** One layer of reinforcement (mild bar or prestressing strand). */
export interface SteelLayer {
  /** Steel area (in²). */
  area: number;
  /** Depth from the extreme compression fiber (in). */
  depth: number;
  /** Effective prestress after losses (ksi); 0 for mild steel. */
  fse: number;
  /** Power-formula material parameters for this layer. */
  steel: PowerFormulaSteel;
  /** Horizontal position (in) — required for biaxial analysis only. */
  x?: number;
}

/** Gross section properties about the centroid (top-fiber-down convention). */
export interface SectionProps {
  A: number;
  yCg: number;
  Ig: number;
  yb: number;
  Sb: number;
}

/** A flexural layer result after analysis. */
export interface LayerResult extends SteelLayer {
  strain: number;
  epsDecomp?: number;
  stress: number;
  force: number;
}

/** Polygon ring spec used by the biaxial path. */
export interface PolySpec {
  outer: Point[];
  holes: Point[][];
  extra?: Point[][];
}

/** Full unsymmetric-bending properties of a polygon spec. */
export interface PolygonFullProps {
  A: number;
  xCg: number;
  yCg: number;
  Ix: number;
  Iy: number;
  Ixy: number;
  corners: Point[];
}
