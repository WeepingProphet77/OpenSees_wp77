/**
 * Member-level analysis orchestrator (Phase 1).
 *
 * Resolves a beam member's section properties and demands, runs the flexural
 * power-formula engine, and runs the ACI/PCI design checks (transfer & service
 * stresses, shear, camber/deflection, prestress losses), then aggregates every
 * DesignCheck and the governing utilization.
 *
 * Loads are uniform (kip/in) for v1; self-weight is computed from the gross area
 * and concrete unit weight. Strength demands use the 1.2D + 1.6L gravity
 * combination as the v1 default (the full ACI 318-19 §5.3 combination set lands
 * in Phase 2). Service checks use unfactored loads. Units: kip, in, ksi.
 */
import {
  analyzeBeam,
  concreteModulus,
  grossSectionProperties,
  sectionToPolygon,
  type BeamResult,
} from './beamCalculations';
import type { Section, SteelLayer } from './types';
import { momentAt, shearAt, uniformMidspanMoment } from './statics';
import { governingStrength } from './loadCombinations';
import { check, type DesignCheck } from './designChecks/checkTypes';
import { serviceStressChecks, type ServiceStressResult } from './designChecks/serviceStresses';
import { shearChecks, type ShearResult } from './designChecks/shear';
import { torsionChecks, ringAreaPerimeter, type TorsionResult } from './designChecks/torsion';
import { camberDeflection, type CamberResult } from './designChecks/camberDeflection';
import {
  prestressLosses,
  type LossResult,
  type StrandType,
} from './designChecks/prestressLosses';
import {
  transformedComposite,
  compositeServiceStresses,
  interfaceShearCheck,
  type CompositeProps,
  type CompositeStressResult,
  type InterfaceShearResult,
} from './compositeSection';

export interface AnalyzeMemberInput {
  /** Engine section (with f'c, h, and geometry for its sectionType). */
  section: Section;
  /** f'ci at transfer (ksi). */
  fci: number;
  /** Concrete unit weight (pcf), default 150. */
  wc?: number;
  lambda?: number;
  /** Resolved reinforcement layers (with steel objects and fse). */
  layers: SteelLayer[];
  /** Span (in). */
  L: number;
  /** Uniform service loads excluding self-weight (kip/in). */
  loads: { dead?: number; superDead?: number; live?: number };
  design?: {
    serviceClass?: 'U' | 'T';
    endRegion?: boolean;
    RH?: number;
    VS?: number;
    Av?: number;
    fyt?: number;
    stirrupSpacing?: number;
    deflectionLimits?: { live?: number; longTerm?: number };
    /** Factored torsional moment (kip-in); 0 (default) skips torsion design. */
    Tu?: number;
    /** Closed torsion-stirrup area, one leg, within s (in²). */
    At?: number;
    /** Longitudinal torsion steel provided, total around ph (in²). */
    Al?: number;
    /** Clear-ish cover to the stirrup centerline for Aoh/ph (in), default 1.75. */
    torsionCover?: number;
  };
  prestress?: {
    /** Initial strand stress before transfer (ksi). */
    fpi?: number;
    strandType?: StrandType;
    Eps?: number;
  };
  /** Cast-in-place composite topping (floor members), or omitted. */
  topping?: { width: number; thickness: number; fc: number };
}

export interface MemberAnalysis {
  properties: {
    A: number;
    Ig: number;
    yCg: number;
    yt: number;
    yb: number;
    Sb: number;
    Ec: number;
    Eci: number;
    wSelf: number; // kip/in
    d: number;
    dp: number;
    bw: number;
  };
  demands: {
    Mg: number; // transfer self-weight moment (kip-in)
    Msustained: number;
    Mtotal: number;
    Mu: number; // factored midspan moment (kip-in)
    VuAtD: number; // factored shear at d from support (kip)
    MuAtD: number; // factored moment at d (kip-in)
    Vmax: number; // factored shear at support (kip)
    combo: string; // governing ACI 318-19 §5.3 combination
  };
  prestress: { Pi: number; Pe: number; e: number; hasStrands: boolean };
  flexure: BeamResult;
  stresses?: ServiceStressResult;
  shear: ShearResult;
  torsion?: TorsionResult;
  camber: CamberResult;
  losses?: LossResult;
  composite?: {
    props: CompositeProps;
    stresses: CompositeStressResult;
    interface: InterfaceShearResult;
  };
  checks: DesignCheck[];
  governing: { utilization: number; status: 'pass' | 'fail'; check?: DesignCheck };
}

