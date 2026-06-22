/**
 * Composite (precast + cast-in-place topping) section analysis — Phase 2,
 * build spec §5/§6 (ratified for v1).
 *
 * Staged / transformed-section behavior:
 *   • the bare PRECAST section carries self-weight at transfer and any
 *     construction load before the topping cures;
 *   • the COMPOSITE (transformed) section carries superimposed dead + live.
 * The topping is transformed to precast-equivalent material by the modular
 * ratio n = E_topping / E_precast = √f'c_topping / √f'c_precast.
 *
 * Coordinate s is measured downward from the topping top fiber (s = 0). The
 * topping occupies s ∈ [0, t]; the precast occupies s ∈ [t, t + h_p].
 *
 * Stresses are compression-positive; sagging moment positive. Units: kip, in, ksi.
 */
import { concreteModulus } from './beamCalculations';
import { check, type DesignCheck } from './designChecks/checkTypes';

export interface Topping {
  /** Effective topping width (in). */
  width: number;
  /** Topping thickness (in). */
  thickness: number;
  /** Topping concrete strength f'c (ksi). */
  fc: number;
}

export interface PrecastProps {
  A: number; // in²
  Ig: number; // in⁴ about precast centroid
  yCg: number; // precast centroid from precast top (in)
  h: number; // precast depth (in)
}

export interface CompositeProps {
  /** Modular ratio E_topping/E_precast. */
  n: number;
  /** Total composite depth (in). */
  H: number;
  /** Transformed (precast-equivalent) area (in²). */
  A: number;
  /** Transformed moment of inertia about the composite centroid (in⁴). */
  I: number;
  /** Composite centroid from the topping top fiber (in). */
  sc: number;
  /** Composite centroid → precast bottom fiber (in). */
  cPrecastBot: number;
  /** Composite centroid → precast top fiber (in). */
  cPrecastTop: number;
  /** Composite centroid → topping top fiber (in). */
  cToppingTop: number;
}

/** Transformed composite section properties (topping on top of the precast). */
export function transformedComposite(precast: PrecastProps, topping: Topping, precastFc: number): CompositeProps {
  const n = concreteModulus(topping.fc) / concreteModulus(precastFc);
  const t = topping.thickness;
  const Atop = topping.width * t;
  const Ap = precast.A;
  const Atr = n * Atop + Ap;
  // First moment about the topping top fiber (s = 0).
  const firstMoment = n * Atop * (t / 2) + Ap * (t + precast.yCg);
  const sc = firstMoment / Atr;
  const Itop = n * ((topping.width * t * t * t) / 12) + n * Atop * Math.pow(t / 2 - sc, 2);
  const Ipre = precast.Ig + Ap * Math.pow(t + precast.yCg - sc, 2);
  const I = Itop + Ipre;
  const H = t + precast.h;
  return {
    n,
    H,
    A: Atr,
    I,
    sc,
    cPrecastBot: H - sc,
    cPrecastTop: sc - t,
    cToppingTop: sc,
  };
}

export interface CompositeStressInput {
  precast: PrecastProps;
  composite: CompositeProps;
  precastFc: number;
  toppingFc: number;
  lambda?: number;
  serviceClass?: 'U' | 'T';
  /** Effective prestress force (kip) and eccentricity below precast centroid (in). */
  Pe: number;
  e: number;
  /** Moment on the bare precast section (self-weight + construction) (kip-in). */
  Mprecast: number;
  /** Moment applied to the composite section (superimposed dead + live) (kip-in). */
  Mcomposite: number;
}

export interface CompositeStressResult {
  /** Total precast bottom-fiber stress (ksi, compression +). */
  precastBottom: number;
  /** Total precast top-fiber stress (ksi). */
  precastTop: number;
  /** Real topping top-fiber stress (ksi, includes the n factor). */
  toppingTop: number;
  checks: DesignCheck[];
}

const sqrtFcKsi = (fc: number) => Math.sqrt(fc * 1000) / 1000;

/** Staged service stresses on the composite member (build spec §6). */
export function compositeServiceStresses(input: CompositeStressInput): CompositeStressResult {
  const { precast, composite, precastFc, toppingFc, lambda = 1, serviceClass = 'U', Pe, e, Mprecast, Mcomposite } = input;
  const ybp = precast.h - precast.yCg; // precast centroid → precast bottom
  const ytp = precast.yCg; // precast centroid → precast top

  // Stage 1 — bare precast section (prestress + Mprecast).
  const fpb1 = Pe / precast.A + (Pe * e * ybp) / precast.Ig - (Mprecast * ybp) / precast.Ig;
  const fpt1 = Pe / precast.A - (Pe * e * ytp) / precast.Ig + (Mprecast * ytp) / precast.Ig;

  // Stage 2 — composite section (Mcomposite).
  const fpb2 = -(Mcomposite * composite.cPrecastBot) / composite.I;
  const fpt2 = (Mcomposite * composite.cPrecastTop) / composite.I;
  const ftt2transformed = (Mcomposite * composite.cToppingTop) / composite.I;

  const precastBottom = fpb1 + fpb2;
  const precastTop = fpt1 + fpt2;
  const toppingTop = composite.n * ftt2transformed; // real stress in the (softer) topping

  const tension = (s: number) => Math.max(0, -s);
  const compression = (s: number) => Math.max(0, s);
  const serviceTension = (serviceClass === 'T' ? 12 : 7.5) * lambda * sqrtFcKsi(precastFc);

  const checks: DesignCheck[] = [
    check({
      id: 'composite-precast-bottom-tension',
      label: 'Composite — precast bottom tension (service)',
      clause: 'ACI 318-19 §24.5.2.1 (staged, §6)',
      formula: 'f_pb = [stage 1 on precast] + [stage 2 on composite] ≥ −limit',
      demand: tension(precastBottom),
      capacity: serviceTension,
      unit: 'ksi',
    }),
    check({
      id: 'composite-precast-top-compression',
      label: 'Composite — precast top compression (service)',
      clause: 'ACI 318-19 §24.5.2.1',
      formula: "f_pt ≤ 0.60·f'c (precast)",
      demand: compression(precastTop),
      capacity: 0.6 * precastFc,
      unit: 'ksi',
    }),
    check({
      id: 'composite-topping-top-compression',
      label: 'Composite — topping top compression (service)',
      clause: 'ACI 318-19 §24.5.2.1',
      formula: "n·(M_comp·c_tt/I_c) ≤ 0.60·f'c (topping)",
      demand: compression(toppingTop),
      capacity: 0.6 * toppingFc,
      unit: 'ksi',
    }),
  ];

  return { precastBottom, precastTop, toppingTop, checks };
}

export interface InterfaceShearInput {
  /** Factored interface shear (kip) — the factored member shear. */
  Vu: number;
  /** Interface (contact) width (in). */
  bv: number;
  /** Composite effective depth to the tension reinforcement (in). */
  d: number;
  /**
   * Nominal horizontal shear stress capacity vnh (psi) per ACI 318-19
   * Table 16.4.4.2. Default 80 psi (clean, intentionally roughened, no ties).
   */
  vnh?: number;
}

export interface InterfaceShearResult {
  vu: number; // factored interface shear stress (ksi)
  phiVnh: number; // factored horizontal shear capacity (kip)
  check: DesignCheck;
}

/** Horizontal (interface) shear check, ACI 318-19 §16.4. φ = 0.75. */
export function interfaceShearCheck(input: InterfaceShearInput): InterfaceShearResult {
  const { Vu, bv, d, vnh = 80 } = input;
  const phi = 0.75;
  const Vnh = (vnh * bv * d) / 1000; // kip
  const phiVnh = phi * Vnh;
  const vu = bv > 0 && d > 0 ? Vu / (bv * d) : 0; // ksi
  return {
    vu,
    phiVnh,
    check: check({
      id: 'interface-horizontal-shear',
      label: 'Composite interface horizontal shear',
      clause: 'ACI 318-19 §16.4.4.2',
      formula: `φVnh = 0.75·vnh·bv·d ≥ Vu  (vnh = ${vnh} psi)`,
      demand: Vu,
      capacity: phiVnh,
      unit: 'kip',
    }),
  };
}