export function analyzeMember(input: AnalyzeMemberInput): MemberAnalysis {
  const { section, fci, wc = 150, lambda = 1, layers, L, loads, design = {}, prestress = {} } =
    input;
  const fc = section.fc ?? 0;
  const h = section.h ?? 0;

  const props = grossSectionProperties(section);
  const { A, Ig, yCg, yb, Sb } = props;
  const yt = yCg; // centroid → top (compression) fiber
  const Ec = concreteModulus(fc);
  const Eci = concreteModulus(fci);

  // Self-weight (kip/in) = A[in²]·wc[pcf]/1728[in³/ft³]/1000.
  const wSelf = (A * wc) / 1728 / 1000;

  const wDead = loads.dead ?? 0;
  const wSuper = loads.superDead ?? 0;
  const wLive = loads.live ?? 0;

  // Service moments at mid-span.
  const Mg = uniformMidspanMoment(wSelf, L);
  const Msustained = uniformMidspanMoment(wSelf + wDead + wSuper, L);
  const Mtotal = Msustained + uniformMidspanMoment(wLive, L);

  // Strength demands via the governing ACI 318-19 §5.3 combination. Uniform
  // loads scale moment/shear linearly, so the governing factored line load is
  // the governing factored moment/shear.
  const gov = governingStrength({ D: wSelf + wDead + wSuper, L: wLive });
  const wu = gov.value;
  const Mu = uniformMidspanMoment(wu, L);

  // Geometry depths.
  const d = layers.length ? Math.max(...layers.map((l) => l.depth)) : 0.9 * h;
  const strands = layers.filter((l) => l.fse > 0);
  const Pe = strands.reduce((s, l) => s + l.fse * l.area, 0);
  const fpi = prestress.fpi ?? 0;
  const Pi = fpi > 0 ? strands.reduce((s, l) => s + fpi * l.area, 0) : Pe;
  const yps =
    Pe > 0 ? strands.reduce((s, l) => s + l.fse * l.area * l.depth, 0) / Pe : yCg;
  const e = yps - yCg;
  const dp = strands.length ? yps : d;
  const hasStrands = strands.length > 0;

  const bw = section.bw ?? section.bf ?? 0;

  // Critical shear section at x = d from the support (ACI 318-19 §9.4.3.2),
  // with concurrent factored shear/moment.
  const xCrit = Math.min(d, L / 2);
  const VuAtD = Math.abs(shearAt(xCrit, L, [{ w: wu }]));
  const MuAtD = momentAt(xCrit, L, [{ w: wu }]);
  const Vmax = Math.abs(shearAt(0, L, [{ w: wu }]));

  // ── Flexure ───────────────────────────────────────────────────────────────
  const flexure = analyzeBeam({ ...section, Mu: Mu / 12 }, layers);

  // ── Transfer & service stresses (prestressed only) ─────────────────────────
  let stresses: ServiceStressResult | undefined;
  if (hasStrands) {
    stresses = serviceStressChecks({
      props: { A, Ig, yt, yb },
      fc,
      fci,
      lambda,
      endRegion: design.endRegion,
      serviceClass: design.serviceClass,
      Pi,
      Pe,
      e,
      Mg,
      Msustained,
      Mtotal,
    });
  }

  // ── Shear ──────────────────────────────────────────────────────────────────
  const shear = shearChecks({
    fc,
    lambda,
    bw,
    d,
    h,
    dp,
    Vu: VuAtD,
    Mu: MuAtD,
    prestressed: hasStrands,
    Av: design.Av,
    fyt: design.fyt,
    s: design.stirrupSpacing,
  });

  // ── Torsion (ACI 318-19 §22.7), only when a factored torque is supplied ──────
  let torsion: TorsionResult | undefined;
  const Tu = design.Tu ?? 0;
  if (Tu > 0) {
    // Gross outside area/perimeter from the real section polygon; stirrup-cage
    // area/perimeter from a rectangular cage inscribed in the web at the cover.
    const outer = sectionToPolygon(section).outer;
    const { area: Acp, perimeter: pcp } = ringAreaPerimeter(outer);
    const cover = design.torsionCover ?? 1.75;
    const x1 = Math.max(bw - 2 * cover, 0);
    const y1 = Math.max(h - 2 * cover, 0);
    const Aoh = x1 * y1;
    const ph = 2 * (x1 + y1);
    torsion = torsionChecks({
      Tu,
      Vu: VuAtD,
      fc,
      lambda,
      bw,
      d,
      Acp: Acp || A,
      pcp,
      Aoh,
      ph,
      Vc: shear.Vc,
      fyt: design.fyt,
      Av: design.Av,
      At: design.At,
      s: design.stirrupSpacing,
      Al: design.Al,
      prestressed: hasStrands,
      fpc: A > 0 ? Pe / A : 0,
    });
  }

  // ── Camber / deflection ─────────────────────────────────────────────────────
  const camber = camberDeflection({
    Pi,
    e,
    L,
    Eci,
    Ec,
    Ig,
    wSelf,
    wSuperDead: wDead + wSuper,
    wLive,
    limits: design.deflectionLimits,
  });

  // ── Prestress losses (estimate, for reporting) ──────────────────────────────
  let losses: LossResult | undefined;
  if (hasStrands && fpi > 0) {
    const Aps = strands.reduce((s, l) => s + l.area, 0);
    losses = prestressLosses({
      Eps: prestress.Eps ?? strands[0].steel.Es,
      Eci,
      Ec,
      fpu: strands[0].steel.fpu,
      fpi,
      strandType: prestress.strandType,
      A,
      I: Ig,
      e,
      Aps,
      Mg,
      Msd: uniformMidspanMoment(wSuper, L),
      VS: design.VS ?? 3.0,
      RH: design.RH ?? 70,
    });
  }

  // ── Composite cast-in-place topping (floor members) ─────────────────────────
  let composite: MemberAnalysis['composite'];
  if (input.topping) {
    const cprops = transformedComposite(
      { A, Ig, yCg, h },
      input.topping,
      fc,
    );
    // Stage moments: the bare precast carries self-weight + the wet topping;
    // the composite section carries superimposed dead + live.
    const wTopping = (input.topping.width * input.topping.thickness * wc) / 1728 / 1000;
    const Mprecast = uniformMidspanMoment(wSelf + wTopping, L);
    const Mcomposite = uniformMidspanMoment(wSuper + wLive, L);
    const stressRes = compositeServiceStresses({
      precast: { A, Ig, yCg, h },
      composite: cprops,
      precastFc: fc,
      toppingFc: input.topping.fc,
      lambda,
      serviceClass: design.serviceClass,
      Pe,
      e,
      Mprecast,
      Mcomposite,
    });
    const iface = interfaceShearCheck({ Vu: Vmax, bv: bw, d: input.topping.thickness + d });
    composite = { props: cprops, stresses: stressRes, interface: iface };
  }

  // ── Aggregate checks ─────────────────────────────────────────────────────────
  const flexureChecks: DesignCheck[] = [
    check({
      id: 'flexure-strength',
      label: 'Flexural strength φMn ≥ Mu',
      clause: 'ACI 318-19 §22.3 / §21.2.2',
      formula: 'φMn ≥ Mu (Mu = 1.2·Md + 1.6·Ml)',
      demand: Mu / 12,
      capacity: flexure.phiMnFt,
      unit: 'kip-ft',
    }),
    check({
      id: 'flexure-min-strength',
      label: 'Minimum flexural strength',
      clause: 'ACI 318-19 §9.6.1.3',
      formula: `φMn ≥ ${flexure.cracking.governs} (lesser of 1.2Mcr, 1.33Mu)`,
      demand: flexure.cracking.thresholdFt,
      capacity: flexure.phiMnFt,
      unit: 'kip-ft',
    }),
  ];

  const checks: DesignCheck[] = [
    ...flexureChecks,
    ...(stresses?.checks ?? []),
    ...shear.checks,
    ...(torsion?.checks ?? []),
    ...camber.checks,
    ...(composite ? [...composite.stresses.checks, composite.interface.check] : []),
  ];

  let governingCheck: DesignCheck | undefined;
  let maxUtil = 0;
  for (const c of checks) {
    if (c.utilization > maxUtil) {
      maxUtil = c.utilization;
      governingCheck = c;
    }
  }
  const status: 'pass' | 'fail' = checks.every((c) => c.status === 'pass') ? 'pass' : 'fail';

  return {
    properties: { A, Ig, yCg, yt, yb, Sb, Ec, Eci, wSelf, d, dp, bw },
    demands: { Mg, Msustained, Mtotal, Mu, VuAtD, MuAtD, Vmax, combo: gov.combination.name },
    prestress: { Pi, Pe, e, hasStrands },
    flexure,
    stresses,
    shear,
    torsion,
    camber,
    losses,
    composite,
    checks,
    governing: { utilization: maxUtil, status, check: governingCheck },
  };
}
